// covers: SA-021, SA-010, SA-022, FC-028, SA-002, ID-004, ID-006
import "../scripts/environment";
import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { db } from "../lib/db";
import { runJobs, notifications } from "../lib/automation";
import { corrections, decideCorrection, requestCorrection } from "../lib/corrections";
import { calendar } from "../lib/calendar";
import { csv, facultyReport, studentRecord } from "../lib/exports";
import { courseCatalog } from "../lib/catalog";
import { WorkflowError } from "../lib/assignments";
import { fixtures, demoEmail, personas } from "../scripts/fixtures";
import type { Scope } from "../lib/scope";

const owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const as = new Map<string, Scope>();
const i = fixtures.institution;
const ids = { room: randomUUID(), accept: randomUUID(), decline: randomUUID(), assignment: randomUUID() };
let month = "";

async function conductedClass(id: string, daysAgo: number) {
  const faculty = as.get("faculty")!.account, start = new Date(Date.now() - daysAgo * 86400000 - Math.floor(Math.random() * 600) * 60000);
  await owner.query(`INSERT INTO class_session (institution_id,id,series_id,offering_id,section_id,faculty_id,room_id,slot,state,revision,created_by,published_at)
    SELECT $1,$2,gen_random_uuid(),$3,o.section_id,$4,$5,tstzrange($6,$6::timestamptz+interval '5 minutes'),'conducted',2,$4,now()
    FROM offering o WHERE o.institution_id=$1 AND o.id=$3`, [i, id, fixtures.offering, faculty, ids.room, start]);
  await owner.query("INSERT INTO class_attendance_revision (institution_id,session_id,revision,actor_id) VALUES ($1,$2,1,$3)", [i, id, faculty]);
  await owner.query(`INSERT INTO class_attendance_mark (institution_id,session_id,revision,student_id,status)
    SELECT $1,$2,1,r.account_id,CASE WHEN r.account_id=$3 THEN 'absent' ELSE 'present' END FROM roster r
    WHERE r.institution_id=$1 AND r.offering_id=$4 AND r.role='student' AND r.ended_at IS NULL`, [i, id, as.get("student")!.account, fixtures.offering]);
  return start;
}
const rejects = (run: Promise<unknown>) => assert.rejects(run, WorkflowError);
async function eventually<T>(read: () => Promise<T>, ok: (value: T) => boolean) {
  for (let n = 0; n < 40; n++) { await runJobs({ worker: "learning-records-test" }); const value = await read(); if (ok(value)) return value; await new Promise(r => setTimeout(r, 100)); }
  return read();
}

before(async () => {
  for (const url of [process.env.MIGRATION_DATABASE_URL, process.env.DATABASE_URL]) assert.ok(url && ["127.0.0.1", "localhost"].includes(new URL(url).hostname));
  for (const [alias, [, , role]] of Object.entries(personas)) {
    const { rows: [row] } = await owner.query('SELECT id FROM "user" WHERE email=$1', [demoEmail(alias)]);
    as.set(alias, { account: row.id, role, institution: alias === "tenant" ? fixtures.otherInstitution : fixtures.institution });
  }
  await owner.query("INSERT INTO campus_resource (institution_id,id,name,kind,location) VALUES ($1,$2,'Records room','room','Fictional')", [i, ids.room]);
  const start = await conductedClass(ids.accept, 1);
  await conductedClass(ids.decline, 2);
  month = (await owner.query("SELECT to_char($2::timestamptz AT TIME ZONE timezone,'YYYY-MM') AS m FROM institution WHERE id=$1", [i, start])).rows[0].m;
  await owner.query(`INSERT INTO assignment (institution_id,id,offering_id,title,description,deadline,max_marks,published_at)
    VALUES ($1,$2,$3,'Calendar check','Fictional',$4,10,now())`, [i, ids.assignment, fixtures.offering, start]);
});
after(async () => {
  const sessions = [ids.accept, ids.decline];
  const entities = (await owner.query("SELECT id FROM attendance_correction WHERE institution_id=$1 AND session_id=ANY($2)", [i, sessions])).rows.map(r => r.id);
  const all = [...entities, ...sessions, ids.assignment];
  await owner.query("DELETE FROM notification WHERE institution_id=$1 AND entity_id=ANY($2)", [i, all]);
  await owner.query("DELETE FROM job WHERE institution_id=$1 AND event_id IN (SELECT id FROM audit_event WHERE institution_id=$1 AND entity_id=ANY($2))", [i, all]);
  await owner.query("DELETE FROM audit_event WHERE institution_id=$1 AND entity_id=ANY($2)", [i, all]);
  await owner.query("DELETE FROM attendance_correction WHERE institution_id=$1 AND session_id=ANY($2)", [i, sessions]);
  await owner.query("DELETE FROM class_attendance_mark WHERE institution_id=$1 AND session_id=ANY($2)", [i, sessions]);
  await owner.query("DELETE FROM class_attendance_revision WHERE institution_id=$1 AND session_id=ANY($2)", [i, sessions]);
  await owner.query("DELETE FROM class_session WHERE institution_id=$1 AND id=ANY($2)", [i, sessions]);
  await owner.query("DELETE FROM campus_resource WHERE institution_id=$1 AND id=$2", [i, ids.room]);
  await owner.query("DELETE FROM assignment WHERE institution_id=$1 AND id=$2", [i, ids.assignment]);
  await Promise.all([db.end(), owner.end()]);
});

