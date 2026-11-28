// covers: OP-011, OP-006, OP-007, OP-013, OP-015, AD-021, AD-016, SL-007, SA-007, AD-031, AD-032, SA-023, DH-023, AD-020, FC-009, FC-008, ID-004, ID-006
import "../scripts/environment";
import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { db } from "../lib/db";
import { assignments, WorkflowError } from "../lib/assignments";
import { attendanceEligibility, decidePolicy, draftPolicy, policyVersions, publishedPolicies } from "../lib/policies";
import { assignCase, cases, caseStaff, closeCase, openCase, reopenCase, startCase } from "../lib/cases";
import { runJobs } from "../lib/automation";
import { bankQuestions, composeAssessment, saveQuestion } from "../lib/question-bank";
import { fixtures, demoEmail, personas } from "../scripts/fixtures";
import type { Scope } from "../lib/scope";

const owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const as = new Map<string, Scope>();
const i = fixtures.institution;
const tag = randomUUID().slice(0, 8);
const ids = { room: randomUUID(), session: randomUUID(), assignment: randomUUID() };
const rejects = (run: () => Promise<unknown>, pattern?: RegExp) =>
  assert.rejects(async () => run(), (e: unknown) => (e instanceof WorkflowError || (e as Error).name === "ZodError") && (!pattern || pattern.test((e as Error).message)));

before(async () => {
  for (const url of [process.env.MIGRATION_DATABASE_URL, process.env.DATABASE_URL]) assert.ok(url && ["127.0.0.1", "localhost"].includes(new URL(url).hostname));
  for (const [alias, [, , role]] of Object.entries(personas)) {
    const { rows: [row] } = await owner.query('SELECT id FROM "user" WHERE email=$1', [demoEmail(alias)]);
    as.set(alias, { account: row.id, role, institution: alias === "tenant" ? fixtures.otherInstitution : fixtures.institution });
  }
  const faculty = as.get("faculty")!.account;
  await owner.query("INSERT INTO campus_resource (institution_id,id,name,kind,location) VALUES ($1,$2,$3,'room','Fictional')", [i, ids.room, `Policy room ${tag}`]);
  await owner.query(`INSERT INTO class_session (institution_id,id,series_id,offering_id,section_id,faculty_id,room_id,slot,state,created_by,published_at)
    SELECT $1,$2,gen_random_uuid(),$3,o.section_id,$4,$5,tstzrange(now()-interval '5 hours',now()-interval '4 hours'),'conducted',$4,now()
    FROM offering o WHERE o.institution_id=$1 AND o.id=$3`, [i, ids.session, fixtures.offering, faculty, ids.room]);
  await owner.query("INSERT INTO class_attendance_revision (institution_id,session_id,revision,actor_id) VALUES ($1,$2,1,$3)", [i, ids.session, faculty]);
  await owner.query("INSERT INTO class_attendance_mark VALUES ($1,$2,1,$3,'present')", [i, ids.session, as.get("student")!.account]);
  await owner.query(`INSERT INTO assignment (institution_id,id,offering_id,title,description,deadline,max_marks,published_at)
    VALUES ($1,$2,$3,$4,'Fictional',now()-interval '1 day',10,now()-interval '3 days')`, [i, ids.assignment, fixtures.offering, `Integrity check ${tag}`]);
});
after(async () => {
  const policies = (await owner.query("SELECT id FROM policy WHERE institution_id=$1 AND title LIKE $2", [i, `% ${tag}`])).rows.map(r => r.id);
  const caseIds = (await owner.query("SELECT id FROM case_record WHERE institution_id=$1 AND title LIKE $2", [i, `% ${tag}`])).rows.map(r => r.id);
  await owner.query("DELETE FROM notification WHERE institution_id=$1 AND entity_id=ANY($2)", [i, caseIds]);
  await owner.query("DELETE FROM job WHERE institution_id=$1 AND event_id IN (SELECT id FROM audit_event WHERE institution_id=$1 AND entity_id=ANY($2))", [i, caseIds]);
  await owner.query("DELETE FROM case_note WHERE institution_id=$1 AND case_id=ANY($2)", [i, caseIds]);
  await owner.query("DELETE FROM case_record WHERE institution_id=$1 AND id=ANY($2)", [i, caseIds]);
  await owner.query("DELETE FROM policy_version WHERE institution_id=$1 AND policy_id=ANY($2)", [i, policies]);
  await owner.query("DELETE FROM policy WHERE institution_id=$1 AND id=ANY($2)", [i, policies]);
  await owner.query("DELETE FROM bank_question_version WHERE institution_id=$1 AND question_id IN (SELECT id FROM bank_question WHERE institution_id=$1 AND topic LIKE $2)", [i, `% ${tag}`]);
  await owner.query("DELETE FROM bank_question WHERE institution_id=$1 AND topic LIKE $2", [i, `% ${tag}`]);
  await owner.query("DELETE FROM assignment WHERE institution_id=$1 AND (id=$2 OR title LIKE $3)", [i, ids.assignment, `% ${tag}`]);
  await owner.query("DELETE FROM roster WHERE institution_id=$1 AND offering_id=$2 AND account_id=$3 AND role='faculty'", [i, fixtures.otherOffering, as.get("replacement")!.account]);
  await owner.query("DELETE FROM class_attendance_mark WHERE institution_id=$1 AND session_id=$2", [i, ids.session]);
  await owner.query("DELETE FROM class_attendance_revision WHERE institution_id=$1 AND session_id=$2", [i, ids.session]);
  await owner.query("DELETE FROM class_session WHERE institution_id=$1 AND id=$2", [i, ids.session]);
  await owner.query("DELETE FROM campus_resource WHERE institution_id=$1 AND id=$2", [i, ids.room]);
  await Promise.all([db.end(), owner.end()]);
});

