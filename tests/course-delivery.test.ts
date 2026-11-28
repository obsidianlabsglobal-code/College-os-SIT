// covers: SA-018, FC-020, FC-006, DH-005, DH-011, DH-022, FC-016, LE-019, ID-004, ID-006
import "../scripts/environment";
import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { db } from "../lib/db";
import { WorkflowError } from "../lib/assignments";
import { addResource, coursePlan, courseResources, decidePlan, departmentDelivery, deliverySessions, recordDelivery, resourceFile,
  reviseResource, savePlan, submitPlan, withdrawResource } from "../lib/course-delivery";
import { addMentoringRecord, agreeGoal, assignMentor, mentorOptions, mentorships } from "../lib/mentoring";
import { executiveReport } from "../lib/exports";
import { fixtures, demoEmail, personas } from "../scripts/fixtures";
import type { Scope } from "../lib/scope";

const owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const as = new Map<string, Scope>();
const i = fixtures.institution, offering = fixtures.offering;
const ids = { room: randomUUID(), session: randomUUID() };
const file = (text: string) => ({ filename: "notes.txt", mime: "text/plain", bytes: Buffer.from(text) });
const rejects = (run: () => Promise<unknown>) => assert.rejects(async () => run(), (e: unknown) => e instanceof WorkflowError || (e as Error).name === "ZodError");

async function clearPlan() {
  await owner.query("DELETE FROM class_delivery WHERE institution_id=$1 AND session_id IN (SELECT id FROM class_session WHERE institution_id=$1 AND offering_id=$2)", [i, offering]);
  await owner.query("DELETE FROM course_plan_item WHERE institution_id=$1 AND offering_id=$2", [i, offering]);
  await owner.query("DELETE FROM course_plan WHERE institution_id=$1 AND offering_id=$2", [i, offering]);
}
async function clearMentoring() {
  const student = as.get("student")!.account;
  await owner.query("DELETE FROM mentoring_record WHERE institution_id=$1 AND assignment_id IN (SELECT id FROM mentor_assignment WHERE institution_id=$1 AND student_id=$2)", [i, student]);
  await owner.query("DELETE FROM mentor_assignment WHERE institution_id=$1 AND student_id=$2", [i, student]);
}

before(async () => {
  for (const url of [process.env.MIGRATION_DATABASE_URL, process.env.DATABASE_URL]) assert.ok(url && ["127.0.0.1", "localhost"].includes(new URL(url).hostname));
  for (const [alias, [, , role]] of Object.entries(personas)) {
    const { rows: [row] } = await owner.query('SELECT id FROM "user" WHERE email=$1', [demoEmail(alias)]);
    as.set(alias, { account: row.id, role, institution: alias === "tenant" ? fixtures.otherInstitution : fixtures.institution });
  }
  await clearPlan(); await clearMentoring();
  const faculty = as.get("faculty")!.account;
  await owner.query("INSERT INTO campus_resource (institution_id,id,name,kind,location) VALUES ($1,$2,'Delivery room','room','Fictional')", [i, ids.room]);
  await owner.query(`INSERT INTO class_session (institution_id,id,series_id,offering_id,section_id,faculty_id,room_id,slot,state,created_by,published_at)
    SELECT $1,$2,gen_random_uuid(),$3,o.section_id,$4,$5,tstzrange(now()-interval '3 hours',now()-interval '2 hours'),'conducted',$4,now()
    FROM offering o WHERE o.institution_id=$1 AND o.id=$3`, [i, ids.session, offering, faculty, ids.room]);
});
after(async () => {
  await clearPlan(); await clearMentoring();
  await owner.query("DELETE FROM course_resource_version WHERE institution_id=$1 AND resource_id IN (SELECT id FROM course_resource WHERE institution_id=$1 AND title LIKE 'Delivery test %')", [i]);
  await owner.query("DELETE FROM course_resource WHERE institution_id=$1 AND title LIKE 'Delivery test %'", [i]);
  await owner.query("DELETE FROM class_session WHERE institution_id=$1 AND id=$2", [i, ids.session]);
  await owner.query("DELETE FROM campus_resource WHERE institution_id=$1 AND id=$2", [i, ids.room]);
  await Promise.all([db.end(), owner.end()]);
});

