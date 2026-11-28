// covers: AD-019, ID-008, AD-011, AD-012, SL-014, SL-009, ID-004, ID-006
import "../scripts/environment";
import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { db } from "../lib/db";
import { WorkflowError } from "../lib/assignments";
import { grantDelegation, hasDuty, revokeDelegation } from "../lib/delegation";
import { draftExam, examOptions, exams, publishExam } from "../lib/exams";
import { addCalendarEntry } from "../lib/calendar";
import { certificates, draftCertificate, issueCertificate, revokeCertificate, verifyCertificate } from "../lib/certificates";
import { createStudyGroup, joinStudyGroup, leaveStudyGroup, readProfile, saveProfile, studyGroups } from "../lib/student-life";
import { fixtures, demoEmail, personas } from "../scripts/fixtures";
import type { Scope } from "../lib/scope";

const owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const as = new Map<string, Scope>();
const i = fixtures.institution;
const tag = randomUUID().slice(0, 8);
const room = randomUUID();
const rejects = (run: () => Promise<unknown>, pattern?: RegExp) =>
  assert.rejects(async () => run(), (e: unknown) => (e instanceof WorkflowError || (e as Error).name === "ZodError") && (!pattern || pattern.test((e as Error).message)));
const at = (days: number, hour: number) =>
  `${new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(Date.now() + days * 86400000))}T${String(hour).padStart(2, "0")}:00`;

before(async () => {
  for (const url of [process.env.MIGRATION_DATABASE_URL, process.env.DATABASE_URL]) assert.ok(url && ["127.0.0.1", "localhost"].includes(new URL(url).hostname));
  for (const [alias, [, , role]] of Object.entries(personas)) {
    const { rows: [row] } = await owner.query('SELECT id FROM "user" WHERE email=$1', [demoEmail(alias)]);
    as.set(alias, { account: row.id, role, institution: alias === "tenant" ? fixtures.otherInstitution : fixtures.institution });
  }
  await owner.query("INSERT INTO campus_resource (institution_id,id,name,kind,location,capacity) VALUES ($1,$2,$3,'room','Fictional',40)", [i, room, `Delegation hall ${tag}`]);
  await owner.query("INSERT INTO roster (institution_id,offering_id,account_id,role) VALUES ($1,$2,$3,'student') ON CONFLICT DO NOTHING", [i, fixtures.offering, as.get("outsider")!.account]);
});
after(async () => {
  await owner.query("DELETE FROM exam_sitting WHERE institution_id=$1 AND room_id=$2", [i, room]);
  await owner.query("DELETE FROM campus_resource WHERE institution_id=$1 AND id=$2", [i, room]);
  await owner.query("DELETE FROM delegation WHERE institution_id=$1 AND reason LIKE $2", [i, `% ${tag}`]);
  await owner.query("DELETE FROM calendar_entry WHERE institution_id=$1 AND title LIKE $2", [i, `% ${tag}`]);
  await owner.query("DELETE FROM certificate WHERE institution_id=$1 AND student_id=$2", [i, as.get("student")!.account]);
  await owner.query("DELETE FROM study_group_member WHERE institution_id=$1 AND group_id IN (SELECT id FROM study_group WHERE institution_id=$1 AND name LIKE $2)", [i, `% ${tag}`]);
  await owner.query("DELETE FROM study_group WHERE institution_id=$1 AND name LIKE $2", [i, `% ${tag}`]);
  await owner.query("DELETE FROM student_profile WHERE institution_id=$1 AND student_id=$2", [i, as.get("student")!.account]);
  await owner.query("DELETE FROM roster WHERE institution_id=$1 AND offering_id=$2 AND account_id=$3 AND role='student'", [i, fixtures.offering, as.get("outsider")!.account]);
  await Promise.all([db.end(), owner.end()]);
});

test("a delegated exam-cell duty lets a teacher run sittings until it is revoked or expires", async () => {
  const admin = as.get("admin")!, faculty = as.get("faculty")!;
  const sitting = () => draftExam(faculty, { offering: fixtures.offering, kind: "internal", title: `Delegated CIE ${tag}`, start: at(12, 10), end: at(12, 11),
    room, invigilator: as.get("replacement")!.account });
  assert.equal(await examOptions(faculty), null);
  await rejects(sitting);
  await rejects(() => grantDelegation(as.get("hod")!, { duty: "exam_cell", delegate: faculty.account, days: 1, reason: `x ${tag}` }));
  await rejects(() => grantDelegation(admin, { duty: "exam_cell", delegate: as.get("student")!.account, days: 1, reason: `x ${tag}` }), /faculty member or department head/);
  const delegation = await grantDelegation(admin, { duty: "exam_cell", delegate: faculty.account, days: 1, reason: `Exam week cover ${tag}` });
  assert.ok(await examOptions(faculty));
  const id = await sitting();
  assert.ok((await exams(faculty)).some(e => e.id === id && e.state === "draft"), "the delegate sees drafts while the duty lasts");
  await publishExam(faculty, { exam: id, revision: 1 });
  assert.equal(await hasDuty(as.get("replacement")!, "exam_cell"), false, "a duty is personal");
  await revokeDelegation(admin, delegation);
  await rejects(() => revokeDelegation(admin, delegation), /not active/);
  assert.equal(await hasDuty(faculty, "exam_cell"), false);
  await rejects(sitting);
  const expired = await grantDelegation(admin, { duty: "exam_cell", delegate: faculty.account, days: 1, reason: `Short cover ${tag}` });
  await owner.query("UPDATE delegation SET starts_at=now()-interval '2 days',expires_at=now()-interval '1 second' WHERE institution_id=$1 AND id=$2", [i, expired]);
  assert.equal(await hasDuty(faculty, "exam_cell"), false, "an expired duty grants nothing");
  const actions = (await owner.query("SELECT action FROM audit_event WHERE institution_id=$1 AND entity_id=$2 ORDER BY id", [i, delegation])).rows.map(r => r.action);
  assert.deepEqual(actions, ["delegation.granted", "delegation.revoked"]);
});

