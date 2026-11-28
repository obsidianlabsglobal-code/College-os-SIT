// covers: ID-012, AD-002, ID-009, ID-010, ID-004, ID-006
import "../scripts/environment";
import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { db } from "../lib/db";
import { auth } from "../lib/auth";
import { WorkflowError } from "../lib/assignments";
import { applyTeacherImport, previewTeacherImport, teacherImport } from "../lib/roster-import";
import { decideJoinRequests, joinOptions, myJoinRequests, requestToJoin, revokePreviewStudent, sectionRequests } from "../lib/student-admission";
import { acceptNotice, consentNeeded, consentStatus, NOTICE, setConsentRequired } from "../lib/consent";
import { fixtures, demoEmail, personas } from "../scripts/fixtures";
import type { Scope } from "../lib/scope";

const owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const as = new Map<string, Scope>();
const i = fixtures.institution;
const tag = randomUUID().slice(0, 6);
const mail = (n: string) => `${n}-${tag}@nexus.example.invalid`;
const ids = { mechSection: randomUUID(), mechOffering: randomUUID() };
const rejects = (run: () => Promise<unknown>, pattern?: RegExp) =>
  assert.rejects(async () => run(), (e: unknown) => (e instanceof WorkflowError || (e as Error).name === "ZodError") && (!pattern || pattern.test((e as Error).message)));
const header = "name,email,phone,department,teaches,mentor_of";
// A fresh fictional client address per scenario: the auth library's per-address counters persist in the database.
let ip = "";
const newAddress = () => { ip = `198.18.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`; };
newAddress();
const post = async (path: string, body: unknown) => auth.handler(new Request(new URL(`/api/auth${path}`, process.env.BETTER_AUTH_URL), {
  method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) }));
const mailCount = async (email: string) => (await owner.query("SELECT count(*)::int AS n FROM dev_mailbox WHERE to_email=$1", [email])).rows[0].n as number;
/** Codes are sent in the background (no timing difference for unknown emails), so wait for the newest one. */
const codeFor = async (email: string, before: number) => {
  for (let n = 0; n < 50 && await mailCount(email) <= before; n++) await new Promise(r => setTimeout(r, 50));
  const { rows: [m] } = await owner.query("SELECT body FROM dev_mailbox WHERE to_email=$1 ORDER BY id DESC LIMIT 1", [email]);
  return m.body.match(/\b(\d{6})\b/)[1] as string;
};
/** Signs in by email code and returns the account, creating it on first use (as a student's first visit does). */
const signInByCode = async (email: string) => {
  const before = await mailCount(email);
  assert.equal((await post("/email-otp/send-verification-otp", { email, type: "sign-in" })).status, 200);
  const response = await post("/sign-in/email-otp", { email, otp: await codeFor(email, before) });
  assert.equal(response.status, 200);
  const { rows: [u] } = await owner.query('SELECT id,email,"emailVerified" AS "emailVerified",name FROM "user" WHERE email=$1', [email]);
  return u as { id: string; email: string; emailVerified: boolean; name: string };
};

before(async () => {
  for (const url of [process.env.MIGRATION_DATABASE_URL, process.env.DATABASE_URL]) assert.ok(url && ["127.0.0.1", "localhost"].includes(new URL(url).hostname));
  for (const [alias, [, , role]] of Object.entries(personas)) {
    const { rows: [row] } = await owner.query('SELECT id FROM "user" WHERE email=$1', [demoEmail(alias)]);
    as.set(alias, { account: row.id, role, institution: alias === "tenant" ? fixtures.otherInstitution : fixtures.institution });
  }
  // Two departments, one on: a section that only has a Mechanical class, with Mechanical switched off.
  await owner.query("INSERT INTO section (institution_id,id,name) VALUES ($1,$2,$3)", [i, ids.mechSection, `Mech only ${tag}`]);
  await owner.query("INSERT INTO offering (institution_id,id,course_id,section_id,term_id) VALUES ($1,$2,$3,$4,$5)",
    [i, ids.mechOffering, fixtures.otherDepartment, ids.mechSection, fixtures.term]);
  await owner.query("UPDATE department SET active=false WHERE institution_id=$1 AND id=$2", [i, fixtures.otherDepartment]);
});
after(async () => {
  await owner.query("DELETE FROM offering WHERE institution_id=$1 AND id=$2", [i, ids.mechOffering]);
  await owner.query("DELETE FROM section WHERE institution_id=$1 AND id=$2", [i, ids.mechSection]);
  await owner.query("UPDATE department SET active=true WHERE institution_id=$1", [i]);
  await owner.query("UPDATE institution SET consent_required=false WHERE id=$1", [i]);
  await Promise.all([db.end(), owner.end()]);
});