test("course materials are versioned; students get the latest only and outsiders get nothing", async () => {
  const faculty = as.get("faculty")!, student = as.get("student")!;
  const title = `Delivery test ${randomUUID().slice(0, 8)}`;
  for (const alias of ["student", "replacement", "hod", "admin"]) await rejects(() => addResource(as.get(alias)!, { offering, title }, file("x")));
  await rejects(() => addResource(faculty, { offering, title }, null));
  const id = await addResource(faculty, { offering, title, note: "Week 1" }, file("version one"));
  assert.equal(await reviseResource(faculty, { resource: id, note: "Fixed a typo" }, file("version two")), 2);
  await rejects(() => reviseResource(as.get("replacement")!, { resource: id, note: "No" }, file("x")));
  const listed = (await courseResources(student, offering)).find(r => r.id === id);
  assert.deepEqual([listed?.version, listed?.note], [2, "Fixed a typo"]);
  assert.equal((await resourceFile(student, id))?.bytes.toString(), "version two");
  assert.equal((await resourceFile(student, id, 1))?.bytes.toString(), "version two", "students cannot pick an earlier version");
  assert.equal((await resourceFile(faculty, id, 1))?.bytes.toString(), "version one");
  assert.ok((await courseResources(as.get("hod")!, offering)).some(r => r.id === id), "the department head can read it");
  for (const alias of ["outsider", "tenant", "admin", "principal", "replacement"]) {
    assert.equal(await resourceFile(as.get(alias)!, id), null);
    assert.ok(!(await courseResources(as.get(alias)!, offering)).some(r => r.id === id));
  }
  await withdrawResource(faculty, id);
  assert.equal(await resourceFile(student, id), null);
  await rejects(() => reviseResource(faculty, { resource: id, note: "After withdrawal" }, file("x")));
  const actions = (await owner.query("SELECT action FROM audit_event WHERE institution_id=$1 AND entity_id=$2 ORDER BY id", [i, id])).rows.map(r => r.action);
  assert.deepEqual(actions, ["course_resource.added", "course_resource.revised", "course_resource.withdrawn"]);
});

test("a course plan is drafted by the teacher, approved by the department head, and delivery counts toward coverage", async () => {
  const faculty = as.get("faculty")!, hod = as.get("hod")!, student = as.get("student")!;
  await rejects(() => savePlan(as.get("replacement")!, { offering, topics: ["X"] }));
  await rejects(() => savePlan(faculty, { offering, topics: [] }));
  await savePlan(faculty, { offering, topics: ["Variables", "Control flow", "Functions"] });
  assert.equal((await coursePlan(student, offering))?.items.length, 0, "students see nothing before approval");
  await rejects(() => decidePlan(hod, { offering, decision: "approve", reason: "Not submitted" }));
  await submitPlan(faculty, offering);
  await rejects(() => savePlan(faculty, { offering, topics: ["Changed while waiting"] }));
  for (const alias of ["faculty", "principal", "admin"]) await rejects(() => decidePlan(as.get(alias)!, { offering, decision: "approve", reason: "No" }));
  await rejects(() => decidePlan(hod, { offering: fixtures.otherDepartmentOffering, decision: "approve", reason: "Other department" }));
  await decidePlan(hod, { offering, decision: "return", reason: "Add assessment weeks" });
  assert.deepEqual([(await coursePlan(faculty, offering))?.state, (await coursePlan(faculty, offering))?.decision_reason], ["returned", "Add assessment weeks"]);
  await savePlan(faculty, { offering, topics: ["Variables", "Control flow", "Functions", "Assessment week"] });
  await submitPlan(faculty, offering);
  await decidePlan(hod, { offering, decision: "approve", reason: "Matches the scheme" });
  const plan = (await coursePlan(student, offering))!;
  assert.deepEqual([plan.state, plan.items.map(t => t.topic)], ["approved", ["Variables", "Control flow", "Functions", "Assessment week"]]);
  await rejects(() => savePlan(faculty, { offering, topics: ["After approval"] }));

  assert.ok((await deliverySessions(faculty, offering)).some(s => s.id === ids.session));
  assert.deepEqual(await deliverySessions(as.get("replacement")!, offering), []);
  const before = (await departmentDelivery(hod)).find(r => r.offering === offering)!;
  await rejects(() => recordDelivery(as.get("replacement")!, { session: ids.session, summary: "Not mine" }));
  await rejects(() => recordDelivery(faculty, { session: ids.session, item: randomUUID(), summary: "Unknown topic" }));
  await recordDelivery(faculty, { session: ids.session, item: plan.items[0].id, summary: "Introduced variables" });
  await recordDelivery(faculty, { session: ids.session, item: plan.items[1].id, summary: "Corrected: it was control flow" });
  const after = (await departmentDelivery(hod)).find(r => r.offering === offering)!;
  assert.deepEqual([after.plan, after.topics, after.covered, after.logged - before.logged], ["approved", 4, 1, 1]);
  assert.deepEqual((await coursePlan(faculty, offering))!.items.map(t => t.delivered), [0, 1, 0, 0], "the correction moved coverage, not duplicated it");
  for (const alias of ["faculty", "principal", "admin", "student"]) assert.deepEqual(await departmentDelivery(as.get(alias)!), []);
  assert.equal(await coursePlan(as.get("tenant")!, offering).then(p => p?.items.length ?? 0), 0);
  const actions = (await owner.query("SELECT action,revision FROM audit_event WHERE institution_id=$1 AND entity_id=$2 AND action LIKE 'class.delivery%' ORDER BY id", [i, ids.session])).rows;
  assert.deepEqual(actions.map(r => r.revision), [1, 2]);
});