test("a calendar duty lets a department head publish institution dates", async () => {
  const hod = as.get("hod")!;
  await rejects(() => addCalendarEntry(hod, { title: `Open day ${tag}`, kind: "event", from: at(3, 0).slice(0, 10), to: at(3, 0).slice(0, 10) }));
  await grantDelegation(as.get("admin")!, { duty: "calendar", delegate: hod.account, days: 7, reason: `Calendar cover ${tag}` });
  assert.ok(await addCalendarEntry(hod, { title: `Open day ${tag}`, kind: "event", from: at(3, 0).slice(0, 10), to: at(3, 0).slice(0, 10) }));
});

test("certificates are drafted from records, issued with a code, verifiable publicly, and revocable", async () => {
  const admin = as.get("admin")!, student = as.get("student")!;
  await rejects(() => draftCertificate(as.get("faculty")!, { student: student.account, kind: "bonafide" }));
  await rejects(() => draftCertificate(admin, { student: as.get("faculty")!.account, kind: "bonafide" }), /current student/);
  const id = await draftCertificate(admin, { student: student.account, kind: "bonafide" });
  const draft = (await certificates(admin)).find(c => c.id === id)!;
  assert.match(draft.body, /This is to certify that Asha Sen is a current student enrolled in:\n• Introduction to Programming · Section A · Term 1/);
  assert.ok(draft.sources.includes(`offering:${fixtures.offering}`));
  assert.ok(!(await certificates(student)).some(c => c.id === id), "students do not see drafts");
  const code = await issueCertificate(admin, id);
  assert.match(code, /^[0-9A-F]{12}$/);
  await rejects(() => issueCertificate(admin, id), /not a draft/);
  assert.equal((await certificates(student)).find(c => c.id === id)?.verification_code, code);
  assert.deepEqual(await verifyCertificate(code).then(v => [v?.state, v?.holder, v?.kind]), ["issued", "A. S.", "bonafide"]);
  assert.equal(await verifyCertificate("NOTAREALCODE"), null);
  await revokeCertificate(admin, { certificate: id, reason: "Issued in error" });
  assert.equal((await verifyCertificate(code))?.state, "revoked");
  await draftCertificate(admin, { student: student.account, kind: "attendance" });
  await draftCertificate(admin, { student: student.account, kind: "results" });
  assert.ok((await certificates(admin)).some(c => c.kind === "attendance" && /recorded attendance/.test(c.body)));
  assert.ok((await certificates(admin)).some(c => c.kind === "results" && /published results/.test(c.body)));
  assert.deepEqual(await certificates(as.get("faculty")!), []);
});

test("study groups are opt-in, limited to the course roster and capacity", async () => {
  const student = as.get("student")!, classmate = as.get("outsider")!;
  await rejects(() => createStudyGroup({ ...as.get("tenant")!, institution: fixtures.institution }, { offering: fixtures.offering, name: `x ${tag}`, capacity: 2 }));
  const group = await createStudyGroup(student, { offering: fixtures.offering, name: `Recursion drills ${tag}`, capacity: 2 });
  await rejects(() => createStudyGroup(student, { offering: fixtures.offering, name: `Recursion drills ${tag}`, capacity: 2 }), /already exists/);
  await rejects(() => joinStudyGroup(student, group), /already in this group/);
  await joinStudyGroup(classmate, group);
  assert.deepEqual((await studyGroups(student)).find(g => g.id === group)?.members.length, 2);
  await leaveStudyGroup(classmate, group);
  assert.equal((await studyGroups(student)).find(g => g.id === group)?.members.length, 1);
  assert.deepEqual(await studyGroups(as.get("faculty")!), []);
});

test("profiles are readable only by the audience the student chose", async () => {
  const student = as.get("student")!, faculty = as.get("faculty")!, classmate = as.get("outsider")!;
  await rejects(() => saveProfile(faculty, { bio: "x", interests: "", visibility: "private" }));
  await saveProfile(student, { bio: "Fictional: likes robotics", interests: "robotics, chess", visibility: "private" });
  assert.equal((await readProfile(student, student.account))?.bio, "Fictional: likes robotics");
  assert.equal(await readProfile(faculty, student.account), null);
  await saveProfile(student, { bio: "Fictional: likes robotics", interests: "robotics, chess", visibility: "teachers" });
  assert.equal((await readProfile(faculty, student.account))?.interests, "robotics, chess");
  assert.equal(await readProfile(classmate, student.account), null, "classmates need the classmates setting");
  assert.equal(await readProfile(as.get("replacement")!, student.account), null, "a teacher without a shared course cannot read it");
  await saveProfile(student, { bio: "Fictional: likes robotics", interests: "robotics, chess", visibility: "classmates" });
  assert.ok(await readProfile(classmate, student.account));
  assert.equal(await readProfile(as.get("tenant")!, student.account), null);
});
