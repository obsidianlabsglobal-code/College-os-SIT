// covers: LE-018, FC-027, SL-013, CR-014, SL-016, ID-004, ID-006
import "../scripts/environment";
import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { db } from "../lib/db";
import { WorkflowError } from "../lib/assignments";
import { thresholdScenario } from "../lib/department";
import { addMeetingAction, completeMeetingAction, meetings, recordMinutes, scheduleMeeting } from "../lib/meetings";
import { draftCertificate, issueCertificate } from "../lib/certificates";
import { portfolio, portfolioCandidates, saveProfile, setPortfolioItem } from "../lib/student-life";
import { assignCase, cases, closeCase, openCase, supportCase } from "../lib/cases";
import { fixtures, demoEmail, personas } from "../scripts/fixtures";
import type { Scope } from "../lib/scope";

const owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const as = new Map<string, Scope>();
const i = fixtures.institution;
const tag = randomUUID().slice(0, 8);
const ids = { room: randomUUID(), session: randomUUID() };
const rejects = (run: () => Promise<unknown>, pattern?: RegExp) =>
  assert.rejects(async () => run(), (e: unknown) => (e instanceof WorkflowError || (e as Error).name === "ZodError") && (!pattern || pattern.test((e as Error).message)));
const local = (days: number, hour = 10) =>
  `${new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(Date.now() + days * 86400000))}T${String(hour).padStart(2, "0")}:00`;

before(async () => {
  for (const url of [process.env.MIGRATION_DATABASE_URL, process.env.DATABASE_URL]) assert.ok(url && ["127.0.0.1", "localhost"].includes(new URL(url).hostname));
  for (const [alias, [, , role]] of Object.entries(personas)) {
    const { rows: [row] } = await owner.query('SELECT id FROM "user" WHERE email=$1', [demoEmail(alias)]);
    as.set(alias, { account: row.id, role, institution: alias === "tenant" ? fixtures.otherInstitution : fixtures.institution });
  }
  const faculty = as.get("faculty")!.account;
  await owner.query("INSERT INTO campus_resource (institution_id,id,name,kind,location) VALUES ($1,$2,$3,'room','Fictional')", [i, ids.room, `Scenario room ${tag}`]);
  await owner.query(`INSERT INTO class_session (institution_id,id,series_id,offering_id,section_id,faculty_id,room_id,slot,state,created_by,published_at)
    SELECT $1,$2,gen_random_uuid(),$3,o.section_id,$4,$5,tstzrange(now()-interval '8 hours',now()-interval '7 hours'),'conducted',$4,now()
    FROM offering o WHERE o.institution_id=$1 AND o.id=$3`, [i, ids.session, fixtures.offering, faculty, ids.room]);
  await owner.query("INSERT INTO class_attendance_revision (institution_id,session_id,revision,actor_id) VALUES ($1,$2,1,$3)", [i, ids.session, faculty]);
  await owner.query("INSERT INTO class_attendance_mark VALUES ($1,$2,1,$3,'absent')", [i, ids.session, as.get("student")!.account]);
});
after(async () => {
  await owner.query("DELETE FROM meeting_action WHERE institution_id=$1 AND meeting_id IN (SELECT id FROM meeting WHERE institution_id=$1 AND title LIKE $2)", [i, `% ${tag}`]);
  await owner.query("DELETE FROM meeting_participant WHERE institution_id=$1 AND meeting_id IN (SELECT id FROM meeting WHERE institution_id=$1 AND title LIKE $2)", [i, `% ${tag}`]);
  await owner.query("DELETE FROM meeting WHERE institution_id=$1 AND title LIKE $2", [i, `% ${tag}`]);
  await owner.query("DELETE FROM portfolio_item WHERE institution_id=$1 AND student_id=$2", [i, as.get("student")!.account]);
  await owner.query("DELETE FROM certificate WHERE institution_id=$1 AND student_id=$2", [i, as.get("student")!.account]);
  await owner.query("DELETE FROM student_profile WHERE institution_id=$1 AND student_id=$2", [i, as.get("student")!.account]);
  const caseIds = (await owner.query("SELECT id FROM case_record WHERE institution_id=$1 AND title LIKE $2", [i, `% ${tag}`])).rows.map(r => r.id);
  await owner.query("DELETE FROM notification WHERE institution_id=$1 AND entity_id=ANY($2)", [i, caseIds]);
  await owner.query("DELETE FROM job WHERE institution_id=$1 AND event_id IN (SELECT id FROM audit_event WHERE institution_id=$1 AND entity_id=ANY($2))", [i, caseIds]);
  await owner.query("DELETE FROM case_support WHERE institution_id=$1 AND case_id=ANY($2)", [i, caseIds]);
  await owner.query("DELETE FROM case_record WHERE institution_id=$1 AND id=ANY($2)", [i, caseIds]);
  await owner.query("DELETE FROM class_attendance_mark WHERE institution_id=$1 AND session_id=$2", [i, ids.session]);
  await owner.query("DELETE FROM class_attendance_revision WHERE institution_id=$1 AND session_id=$2", [i, ids.session]);
  await owner.query("DELETE FROM class_session WHERE institution_id=$1 AND id=$2", [i, ids.session]);
  await owner.query("DELETE FROM campus_resource WHERE institution_id=$1 AND id=$2", [i, ids.room]);
  await Promise.all([db.end(), owner.end()]);
});

