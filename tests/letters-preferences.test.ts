// covers: AD-020, SL-010, SL-011, SL-015, ID-004, ID-006
import "../scripts/environment";
import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { db } from "../lib/db";
import { WorkflowError } from "../lib/assignments";
import { assignCase, cases, closeCase, openCase } from "../lib/cases";
import { notifications } from "../lib/automation";
import { preferences, savePreferences } from "../lib/preferences";
import { publishService, supportServices, withdrawService } from "../lib/support-services";
import { createStudyGroup, joinStudyGroup, studyGroups } from "../lib/student-life";
import { fixtures, demoEmail, personas } from "../scripts/fixtures";
import type { Scope } from "../lib/scope";

const owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const as = new Map<string, Scope>();
const i = fixtures.institution;
const tag = randomUUID().slice(0, 8);
const rejects = (run: () => Promise<unknown>, pattern?: RegExp) =>
  assert.rejects(async () => run(), (e: unknown) => (e instanceof WorkflowError || (e as Error).name === "ZodError") && (!pattern || pattern.test((e as Error).message)));
const quiet = { large_text: false, reduced_motion: false, discoverable: true, muted_kinds: [] as string[] };

before(async () => {
  for (const url of [process.env.MIGRATION_DATABASE_URL, process.env.DATABASE_URL]) assert.ok(url && ["127.0.0.1", "localhost"].includes(new URL(url).hostname));
  for (const [alias, [, , role]] of Object.entries(personas)) {
    const { rows: [row] } = await owner.query('SELECT id FROM "user" WHERE email=$1', [demoEmail(alias)]);
    as.set(alias, { account: row.id, role, institution: alias === "tenant" ? fixtures.otherInstitution : fixtures.institution });
  }
  // The outsider joins the student's offering for the study-group discovery check, and leaves in `after`.
  await owner.query("INSERT INTO roster (institution_id,offering_id,account_id,role) VALUES ($1,$2,$3,'student') ON CONFLICT DO NOTHING", [i, fixtures.offering, as.get("outsider")!.account]);
});
after(async () => {
  const caseIds = (await owner.query("SELECT id FROM case_record WHERE institution_id=$1 AND title LIKE $2", [i, `% ${tag}`])).rows.map(r => r.id);
  await owner.query("DELETE FROM notification WHERE institution_id=$1 AND entity_id=ANY($2)", [i, caseIds]);
  await owner.query("DELETE FROM job WHERE institution_id=$1 AND event_id IN (SELECT id FROM audit_event WHERE institution_id=$1 AND entity_id=ANY($2))", [i, caseIds]);
  await owner.query("DELETE FROM case_note WHERE institution_id=$1 AND case_id=ANY($2)", [i, caseIds]);
  await owner.query("DELETE FROM case_record WHERE institution_id=$1 AND id=ANY($2)", [i, caseIds]);
  await owner.query("DELETE FROM account_preference WHERE institution_id=$1", [i]);
  await owner.query("DELETE FROM support_service WHERE institution_id=$1 AND name LIKE $2", [i, `% ${tag}`]);
  await owner.query("DELETE FROM study_group_member WHERE institution_id=$1 AND group_id IN (SELECT id FROM study_group WHERE institution_id=$1 AND name LIKE $2)", [i, `% ${tag}`]);
  await owner.query("DELETE FROM study_group WHERE institution_id=$1 AND name LIKE $2", [i, `% ${tag}`]);
  await owner.query("DELETE FROM roster WHERE institution_id=$1 AND offering_id=$2 AND account_id=$3 AND role='student'", [i, fixtures.offering, as.get("outsider")!.account]);
  await Promise.all([db.end(), owner.end()]);
});

test("a submitted letter is a case only its sender and the office read, with the shared owner and outcome rules", async () => {
  const student = as.get("student")!, admin = as.get("admin")!, faculty = as.get("faculty")!;
  await rejects(() => openCase(admin, { kind: "letter", title: `x ${tag}`, body: "x" }));
  await rejects(() => openCase(as.get("principal")!, { kind: "letter", title: `x ${tag}`, body: "x" }));
  await rejects(() => openCase(student, { kind: "letter", title: `x ${tag}`, body: "" }));
  const id = await openCase(student, { kind: "letter", title: `Leave request ${tag}`, body: "Fictional: two days of leave." });
  const facultyLetter = await openCase(faculty, { kind: "letter", title: `Permission request ${tag}`, body: "Fictional: conference visit." });
  assert.ok((await cases(student, "letter")).some(c => c.id === id));
  assert.ok((await cases(admin, "letter")).some(c => c.id === id && c.opener === "Asha Sen"));
  assert.ok((await cases(admin, "letter")).some(c => c.id === facultyLetter));
  for (const other of [as.get("outsider")!, faculty, as.get("hod")!]) assert.ok(!(await cases(other, "letter")).some(c => c.id === id), "nobody else reads it");
  assert.ok(!(await cases({ ...as.get("tenant")!, role: "admin" }, "letter")).some(c => c.id === id));
  await rejects(() => assignCase(as.get("hod")!, { case: id, assignee: admin.account }));
  await assignCase(admin, { case: id, assignee: admin.account });
  await closeCase(admin, { case: id, outcome: "resolved", reason: "Leave approved for the requested dates" });
  assert.equal((await cases(student, "letter")).find(c => c.id === id)?.outcome, "Leave approved for the requested dates");
  const { rows: [{ count }] } = await owner.query("SELECT count(*)::int FROM audit_event WHERE institution_id=$1 AND entity_id=$2", [i, id]);
  assert.equal(count, 3, "open, assign and close are audited");
});