test("policies are drafted by the office, approved by the principal, versioned, and published to their audience; eligibility cites the version", async () => {
  const admin = as.get("admin")!, principal = as.get("principal")!, student = as.get("student")!;
  for (const alias of ["faculty", "hod", "principal", "student"]) await rejects(() => draftPolicy(as.get(alias)!, { kind: "general", title: `x ${tag}`, audience: "everyone", body: "x" }));
  await rejects(() => draftPolicy(admin, { kind: "attendance", title: `Attendance ${tag}`, audience: "students", body: "Minimum attendance" }), /minimum percentage/);
  const { policy } = await draftPolicy(admin, { kind: "attendance", title: `Attendance ${tag}`, audience: "students", body: "Students need 75% of recorded classes.", threshold: 75 });
  await rejects(() => draftPolicy(admin, { policy, body: "Second draft", threshold: 80 }), /already has a draft/);
  assert.ok(!(await publishedPolicies(student)).some(p => p.id === policy), "drafts are not published");
  assert.equal(await attendanceEligibility(student).then(e => e?.policy.id === policy), false);
  await rejects(() => decidePolicy(admin, { policy, version: 1, decision: "approve", reason: "Self-approval" }));
  await decidePolicy(principal, { policy, version: 1, decision: "approve", reason: "Matches the scheme rules" });
  await rejects(() => decidePolicy(principal, { policy, version: 1, decision: "reject", reason: "Twice" }), /not awaiting/);
  assert.equal((await publishedPolicies(student)).find(p => p.id === policy)?.version, 1);
  assert.ok(!(await publishedPolicies(as.get("faculty")!)).some(p => p.id === policy), "a students-only policy is not shown to staff");
  const first = (await attendanceEligibility(student))!;
  assert.deepEqual([first.policy.id, first.policy.version, first.policy.threshold], [policy, 1, 75]);
  assert.ok(first.rows.some(r => r.course === "Introduction to Programming" && r.recorded >= 1));
  await draftPolicy(admin, { policy, body: "Raised to 90% for this pilot.", threshold: 90 });
  await decidePolicy(principal, { policy, version: 2, decision: "approve", reason: "Board decision" });
  assert.deepEqual([(await attendanceEligibility(student))!.policy.version, (await attendanceEligibility(student))!.policy.threshold], [2, 90]);
  await draftPolicy(admin, { policy, body: "Lower to 50%.", threshold: 50 });
  await decidePolicy(principal, { policy, version: 3, decision: "reject", reason: "Not approved by the board" });
  assert.equal((await attendanceEligibility(student))!.policy.version, 2, "a rejected version never takes effect");
  assert.equal(await attendanceEligibility(as.get("faculty")!), null);
  assert.deepEqual((await policyVersions(principal)).filter(v => v.policy_id === policy).map(v => v.state), ["rejected", "approved", "approved"]);
  assert.deepEqual(await policyVersions(student), []);

  const service = await draftPolicy(admin, { kind: "service", title: `Bonafide letters ${tag}`, audience: "everyone", body: "Requests are processed within 3 working days." });
  await decidePolicy(principal, { policy: service.policy, version: 1, decision: "approve", reason: "Published service standard" });
  for (const alias of ["student", "faculty", "hod"]) assert.ok((await publishedPolicies(as.get(alias)!)).some(p => p.id === service.policy));
  assert.ok(!(await publishedPolicies(as.get("tenant")!)).some(p => p.id === service.policy));
});

