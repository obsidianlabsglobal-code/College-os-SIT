// covers: AD-018, SA-010, SA-002, SA-022, FC-028, AD-024, LE-009, DH-009, LE-019, ID-004, ID-006
import "../scripts/environment";
import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { db } from "../lib/db";
import { WorkflowError } from "../lib/assignments";
import { addCalendarEntry, calendar, withdrawCalendarEntry } from "../lib/calendar";
import { courseCatalog, setCatalogVisibility } from "../lib/catalog";
import { executiveReport, facultyReport, studentRecord } from "../lib/exports";
import { operationsReport } from "../lib/reporting";
import { sectionCompliance } from "../lib/department";
import { decidePolicy, draftPolicy } from "../lib/policies";
import { assignCase, closeCase, openCase, reopenCase } from "../lib/cases";
import { myWork } from "../lib/work";
import { fixtures, demoEmail, personas } from "../scripts/fixtures";
import type { Scope } from "../lib/scope";

const owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const as = new Map<string, Scope>();
const i = fixtures.institution;
const tag = randomUUID().slice(0, 8);
const ids = { room: randomUUID(), session: randomUUID() };
const rejects = (run: () => Promise<unknown>, pattern?: RegExp) =>
  assert.rejects(async () => run(), (e: unknown) => (e instanceof WorkflowError || (e as Error).name === "ZodError") && (!pattern || pattern.test((e as Error).message)));
const local = (days = 0) => new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(Date.now() + days * 86400000));

before(async () => {
  for (const url of [process.env.MIGRATION_DATABASE_URL, process.env.DATABASE_URL]) assert.ok(url && ["127.0.0.1", "localhost"].includes(new URL(url).hostname));
  for (const [alias, [, , role]] of Object.entries(personas)) {
    const { rows: [row] } = await owner.query('SELECT id FROM "user" WHERE email=$1', [demoEmail(alias)]);
    as.set(alias, { account: row.id, role, institution: alias === "tenant" ? fixtures.otherInstitution : fixtures.institution });
  }
  const faculty = as.get("faculty")!.account;
  await owner.query("INSERT INTO campus_resource (institution_id,id,name,kind,location) VALUES ($1,$2,$3,'room','Fictional')", [i, ids.room, `Closing room ${tag}`]);
  await owner.query(`INSERT INTO class_session (institution_id,id,series_id,offering_id,section_id,faculty_id,room_id,slot,state,created_by,published_at)
    SELECT $1,$2,gen_random_uuid(),$3,o.section_id,$4,$5,tstzrange(now()-interval '6 hours',now()-interval '5 hours'),'conducted',$4,now()
    FROM offering o WHERE o.institution_id=$1 AND o.id=$3`, [i, ids.session, fixtures.offering, faculty, ids.room]);
  await owner.query("INSERT INTO class_attendance_revision (institution_id,session_id,revision,actor_id) VALUES ($1,$2,1,$3)", [i, ids.session, faculty]);
  await owner.query("INSERT INTO class_attendance_mark VALUES ($1,$2,1,$3,'absent')", [i, ids.session, as.get("student")!.account]);
});
after(async () => {
  const caseIds = (await owner.query("SELECT id FROM case_record WHERE institution_id=$1 AND title LIKE $2", [i, `% ${tag}`])).rows.map(r => r.id);
  await owner.query("DELETE FROM notification WHERE institution_id=$1 AND entity_id=ANY($2)", [i, caseIds]);
  await owner.query("DELETE FROM job WHERE institution_id=$1 AND event_id IN (SELECT id FROM audit_event WHERE institution_id=$1 AND entity_id=ANY($2))", [i, caseIds]);
  await owner.query("DELETE FROM case_note WHERE institution_id=$1 AND case_id=ANY($2)", [i, caseIds]);
  await owner.query("DELETE FROM case_record WHERE institution_id=$1 AND id=ANY($2)", [i, caseIds]);
  const policies = (await owner.query("SELECT id FROM policy WHERE institution_id=$1 AND title LIKE $2", [i, `% ${tag}`])).rows.map(r => r.id);
  await owner.query("DELETE FROM policy_version WHERE institution_id=$1 AND policy_id=ANY($2)", [i, policies]);
  await owner.query("DELETE FROM policy WHERE institution_id=$1 AND id=ANY($2)", [i, policies]);
  await owner.query("DELETE FROM calendar_entry WHERE institution_id=$1 AND title LIKE $2", [i, `% ${tag}`]);
  await owner.query("UPDATE offering SET catalog_visible=true WHERE institution_id=$1", [i]);
  await owner.query("DELETE FROM class_attendance_mark WHERE institution_id=$1 AND session_id=$2", [i, ids.session]);
  await owner.query("DELETE FROM class_attendance_revision WHERE institution_id=$1 AND session_id=$2", [i, ids.session]);
  await owner.query("DELETE FROM class_session WHERE institution_id=$1 AND id=$2", [i, ids.session]);
  await owner.query("DELETE FROM campus_resource WHERE institution_id=$1 AND id=$2", [i, ids.room]);
  await Promise.all([db.end(), owner.end()]);
});