const latest = async (session: string) => (await owner.query<{ revision: number; status: string; reason: string | null }>(
  `SELECT v.revision,m.status,v.reason FROM class_attendance_revision v JOIN class_attendance_mark m USING (institution_id,session_id,revision)
   WHERE v.institution_id=$1 AND v.session_id=$2 AND m.student_id=$3 ORDER BY v.revision DESC LIMIT 1`, [i, session, as.get("student")!.account])).rows[0];

test("a student challenges an absent mark; only the class's teacher decides, and acceptance writes a new revision", async () => {
  const student = as.get("student")!, faculty = as.get("faculty")!;
  for (const alias of ["outsider", "tenant", "faculty", "admin"]) await rejects(requestCorrection(as.get(alias)!, { session: ids.accept, reason: "Was present" }));
  await assert.rejects(requestCorrection(student, { session: ids.accept, reason: "   " }), "blank reason is rejected");
  const id = await requestCorrection(student, { session: ids.accept, reason: "I was present; signed the register late" });
  await rejects(requestCorrection(student, { session: ids.accept, reason: "Again" }));
  assert.deepEqual((await corrections(student)).find(r => r.id === id)?.status, "submitted");
  assert.ok((await corrections(faculty)).some(r => r.id === id && r.student === "Asha Sen"));
  assert.deepEqual(await corrections(as.get("replacement")!), []);
  for (const alias of ["replacement", "hod", "student", "admin"]) await rejects(decideCorrection(as.get(alias)!, { correction: id, decision: "accept", reason: "No" }));

  const routed = await eventually(() => notifications(faculty), items => items.some(n => n.entity_id === id));
  assert.equal(routed.filter(n => n.entity_id === id)[0].title.startsWith("Attendance correction requested"), true);

  const others = (await owner.query("SELECT student_id,status FROM class_attendance_mark WHERE institution_id=$1 AND session_id=$2 AND revision=1 AND student_id<>$3 ORDER BY 1",
    [i, ids.accept, student.account])).rows;
  await decideCorrection(faculty, { correction: id, decision: "accept", reason: "Register signature verified" });
  const now = await latest(ids.accept);
  assert.deepEqual([now.revision, now.status, now.reason], [2, "present", "Correction request accepted: Register signature verified"]);
  assert.deepEqual((await owner.query("SELECT student_id,status FROM class_attendance_mark WHERE institution_id=$1 AND session_id=$2 AND revision=2 AND student_id<>$3 ORDER BY 1",
    [i, ids.accept, student.account])).rows, others, "other students' marks are copied unchanged");
  await rejects(decideCorrection(faculty, { correction: id, decision: "decline", reason: "Twice" }));
  await rejects(requestCorrection(student, { session: ids.accept, reason: "Now present" }));
  const decided = (await corrections(student)).find(r => r.id === id);
  assert.deepEqual([decided?.status, decided?.decision_reason], ["accepted", "Register signature verified"]);
  const told = await eventually(() => notifications(student), items => items.some(n => n.entity_id === id));
  assert.match(told.find(n => n.entity_id === id)!.title, /^Attendance correction accepted/);
  const actions = (await owner.query("SELECT action FROM audit_event WHERE institution_id=$1 AND entity_id=ANY($2) ORDER BY id", [i, [id, ids.accept]])).rows.map(r => r.action);
  assert.deepEqual(actions, ["attendance_correction.requested", "attendance.corrected", "attendance_correction.decided"]);
});