test("the office previews a teacher sheet with per-row errors and writes nothing until a clean sheet is confirmed", async () => {
  const admin = as.get("admin")!;
  const bad = [header,
    `Fictional Teacher ${tag},${mail("t1")},+91 98450 00001,Electronics and Communication Engineering,Introduction to Programming / Section B,Section B`,
    `Copy ${tag},${mail("t1")},,Electronics and Communication Engineering,Introduction to Programming / Section B,`,
    `Mech Teacher ${tag},${mail("mech")},,Mechanical Engineering,Engineering Mechanics / Mech only ${tag},`,
    `Lost ${tag},${mail("lost")},12,Electronics and Communication Engineering,Basket Weaving / Section Z,Section Z`,
  ].join("\n");
  await rejects(() => previewTeacherImport(as.get("faculty")!, bad));
  await rejects(() => previewTeacherImport(admin, "email,name\nx,y"), /first line/);
  const preview = await previewTeacherImport(admin, bad);
  const errors = Object.fromEntries(preview.rows.map(r => [r.line, r.errors.join(" ")]));
  assert.equal(errors[2], "");
  assert.match(errors[3], /Same email as line 2/);
  assert.match(errors[4], /not switched on/);
  assert.match(errors[5], /Phone must be/);
  assert.match(errors[5], /No class "Basket Weaving \/ Section Z"/);
  assert.match(errors[5], /Section "Section Z" does not exist/);
  assert.equal((await owner.query('SELECT 1 FROM "user" WHERE email=$1', [mail("t1")])).rowCount, 0, "a preview writes no account");
  await rejects(() => applyTeacherImport(admin, preview.id), /no longer pass/);
  await rejects(() => teacherImport({ ...as.get("tenant")!, role: "admin" }, preview.id), /unavailable/);

  const clean = await previewTeacherImport(admin, [header,
    `Fictional Teacher ${tag},${mail("t1")},+91 98450 00001,Electronics and Communication Engineering,Introduction to Programming / Section B,Section B`].join("\r\n"));
  await rejects(() => applyTeacherImport(as.get("hod")!, clean.id));
  assert.equal(await applyTeacherImport(admin, clean.id), 1);
  await rejects(() => applyTeacherImport(admin, clean.id), /already applied/);
  const { rows: [teacher] } = await owner.query(`SELECT u.id,
      EXISTS (SELECT 1 FROM membership m WHERE m.institution_id=$1 AND m.account_id=u.id AND m.role='faculty' AND m.ended_at IS NULL) AS member,
      EXISTS (SELECT 1 FROM roster r WHERE r.institution_id=$1 AND r.account_id=u.id AND r.offering_id=$3 AND r.role='faculty') AS teaches,
      EXISTS (SELECT 1 FROM section_mentor s WHERE s.institution_id=$1 AND s.account_id=u.id AND s.section_id=$4) AS mentor
    FROM "user" u WHERE u.email=$2`, [i, mail("t1"), fixtures.otherOffering, fixtures.otherSection]);
  assert.deepEqual([teacher.member, teacher.teaches, teacher.mentor], [true, true, true]);
  const again = await previewTeacherImport(admin, [header, `Fictional Teacher ${tag},${mail("t1")},,Electronics and Communication Engineering,,`].join("\n"));
  assert.match(again.rows[0].errors.join(" "), /already a current teacher/);
});

