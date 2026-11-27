// covers: SA-015, SA-016, AD-009, AD-029, LE-008, LE-010, LE-011, DH-025, FC-019, ID-004, ID-006
import "../scripts/environment";
import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { db } from "../lib/db";
import { WorkflowError } from "../lib/assignments";
import { cancelExam, draftExam, examIssues, exams, publishExam, type Sitting } from "../lib/exams";
import { actionMeasures, createAction, improvementActions, updateAction } from "../lib/improvement";
import { calendar } from "../lib/calendar";
import { facultyWorkload } from "../lib/department";
import { fixtures, demoEmail, personas } from "../scripts/fixtures";
import type { Scope } from "../lib/scope";

const owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const as = new Map<string, Scope>();
const i = fixtures.institution;
const rooms = [randomUUID(), randomUUID()];
const rejects = (run: () => Promise<unknown>, pattern?: RegExp) =>
  assert.rejects(async () => run(), (e: unknown) => (e instanceof WorkflowError || (e as Error).name === "ZodError") && (!pattern || pattern.test((e as Error).message)));
// Institution-local wall time `days` from now at the given hour, in the form the draft form submits.
const at = (days: number, hour: number) => {
  const d = new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(Date.now() + days * 86400000));
  return `${d}T${String(hour).padStart(2, "0")}:00`;
};

before(async () => {
  for (const url of [process.env.MIGRATION_DATABASE_URL, process.env.DATABASE_URL]) assert.ok(url && ["127.0.0.1", "localhost"].includes(new URL(url).hostname));
  for (const [alias, [, , role]] of Object.entries(personas)) {
    const { rows: [row] } = await owner.query('SELECT id FROM "user" WHERE email=$1', [demoEmail(alias)]);
    as.set(alias, { account: row.id, role, institution: alias === "tenant" ? fixtures.otherInstitution : fixtures.institution });
  }
  for (const [n, id] of rooms.entries()) await owner.query("INSERT INTO campus_resource (institution_id,id,name,kind,location,capacity) VALUES ($1,$2,$3,'room','Fictional exam block',60)", [i, id, `Exam hall ${id.slice(0, 6)} ${n}`]);
});
after(async () => {
  await owner.query("DELETE FROM exam_sitting WHERE institution_id=$1 AND room_id=ANY($2)", [i, rooms]);
  await owner.query("DELETE FROM class_session WHERE institution_id=$1 AND room_id=ANY($2)", [i, rooms]);
  await owner.query("DELETE FROM campus_resource WHERE institution_id=$1 AND id=ANY($2)", [i, rooms]);
  await owner.query("DELETE FROM improvement_update WHERE institution_id=$1 AND action_id IN (SELECT id FROM improvement_action WHERE institution_id=$1 AND title LIKE 'Test action %')", [i]);
  await owner.query("DELETE FROM improvement_action WHERE institution_id=$1 AND title LIKE 'Test action %'", [i]);
  await Promise.all([db.end(), owner.end()]);
});

const draft = (overrides: Record<string, unknown> = {}) => draftExam(as.get("admin")!, { offering: fixtures.offering, kind: "internal", title: "CIE 1",
  start: at(3, 10), end: at(3, 11), room: rooms[0], invigilator: as.get("faculty")!.account, ...overrides });
const find = async (alias: string, id: string) => (await exams(as.get(alias)!)).find(e => e.id === id);

test("the office drafts and publishes a sitting; only rostered students, the invigilator and the department see it", async () => {
  for (const alias of ["faculty", "hod", "principal", "student"]) await rejects(() => draftExam(as.get(alias)!, { offering: fixtures.offering, kind: "internal",
    title: "x", start: at(3, 10), end: at(3, 11), room: rooms[0], invigilator: as.get("faculty")!.account }));
  await rejects(() => draft({ kind: "external" }), /official source/);
  await rejects(() => draft({ start: at(-1, 10), end: at(-1, 11) }));
  await rejects(() => draft({ invigilator: as.get("student")!.account }));
  const id = await draft();
  assert.equal(await find("student", id), undefined, "drafts are private to the office");
  await rejects(() => publishExam(as.get("admin")!, { exam: id, revision: 2 }), /changed/);
  await publishExam(as.get("admin")!, { exam: id, revision: 1 });
  assert.equal((await find("student", id))?.state, "published");
  assert.equal((await find("faculty", id))?.invigilator, "Riya Rao");
  assert.ok(await find("hod", id) && await find("principal", id));
  for (const alias of ["outsider", "replacement", "tenant"]) assert.equal(await find(alias, id), undefined);
  const month = at(3, 10).slice(0, 7);
  assert.ok((await calendar(as.get("student")!, { month, kind: "exam" })).some(e => e.id === id));
  assert.ok((await calendar(as.get("faculty")!, { month })).some(e => e.id === id), "the invigilator's calendar shows the duty");
  const external = await draft({ kind: "external", title: "SEE", start: at(4, 10), end: at(4, 12), source: "Fictional university circular 12/2026" });
  await publishExam(as.get("admin")!, { exam: external, revision: 1 });
  assert.equal((await find("student", external))?.source, "Fictional university circular 12/2026");
  await cancelExam(as.get("admin")!, { exam: external, reason: "Rescheduled by the university" });
  assert.deepEqual([(await find("student", external))?.state, (await find("student", external))?.change_reason], ["cancelled", "Rescheduled by the university"]);
  const actions = (await owner.query("SELECT action FROM audit_event WHERE institution_id=$1 AND entity_id=$2 ORDER BY id", [i, external])).rows.map(r => r.action);
  assert.deepEqual(actions, ["exam.drafted", "exam.published", "exam.cancelled"]);
});