test("mentoring: an administrator pairs, the mentor records, the student agrees, and others see nothing", async () => {
  const admin = as.get("admin")!, faculty = as.get("faculty")!, student = as.get("student")!;
  for (const alias of ["faculty", "hod", "principal", "student"]) await rejects(() => assignMentor(as.get(alias)!, { student: student.account, mentor: faculty.account }));
  await rejects(() => assignMentor(admin, { student: faculty.account, mentor: faculty.account }));
  const first = await assignMentor(admin, { student: student.account, mentor: as.get("replacement")!.account });
  const pairing = await assignMentor(admin, { student: student.account, mentor: faculty.account });
  await rejects(() => assignMentor(admin, { student: student.account, mentor: faculty.account }));
  assert.ok((await mentorOptions(admin))!.pairs.some(p => p.id === pairing) && !(await mentorOptions(admin))!.pairs.some(p => p.id === first));
  assert.equal(await mentorOptions(faculty), null);
  assert.deepEqual(await mentorships(as.get("replacement")!), [], "the replaced mentor loses access");
  await rejects(() => addMentoringRecord(as.get("replacement")!, { assignment: pairing, kind: "goal", body: "No" }));
  const goal = await addMentoringRecord(faculty, { assignment: pairing, kind: "goal", body: "Submit every lab on time this term" });
  await addMentoringRecord(faculty, { assignment: pairing, kind: "followup", body: "Discussed lab schedule" });
  const seen = (await mentorships(student))[0];
  assert.deepEqual([seen.mentor, seen.records.length, seen.records.find(r => r.id === goal)?.agreed_at], ["Riya Rao", 2, null]);
  await rejects(() => agreeGoal(as.get("outsider")!, goal));
  await agreeGoal(student, goal);
  await rejects(() => agreeGoal(student, goal));
  assert.ok((await mentorships(faculty)).find(p => p.id === pairing)?.records.find(r => r.id === goal)?.agreed_at instanceof Date);
  for (const alias of ["outsider", "hod", "principal", "admin"]) assert.ok(!(await mentorships(as.get(alias)!)).some(p => p.id === pairing));
  assert.deepEqual(await mentorships(as.get("tenant")!), []);
});

test("the executive report names definitions, windows and sources, and only the principal can produce it", async () => {
  const report = (await executiveReport(as.get("principal")!))!;
  const lines = report.trim().split("\r\n");
  assert.equal(lines[0], "section,subject,measure,value,window,definition,source");
  assert.ok(lines.some(l => l.startsWith("report,institution,generated at,")));
  assert.ok(lines.some(l => l.includes(`department:${fixtures.department}`) && l.includes("attendance %")));
  assert.ok(lines.some(l => l.startsWith("operations,service requests,median resolution hours,") && l.includes("last 30 days")));
  for (const alias of ["admin", "hod", "faculty", "student"]) assert.equal(await executiveReport(as.get(alias)!), null);
});