test("institution dates published by the office appear in calendars and can be withdrawn", async () => {
  const admin = as.get("admin")!;
  await rejects(() => addCalendarEntry(as.get("faculty")!, { title: `x ${tag}`, kind: "holiday", from: local(), to: local() }));
  await rejects(() => addCalendarEntry(admin, { title: `x ${tag}`, kind: "holiday", from: local(2), to: local(1) }), /end date/);
  const id = await addCalendarEntry(admin, { title: `Founders day ${tag}`, kind: "holiday", from: local(), to: local() });
  const month = local().slice(0, 7);
  for (const alias of ["student", "faculty"]) assert.ok((await calendar(as.get(alias)!, { month, kind: "institution" })).some(e => e.id === id));
  assert.ok(!(await calendar(as.get("tenant")!, { month })).some(e => e.id === id));
  await withdrawCalendarEntry(admin, id);
  assert.ok(!(await calendar(as.get("student")!, { month })).some(e => e.id === id));
});

test("hidden offerings leave the catalog for others but stay visible to their roster and the office", async () => {
  const admin = as.get("admin")!;
  await rejects(() => setCatalogVisibility(as.get("hod")!, fixtures.offering, false));
  await setCatalogVisibility(admin, fixtures.offering, false);
  await rejects(() => setCatalogVisibility(admin, fixtures.offering, false), /No change/);
  assert.equal((await courseCatalog(admin)).find(e => e.offering === fixtures.offering)?.visible, false);
  assert.ok((await courseCatalog(as.get("student")!)).some(e => e.offering === fixtures.offering), "enrolled students still see their course");
  assert.ok(!(await courseCatalog(as.get("outsider")!)).some(e => e.offering === fixtures.offering));
  await setCatalogVisibility(admin, fixtures.offering, true);
  assert.ok((await courseCatalog(as.get("outsider")!)).some(e => e.offering === fixtures.offering));
});

test("records name scheme and term; the teaching report carries workload; the executive report takes a window", async () => {
  const record = (await studentRecord(as.get("student")!))!;
  assert.match(record, /^record,scheme,term,course,item,date,result,source\r\n/);
  assert.ok(record.includes(`attendance,Fictional Engineering Scheme,Term 1,Introduction to Programming,class`));
  const teaching = (await facultyReport(as.get("faculty")!))!;
  assert.ok(teaching.includes("workload,awaiting evaluation,unpublished feedback drafts,classes next 7 days,classes without attendance (7 days),current mentees"));
  const windowed = (await executiveReport(as.get("principal")!, { from: local(-7), to: local() }))!;
  assert.ok(windowed.includes(`window,service requests,received,`) && windowed.includes(`${local(-7)} to ${local()}`));
  assert.ok(!(await executiveReport(as.get("principal")!, { from: local(), to: local(-7) }))!.includes("\r\nwindow,"), "an inverted window is ignored");
});

test("operations count reopened work; department compliance uses the approved attendance policy", async () => {
  const admin = as.get("admin")!, faculty = as.get("faculty")!;
  const before = (await operationsReport(admin))!.reopened_30d;
  const id = await openCase(faculty, { kind: "facility", title: `Door lock ${tag}`, body: "Fictional" });
  await assignCase(admin, { case: id, assignee: admin.account });
  await closeCase(admin, { case: id, outcome: "resolved", reason: "Oiled" });
  await reopenCase(faculty, { case: id, reason: "Still sticks" });
  assert.equal((await operationsReport(admin))!.reopened_30d, before + 1);

  assert.ok(!(await sectionCompliance(as.get("hod")!)).some(c => c.policy.endsWith(tag)));
  const { policy } = await draftPolicy(admin, { kind: "attendance", title: `Attendance rule ${tag}`, audience: "students", body: "Fictional", threshold: 100 });
  await decidePolicy(as.get("principal")!, { policy, version: 1, decision: "approve", reason: "Adopted" });
  const sectionA = (await sectionCompliance(as.get("hod")!)).find(c => c.offering === fixtures.offering)!;
  assert.deepEqual([sectionA.policy, sectionA.version, sectionA.threshold], [`Attendance rule ${tag}`, 1, 100]);
  assert.ok(sectionA.below >= 1 && sectionA.measured >= sectionA.below, "the absent student counts as below a 100% minimum");
  for (const alias of ["faculty", "principal", "admin"]) assert.deepEqual(await sectionCompliance(as.get(alias)!), []);
});

test("My work lists only what each role must act on, from each workflow's own rules", async () => {
  const admin = as.get("admin")!, hod = as.get("hod")!;
  const repair = await openCase(as.get("student")!, { kind: "facility", title: `Window latch ${tag}`, body: "Fictional" });
  const support = await openCase(hod, { kind: "support", student: as.get("student")!.account, department: fixtures.department, title: `Follow-up ${tag}`, body: "Fictional" });
  const q = "institution=x&role=y";
  assert.ok((await myWork(admin, q)).some(w => w.title === `Window latch ${tag}` && w.detail === "Needs an owner"));
  assert.ok((await myWork(hod, q)).some(w => w.title === `Follow-up ${tag}`));
  assert.ok(!(await myWork(as.get("faculty")!, q)).some(w => w.title === `Follow-up ${tag}`), "unassigned department cases are the HOD's");
  await assignCase(hod, { case: support, assignee: as.get("faculty")!.account });
  assert.ok((await myWork(as.get("faculty")!, q)).some(w => w.title === `Follow-up ${tag}` && w.detail.startsWith("Assigned to you")));
  assert.ok(!(await myWork(hod, q)).some(w => w.title === `Follow-up ${tag}`), "once owned, it leaves the HOD's queue");
  assert.deepEqual(await myWork(as.get("student")!, q), []);
  assert.ok(!(await myWork({ ...as.get("tenant")!, role: "admin" }, q)).some(w => w.title.endsWith(tag)));
  assert.ok(repair);
});