test("muting a notification kind hides it from that member only, without touching the record", async () => {
  const student = as.get("student")!;
  const id = await openCase(student, { kind: "letter", title: `Muted check ${tag}`, body: "Fictional" });
  const { rows: [event] } = await owner.query("SELECT id FROM audit_event WHERE institution_id=$1 AND entity_id=$2 ORDER BY id LIMIT 1", [i, id]);
  await owner.query("INSERT INTO notification (institution_id,recipient_id,event_id,kind,entity_id,title) VALUES ($1,$2,$3,'case',$4,$5)",
    [i, student.account, event.id, id, `Letter received ${tag}`]);
  assert.ok((await notifications(student)).some(n => n.entity_id === id));
  await savePreferences(student, { ...quiet, muted_kinds: ["case", "case"] });
  assert.deepEqual((await preferences(student)).muted_kinds, ["case"]);
  assert.ok(!(await notifications(student)).some(n => n.entity_id === id));
  assert.ok((await cases(student, "letter")).some(c => c.id === id), "the case itself is unchanged");
  await savePreferences(student, quiet);
  assert.ok((await notifications(student)).some(n => n.entity_id === id));
  await rejects(() => savePreferences(student, { ...quiet, muted_kinds: ["payroll"] }));
  await rejects(() => savePreferences({ ...student, role: "admin" }, quiet), /unavailable/);
});

test("display preferences are per member and per institution, and discovery hides a student's name in study groups", async () => {
  const student = as.get("student")!, classmate = as.get("outsider")!;
  await savePreferences(student, { ...quiet, large_text: true, reduced_motion: true });
  assert.deepEqual(await preferences(student), { large_text: true, reduced_motion: true, discoverable: true, muted_kinds: [] });
  assert.equal((await preferences(classmate)).large_text, false);
  const group = await createStudyGroup(classmate, { offering: fixtures.offering, name: `Revision ${tag}`, capacity: 4 });
  await joinStudyGroup(student, group);
  assert.ok((await studyGroups(classmate)).find(g => g.id === group)!.members.some(m => m.name === "Asha Sen"));
  await savePreferences(student, { ...quiet, discoverable: false });
  const members = (await studyGroups(classmate)).find(g => g.id === group)!.members;
  assert.ok(!members.some(m => m.name === "Asha Sen" || m.id === student.account));
  assert.ok(members.some(m => m.name === "A classmate" && m.id === null));
  assert.ok((await studyGroups(student)).find(g => g.id === group)!.members.some(m => m.id === student.account), "a student always sees themself");
});

test("support services are published and withdrawn by the office and listed to every current member by category", async () => {
  const admin = as.get("admin")!;
  const service = { category: "accessibility", name: `Assistive technology desk ${tag}`, description: "Fictional: screen readers and exam scribes.", contact: "Room 104", hours: "Mon–Fri 9:30–16:30" };
  for (const alias of ["student", "faculty", "hod", "principal"]) await rejects(() => publishService(as.get(alias)!, service), /unavailable/);
  await rejects(() => publishService(admin, { ...service, category: "parking" }));
  const id = await publishService(admin, service);
  for (const alias of ["student", "faculty", "hod", "principal"]) assert.ok((await supportServices(as.get(alias)!)).some(s => s.id === id));
  assert.ok((await supportServices(as.get("student")!, "accessibility")).some(s => s.id === id));
  assert.ok(!(await supportServices(as.get("student")!, "health")).some(s => s.id === id));
  assert.ok(!(await supportServices({ ...as.get("tenant")!, role: "admin" })).some(s => s.id === id));
  assert.ok(!(await supportServices({ ...as.get("student")!, role: "admin" })).some(s => s.id === id), "a role without membership sees nothing");
  await rejects(() => withdrawService(as.get("student")!, id));
  await withdrawService(admin, id);
  await rejects(() => withdrawService(admin, id), /already withdrawn/);
  assert.ok(!(await supportServices(as.get("student")!)).some(s => s.id === id));
});