test("email sign-in codes work once, expire in 10 minutes and are limited per email", async () => {
  newAddress();
  const email = mail("t1");
  const before = await mailCount(email);
  assert.equal((await post("/email-otp/send-verification-otp", { email, type: "sign-in" })).status, 200);
  const code = await codeFor(email, before);
  const { rows: [v] } = await owner.query(`SELECT extract(epoch FROM "expiresAt"-now())::int AS seconds, value FROM verification WHERE identifier LIKE $1 ORDER BY "createdAt" DESC LIMIT 1`,
    [`%${email}%`]);
  assert.ok(v.seconds > 540 && v.seconds <= 600, "expires in 10 minutes");
  assert.ok(!v.value.includes(code), "the stored code is hashed");
  assert.notEqual((await post("/sign-in/email-otp", { email, otp: code === "000000" ? "111111" : "000000" })).status, 200);
  assert.equal((await post("/sign-in/email-otp", { email, otp: code })).status, 200);
  assert.notEqual((await post("/sign-in/email-otp", { email, otp: code })).status, 200, "a code works once");
  newAddress();
  const limited = mail("limit");
  const statuses: number[] = [];
  for (let n = 0; n < 6; n++) statuses.push((await post("/email-otp/send-verification-otp", { email: limited, type: "sign-in" })).status);
  await new Promise(r => setTimeout(r, 300));
  // The reply is the same either way, so nobody learns whether an email exists; the sixth code is simply not sent.
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 200]);
  assert.equal(await mailCount(limited), 5, "five codes per email per hour");
  // The auth library also limits each address: 10 code requests per 10 minutes.
  newAddress();
  const burst: number[] = [];
  for (let n = 0; n < 11; n++) burst.push((await post("/email-otp/send-verification-otp", { email: mail(`burst${n}`), type: "sign-in" })).status);
  assert.deepEqual([burst.slice(0, 10).every(s => s === 200), burst[10]], [true, 429]);
});

