// covers: DH-002, DH-003, DH-006, DH-009, LE-002, LE-009, FC-019, ID-004
import "../scripts/environment";
import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { db } from "../lib/db";
import { departmentComparison, departmentFaculty, departmentSections, escalatedRequests, facultyWorkload } from "../lib/department";
import { fixtures, demoEmail, personas } from "../scripts/fixtures";
import type { Scope } from "../lib/scope";

const owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const as = new Map<string, Scope>();
const ids = { assignment: randomUUID(), room: randomUUID(), session: randomUUID(), request: randomUUID() };
before(async () => {
  for (const url of [process.env.MIGRATION_DATABASE_URL, process.env.DATABASE_URL]) assert.ok(url && ["127.0.0.1", "localhost"].includes(new URL(url).hostname));
  for (const [alias, [, , role]] of Object.entries(personas)) {
    const { rows: [row] } = await owner.query('SELECT id FROM "user" WHERE email=$1', [demoEmail(alias)]);
    as.set(alias, { account: row.id, role, institution: alias === "tenant" ? fixtures.otherInstitution : fixtures.institution });
  }
});
after(async () => {
  const i = fixtures.institution;
  await owner.query("DELETE FROM class_attendance_mark WHERE institution_id=$1 AND session_id=$2", [i, ids.session]);
  await owner.query("DELETE FROM class_attendance_revision WHERE institution_id=$1 AND session_id=$2", [i, ids.session]);
  await owner.query("DELETE FROM class_session WHERE institution_id=$1 AND id=$2", [i, ids.session]);
  await owner.query("DELETE FROM campus_resource WHERE institution_id=$1 AND id=$2", [i, ids.room]);
  await owner.query("DELETE FROM submission WHERE institution_id=$1 AND assignment_id=$2", [i, ids.assignment]);
  await owner.query("DELETE FROM assignment WHERE institution_id=$1 AND id=$2", [i, ids.assignment]);
  await owner.query("DELETE FROM notification WHERE institution_id=$1 AND entity_id=$2", [i, ids.request]);
  await owner.query("DELETE FROM audit_event WHERE institution_id=$1 AND entity_id=$2", [i, ids.request]);
  await owner.query("DELETE FROM service_request WHERE institution_id=$1 AND id=$2", [i, ids.request]);
  await Promise.all([db.end(), owner.end()]);
});

const riya = async () => (await departmentFaculty(as.get("hod")!)).find(row => row.name === "Riya Rao")!;
const sectionA = async () => (await departmentSections(as.get("hod")!)).find(row => row.offering === fixtures.offering)!;
const dept = async () => (await departmentComparison(as.get("principal")!)).find(row => row.id === fixtures.department)!;

test("HOD and faculty see the same workload definition, and it moves with real records", async () => {
  const before = await riya();
  assert.ok(before.offerings.some(label => label.startsWith("Introduction to Programming")));
  assert.deepEqual(await facultyWorkload(as.get("faculty")!), before, "faculty self-view matches the HOD's view");
  const i = fixtures.institution;
  await owner.query(`INSERT INTO assignment (institution_id,id,offering_id,title,description,deadline,max_marks,published_at)
    VALUES ($1,$2,$3,'Workload check','Fictional',now()+interval '3 days',10,now())`, [i, ids.assignment, fixtures.offering]);
  await owner.query(`INSERT INTO submission (institution_id,assignment_id,student_id,body,submitted_at,request_id)
    VALUES ($1,$2,$3,'Fictional answer',now(),gen_random_uuid())`, [i, ids.assignment, as.get("student")!.account]);
  const after = await riya();
  assert.equal(after.assignments, before.assignments + 1);
  assert.equal(after.pending, before.pending + 1);
  assert.deepEqual(await facultyWorkload(as.get("faculty")!), after);
});