test("repair reports: the office owns them, and the reporter can reopen an unresolved repair within 14 days", async () => {
  const admin = as.get("admin")!, faculty = as.get("faculty")!;
  await rejects(() => openCase(as.get("principal")!, { kind: "facility", title: `x ${tag}`, body: "x" }));
  const id = await openCase(faculty, { kind: "facility", title: `Projector flicker ${tag}`, body: "Room 204 projector flickers" });
  assert.ok((await cases(admin, "facility")).some(c => c.id === id));
  assert.ok(!(await cases(as.get("student")!, "facility")).some(c => c.id === id), "other members do not see someone else's report");
  await assignCase(admin, { case: id, assignee: admin.account });
  await closeCase(admin, { case: id, outcome: "resolved", reason: "Replaced the cable" });
  await rejects(() => reopenCase(as.get("student")!, { case: id, reason: "Not mine" }));
  await reopenCase(faculty, { case: id, reason: "Still flickers after an hour" });
  const reopened = (await cases(admin, "facility")).find(c => c.id === id)!;
  assert.deepEqual([reopened.state, reopened.reopened, reopened.outcome, reopened.notes.at(-1)?.body], ["in_progress", 1, null, "Reopened: Still flickers after an hour"]);
  await closeCase(admin, { case: id, outcome: "resolved", reason: "Replaced the lamp" });
  await owner.query("UPDATE case_record SET closed_at=now()-interval '15 days' WHERE institution_id=$1 AND id=$2", [i, id]);
  await rejects(() => reopenCase(faculty, { case: id, reason: "Too late" }));
});

test("integrity appeals cite the published policy version and stay within the course's department", async () => {
  const student = as.get("student")!, hod = as.get("hod")!;
  const appeal = { kind: "integrity", assignment: ids.assignment, title: `Plagiarism flag ${tag}`, body: "Fictional: my sources were cited" };
  const policy = await draftPolicy(as.get("admin")!, { kind: "integrity", title: `Academic integrity ${tag}`, audience: "everyone", body: "Fictional integrity rules." });
  await decidePolicy(as.get("principal")!, { policy: policy.policy, version: 1, decision: "approve", reason: "Adopted" });
  await rejects(() => openCase(as.get("outsider")!, appeal), /current courses/);
  await rejects(() => openCase(as.get("faculty")!, appeal));
  const id = await openCase(student, appeal);
  const seen = (await cases(hod, "integrity")).find(c => c.id === id)!;
  assert.equal(seen.policy, `Academic integrity ${tag} v1`);
  assert.equal(seen.assignment, `Integrity check ${tag}`);
  assert.ok((await caseStaff(hod, "integrity")).some(p => p.id === hod.account), "the department head may review it directly");
  for (const alias of ["faculty", "admin", "principal", "outsider"]) assert.ok(!(await cases(as.get(alias)!, "integrity")).some(c => c.id === id));
  await assignCase(hod, { case: id, assignee: hod.account });
  await closeCase(hod, { case: id, outcome: "resolved", reason: "Citations verified; flag withdrawn" });
  const mine = (await cases(student, "integrity")).find(c => c.id === id)!;
  assert.deepEqual([mine.outcome, mine.notes.length], ["Citations verified; flag withdrawn", 0]);
});

test("department requests go to a department where the student studies and are routed by its head", async () => {
  const student = as.get("student")!, hod = as.get("hod")!, faculty = as.get("faculty")!;
  await rejects(() => openCase(student, { kind: "department", department: fixtures.otherDepartment, title: `x ${tag}`, body: "x" }), /where you currently study/);
  const id = await openCase(student, { kind: "department", department: fixtures.department, title: `Lab slot change ${tag}`, body: "Fictional request" });
  await rejects(() => assignCase(as.get("admin")!, { case: id, assignee: faculty.account }));
  await assignCase(hod, { case: id, assignee: faculty.account });
  assert.ok((await cases(faculty, "department")).some(c => c.id === id));
  assert.ok(!(await cases(as.get("replacement")!, "department")).some(c => c.id === id));
  await closeCase(faculty, { case: id, outcome: "declined", reason: "Lab capacity is full this term" });
  assert.equal((await cases(student, "department")).find(c => c.id === id)?.state, "declined");
});