test("students ask to join a switched-on section; only that section's teachers decide; approval grants access the office can revoke", async () => {
  newAddress();
  const teacher = { institution: i, account: (await owner.query('SELECT id FROM "user" WHERE email=$1', [mail("t1")])).rows[0].id as string, role: "faculty" as const };
  const options = await joinOptions(i);
  assert.ok(options.some(o => o.section_id === fixtures.otherSection), "Section B (Electronics, switched on) is open");
  assert.ok(!options.some(o => o.section_id === ids.mechSection), "a section with only switched-off departments is not");
  assert.deepEqual(await joinOptions("not-a-uuid"), []);

  const priya = await signInByCode(mail("priya"));
  const ravi = await signInByCode(mail("ravi"));
  const kiran = await signInByCode(mail("kiran"));
  assert.equal(priya.emailVerified, true, "signing in by code confirms the email");
  const form = (usn: string, section = fixtures.otherSection) => ({ institution: i, name: "Fictional Student", usn, semester: 3, section, bus_stop: "Hebbal" });
  await rejects(() => requestToJoin({ ...priya, emailVerified: false }, form(`4SI${tag}01`)), /Confirm your email/);
  await rejects(() => requestToJoin(priya, form(`4SI${tag}01`, ids.mechSection)), /open for sign-up/);
  await rejects(() => requestToJoin(priya, { ...form(`4SI${tag}01`), usn: "bad usn" }));
  const first = await requestToJoin(priya, form(`4si${tag}01`));
  await rejects(() => requestToJoin(priya, form(`4SI${tag}02`)), /already have a request/);
  await rejects(() => requestToJoin(ravi, form(`4SI${tag}01`)), /already has a request/);
  const second = await requestToJoin(ravi, form(`4SI${tag}02`));
  const third = await requestToJoin(kiran, form(`4SI${tag}03`));
  assert.equal((await myJoinRequests(priya))[0].state, "pending");
  assert.equal((await owner.query("SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2", [i, priya.id])).rowCount, 0, "nothing is visible while pending");

  const faculty = as.get("faculty")!;  // teaches Section A only
  assert.ok(!(await sectionRequests(faculty)).some(r => r.id === first));
  await rejects(() => decideJoinRequests(faculty, { requests: [first], decision: "approved" }), /sections you teach or mentor/);
  await rejects(() => decideJoinRequests(as.get("admin")!, { requests: [first], decision: "approved" }));
  assert.ok((await sectionRequests(teacher)).some(r => r.id === first && r.usn === `4SI${tag}01`.toUpperCase()));
  await rejects(() => decideJoinRequests(teacher, { requests: [third], decision: "rejected" }), /reason/);
  await decideJoinRequests(teacher, { requests: [third], decision: "rejected", reason: "Not on the Section B list; ask the office." });
  assert.equal((await myJoinRequests(kiran))[0].reason, "Not on the Section B list; ask the office.");
  await decideJoinRequests(teacher, { requests: [first, second], decision: "approved" });
  await rejects(() => decideJoinRequests(teacher, { requests: [first], decision: "approved" }), /already decided/);
  const { rows: [access] } = await owner.query(`SELECT
      EXISTS (SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role='student' AND ended_at IS NULL) AS member,
      EXISTS (SELECT 1 FROM roster WHERE institution_id=$1 AND account_id=$2 AND offering_id=$3 AND role='student' AND ended_at IS NULL) AS rostered,
      (SELECT usn FROM person_detail WHERE institution_id=$1 AND account_id=$2) AS usn,
      (SELECT a.id FROM student_admission a WHERE a.institution_id=$1 AND a.email=$4 AND a.revoked_at IS NULL) AS admission`,
  [i, priya.id, fixtures.otherOffering, mail("priya")]);
  assert.deepEqual([access.member, access.rostered, access.usn], [true, true, `4SI${tag}01`.toUpperCase()]);
  const { rows: [audited] } = await owner.query("SELECT count(*)::int AS n FROM audit_event WHERE institution_id=$1 AND entity_id IN ($2,$3,$4) AND action LIKE 'signup.%'",
    [i, first, second, third]);
  assert.equal(audited.n, 6, "three requests and three decisions are audited");

  await rejects(() => revokePreviewStudent(teacher, access.admission));
  await revokePreviewStudent(as.get("admin")!, access.admission);
  const { rows: [revoked] } = await owner.query(`SELECT
      EXISTS (SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role='student' AND ended_at IS NULL) AS member,
      EXISTS (SELECT 1 FROM roster WHERE institution_id=$1 AND account_id=$2 AND role='student' AND ended_at IS NULL) AS rostered`, [i, priya.id]);
  assert.deepEqual([revoked.member, revoked.rostered], [false, false], "the office's revoke ends access");
});

test("a college can require the privacy notice; members accept the current version and the office sees who has not", async () => {
  const student = as.get("student")!, admin = as.get("admin")!;
  assert.equal(await consentNeeded(student), false);
  await rejects(() => setConsentRequired(student, true));
  await setConsentRequired(admin, true);
  assert.equal(await consentNeeded(student), true);
  assert.equal(await consentNeeded({ ...as.get("tenant")!, role: "student" }), false, "other colleges are unaffected");
  assert.ok((await consentStatus(admin))!.missing.some(m => m.email === demoEmail("student")));
  assert.equal(await consentStatus(student), null);
  await rejects(() => acceptNotice(student, "2000-01-01"), /notice changed/);
  await acceptNotice(student, NOTICE.version);
  await acceptNotice(student, NOTICE.version);
  assert.equal(await consentNeeded(student), false);
  assert.ok(!(await consentStatus(admin))!.missing.some(m => m.email === demoEmail("student")));
  await owner.query("DELETE FROM consent_record WHERE institution_id=$1 AND account_id=$2", [i, student.account]);
  await setConsentRequired(admin, false);
});