test("section rosters and attendance use the latest correction, for HOD and principal alike", async () => {
  const i = fixtures.institution, student = as.get("student")!.account, faculty = as.get("faculty")!.account;
  const roster = await sectionA();
  assert.ok(roster.students.includes("Asha Sen") && roster.faculty.includes("Riya Rao"));
  const [sectionBefore, deptBefore, workBefore] = [roster, await dept(), await riya()];
  const start = new Date(Date.now() - 2 * 86400000 - Math.floor(Math.random() * 600) * 60000);
  await owner.query("INSERT INTO campus_resource (institution_id,id,name,kind,location) VALUES ($1,$2,'Report room','room','Fictional')", [i, ids.room]);
  await owner.query(`INSERT INTO class_session (institution_id,id,series_id,offering_id,section_id,faculty_id,room_id,slot,state,created_by,published_at)
    SELECT $1,$2,gen_random_uuid(),$3,o.section_id,$4,$5,tstzrange($6,$6::timestamptz+interval '5 minutes'),'published',$4,now()
    FROM offering o WHERE o.institution_id=$1 AND o.id=$3`, [i, ids.session, fixtures.offering, faculty, ids.room, start]);
  assert.equal((await riya()).unrecorded, workBefore.unrecorded + 1, "an ended class without a record counts as unrecorded");
  await owner.query("INSERT INTO class_attendance_revision (institution_id,session_id,revision,actor_id) VALUES ($1,$2,1,$3)", [i, ids.session, faculty]);
  await owner.query("INSERT INTO class_attendance_mark VALUES ($1,$2,1,$3,'absent')", [i, ids.session, student]);
  await owner.query("INSERT INTO class_attendance_revision (institution_id,session_id,revision,actor_id,reason) VALUES ($1,$2,2,$3,'Register verified')", [i, ids.session, faculty]);
  await owner.query("INSERT INTO class_attendance_mark VALUES ($1,$2,2,$3,'present')", [i, ids.session, student]);
  const [sectionAfter, deptAfter] = [await sectionA(), await dept()];
  assert.deepEqual([sectionAfter.classes - sectionBefore.classes, sectionAfter.present - sectionBefore.present, sectionAfter.marked - sectionBefore.marked], [1, 1, 1]);
  assert.deepEqual([deptAfter.present - deptBefore.present, deptAfter.marked - deptBefore.marked], [1, 1]);
  assert.equal((await riya()).unrecorded, workBefore.unrecorded);
});

test("escalations show the office's current decision to the principal only", async () => {
  const i = fixtures.institution, principal = as.get("principal")!.account;
  await owner.query("INSERT INTO service_request (institution_id,id,student_id,description,created_at) VALUES ($1,$2,$3,'Fictional transcript request',now()-interval '3 days')",
    [i, ids.request, as.get("student")!.account]);
  const { rows: [event] } = await owner.query("INSERT INTO audit_event (institution_id,actor_id,entity_id,action) VALUES ($1,$2,$3,'test.escalation') RETURNING id",
    [i, principal, ids.request]);
  await owner.query("INSERT INTO notification (institution_id,recipient_id,event_id,kind,entity_id,title) VALUES ($1,$2,$3,'escalation',$4,'Escalated')",
    [i, principal, event.id, ids.request]);
  const open = (await escalatedRequests(as.get("principal")!)).find(row => row.id === ids.request);
  assert.equal(open?.status, "submitted");
  await owner.query("UPDATE service_request SET status='resolved',handled_by=$3,outcome='Issued',closed_at=now() WHERE institution_id=$1 AND id=$2",
    [i, ids.request, as.get("admin")!.account]);
  const closed = (await escalatedRequests(as.get("principal")!)).find(row => row.id === ids.request);
  assert.deepEqual([closed?.status, closed?.outcome, closed?.handler], ["resolved", "Issued", "Mira Bose"]);
});

test("department and leadership reports deny other posts and tenants", async () => {
  for (const alias of ["student", "faculty", "admin", "principal"]) {
    assert.deepEqual(await departmentFaculty(as.get(alias)!), []);
    assert.deepEqual(await departmentSections(as.get(alias)!), []);
  }
  for (const alias of ["student", "hod", "admin"]) {
    assert.deepEqual(await departmentComparison(as.get(alias)!), []);
    assert.deepEqual(await escalatedRequests(as.get(alias)!), []);
  }
  assert.equal(await facultyWorkload(as.get("hod")!), null);
  const elsewhere = (alias: string) => ({ ...as.get(alias)!, institution: fixtures.otherInstitution });
  assert.deepEqual(await departmentFaculty(elsewhere("hod")), []);
  assert.deepEqual(await departmentComparison(elsewhere("principal")), []);
  assert.deepEqual(await escalatedRequests(elsewhere("principal")), []);
  assert.equal(await facultyWorkload(elsewhere("faculty")), null);
});