test("publication refuses section, room, invigilator and class conflicts", async () => {
  const base = await draft({ start: at(5, 9), end: at(5, 11) });
  await publishExam(as.get("admin")!, { exam: base, revision: 1 });
  const section = await draft({ start: at(5, 10), end: at(5, 12), room: rooms[1], invigilator: as.get("replacement")!.account });
  await rejects(() => publishExam(as.get("admin")!, { exam: section, revision: 1 }), /section/);
  const room = await draft({ offering: fixtures.otherOffering, start: at(5, 10), end: at(5, 12), invigilator: as.get("replacement")!.account });
  await rejects(() => publishExam(as.get("admin")!, { exam: room, revision: 1 }), /room/);
  const person = await draft({ offering: fixtures.otherOffering, start: at(5, 10), end: at(5, 12), room: rooms[1] });
  await rejects(() => publishExam(as.get("admin")!, { exam: person, revision: 1 }), /invigilator/);
  await owner.query(`INSERT INTO class_session (institution_id,series_id,offering_id,section_id,faculty_id,room_id,slot,state,created_by,published_at)
    SELECT $1,gen_random_uuid(),o.id,o.section_id,$3,$4,tstzrange($5::timestamp AT TIME ZONE 'Asia/Kolkata',$6::timestamp AT TIME ZONE 'Asia/Kolkata'),'published',$3,now()
    FROM offering o WHERE o.institution_id=$1 AND o.id=$2`, [i, fixtures.otherOffering, as.get("replacement")!.account, rooms[1], at(6, 9), at(6, 10)]);
  const clash = await draft({ offering: fixtures.otherOffering, start: at(6, 9), end: at(6, 10), room: rooms[1] });
  await rejects(() => publishExam(as.get("admin")!, { exam: clash, revision: 1 }), /room has a class/);
});

test("operational issues flag invigilators without a post and rooms smaller than the cohort", () => {
  const sitting = { id: "x", state: "published", start: new Date(Date.now() + 86400000), invigilator_id: "gone", capacity: 2, enrolled: 3 } as Sitting;
  assert.deepEqual(examIssues([sitting], new Set(["someone"])).map(x => x.issue), ["Invigilator no longer holds a faculty post", "Room seats 2; 3 students enrolled"]);
  assert.deepEqual(examIssues([{ ...sitting, invigilator_id: "someone", enrolled: 1 }], new Set(["someone"])), []);
  assert.deepEqual(examIssues([{ ...sitting, start: new Date(Date.now() - 1000) }], new Set()), [], "past sittings are not open issues");
});

test("improvement actions have one owner who records progress; overdue and on-time are measured", async () => {
  const principal = as.get("principal")!, hod = as.get("hod")!, faculty = as.get("faculty")!;
  const due = at(30, 0).slice(0, 10);
  await rejects(() => createAction(faculty, { title: "Test action x", measure: "m", owner: faculty.account, due }));
  await rejects(() => createAction(principal, { title: "Test action x", measure: "m", owner: faculty.account, due }), /owner/);
  const id = await createAction(principal, { title: "Test action institution", measure: "Results published within 7 days", owner: hod.account, due });
  assert.ok((await improvementActions(as.get("admin")!)).some(a => a.id === id), "institution actions are visible to leadership and the office");
  assert.ok(!(await improvementActions(faculty)).some(a => a.id === id));
  await rejects(() => updateAction(principal, { action: id, progress: 50, note: "Not the owner" }));
  await updateAction(hod, { action: id, progress: 40, note: "Two of five courses on track" });
  await owner.query("UPDATE improvement_action SET due_on=current_date-1 WHERE institution_id=$1 AND id=$2", [i, id]);
  assert.equal((await improvementActions(principal)).find(a => a.id === id)?.overdue, true);
  await updateAction(hod, { action: id, progress: 80, note: "All courses now on track", close: "done" });
  const closed = (await improvementActions(principal)).find(a => a.id === id)!;
  assert.deepEqual([closed.state, closed.progress, closed.overdue, closed.updates.length], ["done", 100, false, 2]);
  assert.equal(actionMeasures([closed]).onTime, 0, "closed after its due date");
  await rejects(() => updateAction(hod, { action: id, progress: 10, note: "Reopen" }));

  const dept = await createAction(hod, { title: "Test action department", measure: "Lab attendance above 85%", owner: faculty.account, department: fixtures.department, due });
  await rejects(() => createAction(hod, { title: "Test action other", measure: "m", owner: faculty.account, department: fixtures.otherDepartment, due }));
  await updateAction(faculty, { action: dept, progress: 20, note: "Started reminders" });
  assert.equal((await improvementActions(faculty)).find(a => a.id === dept)?.progress, 20);
  assert.ok((await improvementActions(principal)).some(a => a.id === dept));
  for (const alias of ["replacement", "student", "admin"]) assert.ok(!(await improvementActions(as.get(alias)!)).some(a => a.id === dept));
  assert.deepEqual(await improvementActions(as.get("tenant")!), []);
});

test("faculty workload includes current mentees", async () => {
  const before = (await facultyWorkload(as.get("faculty")!))!.mentees;
  const { rows: [pair] } = await owner.query("INSERT INTO mentor_assignment (institution_id,mentor_id,student_id,assigned_by) VALUES ($1,$2,$3,$4) RETURNING id",
    [i, as.get("faculty")!.account, as.get("outsider")!.account, as.get("admin")!.account]);
  try {
    assert.equal((await facultyWorkload(as.get("faculty")!))!.mentees, before + 1);
  } finally {
    await owner.query("DELETE FROM mentor_assignment WHERE institution_id=$1 AND id=$2", [i, pair.id]);
  }
});