test("a decision scenario compares a proposed attendance minimum on the same records, for the principal only", async () => {
  const strict = (await thresholdScenario(as.get("principal")!, 100))!.find(r => r.section === "Section A")!;
  const lenient = (await thresholdScenario(as.get("principal")!, 1))!.find(r => r.section === "Section A")!;
  assert.ok(strict.below_proposed >= 1, "the absent student is below a 100% minimum");
  assert.ok(lenient.below_proposed <= strict.below_proposed);
  assert.equal(await thresholdScenario(as.get("principal")!, 0), null);
  for (const alias of ["admin", "hod", "faculty"]) assert.equal(await thresholdScenario(as.get(alias)!, 75), null);
  assert.deepEqual(await thresholdScenario({ ...as.get("tenant")!, role: "principal" }, 75), []);
});

test("meetings: invited staff only, organizer minutes and actions, owners close their own", async () => {
  const hod = as.get("hod")!, faculty = as.get("faculty")!;
  await rejects(() => scheduleMeeting(as.get("student")!, { title: `x ${tag}`, start: local(1), agenda: "x", participants: [faculty.account] }));
  await rejects(() => scheduleMeeting(hod, { title: `x ${tag}`, start: local(1), agenda: "x", participants: [as.get("student")!.account] }), /current staff/);
  const id = await scheduleMeeting(hod, { title: `Department review ${tag}`, start: local(-1), agenda: "Fictional: results backlog", participants: [faculty.account] });
  assert.ok((await meetings(faculty)).some(m => m.id === id));
  assert.ok(!(await meetings(as.get("replacement")!)).some(m => m.id === id), "uninvited staff do not see it");
  await rejects(() => recordMinutes(faculty, { meeting: id, minutes: "Not the organizer" }));
  await recordMinutes(hod, { meeting: id, minutes: "Agreed to publish pending results this week." });
  await rejects(() => addMeetingAction(hod, { meeting: id, owner: as.get("replacement")!.account, title: "x", due: local(3).slice(0, 10) }), /participant/);
  await addMeetingAction(hod, { meeting: id, owner: faculty.account, title: "Publish CIE 1 results", due: local(3).slice(0, 10) });
  const action = (await meetings(faculty)).find(m => m.id === id)!.actions[0];
  await rejects(() => completeMeetingAction(hod, action.id));
  await completeMeetingAction(faculty, action.id);
  assert.ok((await meetings(hod)).find(m => m.id === id)!.actions[0].done_at);
  const future = await scheduleMeeting(hod, { title: `Planning ${tag}`, start: local(5), agenda: "Fictional", participants: [faculty.account] });
  await rejects(() => recordMinutes(hod, { meeting: future, minutes: "Too early" }), /after the meeting has started/);
});

test("a portfolio holds only the student's verified records, shared by their profile visibility", async () => {
  const student = as.get("student")!, faculty = as.get("faculty")!;
  const cert = await draftCertificate(as.get("admin")!, { student: student.account, kind: "bonafide" });
  assert.ok(!(await portfolioCandidates(student)).some(e => e.source_id === cert), "drafts are not portfolio material");
  await issueCertificate(as.get("admin")!, cert);
  await rejects(() => setPortfolioItem(student, { source: "certificate", id: randomUUID(), include: true }), /verified records/);
  await setPortfolioItem(student, { source: "certificate", id: cert, include: true });
  await saveProfile(student, { bio: "Fictional", interests: "", visibility: "private" });
  assert.equal(await portfolio(faculty, student.account), null);
  await saveProfile(student, { bio: "Fictional", interests: "", visibility: "teachers" });
  assert.deepEqual((await portfolio(faculty, student.account))!.map(e => e.source_id), [cert]);
  await setPortfolioItem(student, { source: "certificate", id: cert, include: false });
  assert.deepEqual(await portfolio(faculty, student.account), []);
  await rejects(() => setPortfolioItem(faculty, { source: "certificate", id: cert, include: true }));
});

test("representation issues are visible to all current students, take support once, and are owned by the office", async () => {
  const student = as.get("student")!, classmate = as.get("outsider")!, admin = as.get("admin")!;
  await rejects(() => openCase(as.get("faculty")!, { kind: "representation", title: `x ${tag}`, body: "x" }));
  const id = await openCase(student, { kind: "representation", title: `Library hours ${tag}`, body: "Fictional: extend weekend hours" });
  assert.ok((await cases(classmate, "representation")).some(c => c.id === id), "another student can read it");
  await supportCase(classmate, id);
  await rejects(() => supportCase(classmate, id), /already support/);
  await rejects(() => supportCase(as.get("faculty")!, id));
  assert.equal((await cases(student, "representation")).find(c => c.id === id)?.supporters, 1);
  assert.ok(!(await cases({ ...as.get("tenant")!, role: "student" }, "representation")).some(c => c.id === id));
  await assignCase(admin, { case: id, assignee: admin.account });
  await closeCase(admin, { case: id, outcome: "resolved", reason: "Weekend hours extended for the term" });
  await rejects(() => supportCase(student, id));
  assert.equal((await cases(classmate, "representation")).find(c => c.id === id)?.outcome, "Weekend hours extended for the term");
});