test("a declined correction keeps the record unchanged and can be re-requested", async () => {
  const student = as.get("student")!, faculty = as.get("faculty")!;
  const id = await requestCorrection(student, { session: ids.decline, reason: "Medical visit" });
  await decideCorrection(faculty, { correction: id, decision: "decline", reason: "No certificate received" });
  const now = await latest(ids.decline);
  assert.deepEqual([now.revision, now.status], [1, "absent"]);
  assert.equal((await corrections(student)).find(r => r.id === id)?.status, "declined");
  assert.ok(await requestCorrection(student, { session: ids.decline, reason: "Certificate attached at office" }));
});

test("the calendar shows own deadlines and classes for the month, filters by type and course, and denies others", async () => {
  const student = as.get("student")!;
  const items = await calendar(student, { month });
  assert.ok(items.some(e => e.kind === "deadline" && e.id === ids.assignment));
  assert.ok(items.some(e => e.kind === "class" && e.id === ids.accept && e.state === "conducted"));
  assert.ok((await calendar(as.get("faculty")!, { month })).some(e => e.id === ids.accept), "the teacher sees their class");
  assert.ok((await calendar(student, { month, kind: "class" })).every(e => e.kind === "class"));
  assert.ok(!(await calendar(student, { month, offering: fixtures.otherOffering })).some(e => e.id === ids.assignment));
  assert.ok(!(await calendar(as.get("replacement")!, { month })).some(e => e.id === ids.accept), "another teacher does not see it");
  for (const alias of ["outsider", "tenant"]) assert.ok(!(await calendar(as.get(alias)!, { month })).some(e => e.id === ids.assignment || e.id === ids.accept));
  for (const alias of ["admin", "hod", "principal"]) assert.deepEqual(await calendar(as.get(alias)!, { month }), []);
});

test("CSV exports carry sources, neutralise spreadsheet formulas, and are role-scoped", async () => {
  assert.equal(csv([["=SUM(A1)", 'say "hi"', null, 3]]), `'=SUM(A1),"say ""hi""",,3\r\n`);
  const record = (await studentRecord(as.get("student")!))!;
  assert.match(record, /^record,course,item,date,result,source\r\n/);
  assert.ok(record.includes(`present,class_session:${ids.accept} revision 2`), "corrected class appears with its revision");
  assert.ok(!(await studentRecord(as.get("outsider")!))!.includes(ids.accept), "another student's export excludes it");
  const report = (await facultyReport(as.get("faculty")!))!;
  assert.ok(report.split("\r\n").some(line => line.endsWith(`offering:${fixtures.offering}`)));
  for (const alias of ["admin", "hod", "principal", "faculty"]) assert.equal(await studentRecord(as.get(alias)!), null);
  for (const alias of ["admin", "hod", "principal", "student"]) assert.equal(await facultyReport(as.get(alias)!), null);
});

test("the course catalog lists institution offerings to members, marks own rosters, and isolates tenants", async () => {
  const mine = (await courseCatalog(as.get("student")!)).find(e => e.offering === fixtures.offering);
  assert.ok(mine?.mine && mine.faculty.includes("Riya Rao"));
  assert.equal((await courseCatalog(as.get("outsider")!)).find(e => e.offering === fixtures.offering)?.mine, false);
  assert.ok((await courseCatalog(as.get("student")!, "zzz-no-such-course")).length === 0);
  assert.ok((await courseCatalog(as.get("student")!, "%")).length > 0, "wildcards are treated as text");
  // Fictional tenants reuse offering UUIDs (keys are composite), so isolation is checked by content held only in this institution.
  const tenant = await courseCatalog(as.get("tenant")!);
  assert.ok(tenant.length > 0 && !tenant.some(e => e.course === "Engineering Mechanics" || e.faculty.includes("Riya Rao")));
});