test("question bank: versioned, private or department-shared, and composed into a private draft assignment", async () => {
  const faculty = as.get("faculty")!, colleague = as.get("replacement")!;
  await owner.query("INSERT INTO roster (institution_id,offering_id,account_id,role) VALUES ($1,$2,$3,'faculty') ON CONFLICT DO NOTHING", [i, fixtures.otherOffering, colleague.account]);
  await rejects(() => saveQuestion(faculty, { department: fixtures.otherDepartment, topic: `x ${tag}`, prompt: "x", marks: 2 }), /currently teach/);
  const priv = await saveQuestion(faculty, { department: fixtures.department, topic: `Loops ${tag}`, prompt: "Write a for loop.", marks: 4 });
  const shared = await saveQuestion(faculty, { department: fixtures.department, topic: `Recursion ${tag}`, prompt: "Define recursion.", marks: 6, visibility: "department" });
  assert.equal((await saveQuestion(faculty, { question: priv.question, prompt: "Write a for loop that sums 1..n.", marks: 5 })).version, 2);
  await rejects(() => saveQuestion(colleague, { question: shared.question, prompt: "Edited by someone else", marks: 1 }));
  const theirs = await bankQuestions(colleague);
  assert.ok(theirs.some(q => q.id === shared.question) && !theirs.some(q => q.id === priv.question), "shared is visible, private is not");
  assert.deepEqual(await bankQuestions(as.get("hod")!), []);
  const versions = (await owner.query("SELECT version,prompt FROM bank_question_version WHERE institution_id=$1 AND question_id=$2 ORDER BY version", [i, priv.question])).rows;
  assert.deepEqual(versions.map(v => v.prompt), ["Write a for loop.", "Write a for loop that sums 1..n."]);
  const deadline = new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(Date.now() + 10 * 86400000)) + "T17:00";
  await rejects(() => composeAssessment(colleague, { offering: fixtures.otherOffering, title: `Quiz ${tag}`, deadline, questions: [priv.question] }), /your bank/);
  const draft = await composeAssessment(faculty, { offering: fixtures.offering, title: `Quiz ${tag}`, deadline, questions: [priv.question, shared.question] });
  const [created] = await assignments(faculty, draft);
  assert.equal(created.max_marks, 11);
  assert.match(created.description, /1\. Write a for loop that sums 1\.\.n\. \(5 marks · bank: Loops .* v2\)/);
  assert.equal(created.published_at, null, "composed assessments start as private drafts");
  assert.deepEqual(await assignments(as.get("student")!, draft), []);
});

test("safety incidents go to the office, the principal can read them, and an unassigned report is flagged after 24 hours", async () => {
  const student = as.get("student")!, admin = as.get("admin")!, principal = as.get("principal")!;
  await rejects(() => openCase(principal, { kind: "safety", title: `x ${tag}`, body: "x" }));
  const id = await openCase(student, { kind: "safety", title: `Loose cable near Lab 3 ${tag}`, body: "Exposed wire at the entrance" });
  const fresh = (await cases(admin, "safety")).find(c => c.id === id)!;
  assert.equal(fresh.escalated, false);
  assert.ok((await cases(principal, "safety")).some(c => c.id === id), "leadership oversight");
  for (const alias of ["outsider", "faculty", "hod"]) assert.ok(!(await cases(as.get(alias)!, "safety")).some(c => c.id === id), alias);
  assert.ok(!(await cases({ ...as.get("tenant")!, role: "admin" }, "safety")).some(c => c.id === id));
  await owner.query("UPDATE case_record SET created_at=now()-interval '25 hours' WHERE institution_id=$1 AND id=$2", [i, id]);
  assert.equal((await cases(admin, "safety")).find(c => c.id === id)?.escalated, true, "nobody took it up within 24 hours");
  await assignCase(admin, { case: id, assignee: admin.account });
  assert.equal((await cases(admin, "safety")).find(c => c.id === id)?.escalated, false, "assigned, so no longer flagged");
  await startCase(admin, id);
  await closeCase(admin, { case: id, outcome: "resolved", reason: "Cable covered and taped" });
  const told = async () => (await owner.query("SELECT title FROM notification WHERE institution_id=$1 AND entity_id=$2 AND recipient_id=$3", [i, id, student.account])).rows[0]?.title;
  for (let n = 0; n < 40 && !(await told()); n++) { await runJobs({ worker: "safety-test" }); await new Promise(r => setTimeout(r, 100)); }
  assert.equal(await told(), "Your safety report has been resolved");
});
