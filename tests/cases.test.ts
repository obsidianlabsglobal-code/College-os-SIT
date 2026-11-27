// covers: AD-024, AD-017, AD-020, DH-014, FC-015, LE-003, ID-004, ID-006
import "../scripts/environment";
import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Pool } from "pg";
import { db } from "../lib/db";
import { WorkflowError } from "../lib/assignments";
import { deliverDigests, notifications, runJobs } from "../lib/automation";
import { latestDigest } from "../lib/reporting";
import { addCaseNote, assignCase, cases, caseSummary, closeCase, openCase, startCase } from "../lib/cases";
import { cohortProgress } from "../lib/department";
import { fixtures, demoEmail, personas } from "../scripts/fixtures";
import type { Scope } from "../lib/scope";

const owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const as = new Map<string, Scope>();
const i = fixtures.institution;
const opened: string[] = [];
const rejects = (run: () => Promise<unknown>) => assert.rejects(async () => run(), (e: unknown) => e instanceof WorkflowError || (e as Error).name === "ZodError");
async function eventually<T>(read: () => Promise<T>, ok: (value: T) => boolean) {
  for (let n = 0; n < 40; n++) { await runJobs({ worker: "cases-test" }); const value = await read(); if (ok(value)) return value; await new Promise(r => setTimeout(r, 100)); }
  return read();
}

before(async () => {
  for (const url of [process.env.MIGRATION_DATABASE_URL, process.env.DATABASE_URL]) assert.ok(url && ["127.0.0.1", "localhost"].includes(new URL(url).hostname));
  for (const [alias, [, , role]] of Object.entries(personas)) {
    const { rows: [row] } = await owner.query('SELECT id FROM "user" WHERE email=$1', [demoEmail(alias)]);
    as.set(alias, { account: row.id, role, institution: alias === "tenant" ? fixtures.otherInstitution : fixtures.institution });
  }
});
after(async () => {
  await owner.query("DELETE FROM notification WHERE institution_id=$1 AND entity_id=ANY($2)", [i, opened]);
  await owner.query("DELETE FROM job WHERE institution_id=$1 AND event_id IN (SELECT id FROM audit_event WHERE institution_id=$1 AND entity_id=ANY($2))", [i, opened]);
  await owner.query("DELETE FROM case_note WHERE institution_id=$1 AND case_id=ANY($2)", [i, opened]);
  await owner.query("DELETE FROM case_record WHERE institution_id=$1 AND id=ANY($2)", [i, opened]);
  await Promise.all([db.end(), owner.end()]);
});
const open = async (scope: Scope, input: Record<string, unknown>) => { const id = await openCase(scope, input); opened.push(id); return id; };

test("the worker writes one weekly digest per institution from the previous local week", async () => {
  await owner.query("DELETE FROM operations_digest");
  const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/worker.ts", "--once"], { env: { ...process.env, NEXUS_DB_ROLE: "worker" } });
  assert.ok(typeof stdout === "string");
  const { rows } = await owner.query<{ institution_id: string; period_start: string; resolved: number }>(
    "SELECT institution_id,to_char(period_start,'YYYY-MM-DD') AS period_start,(metrics->>'resolved')::int AS resolved FROM operations_digest ORDER BY 1");
  assert.deepEqual(rows.map(r => r.institution_id), [fixtures.institution, fixtures.otherInstitution], "written by the least-privilege worker role");
  const { rows: [expected] } = await owner.query<{ week: string; resolved: number }>(`SELECT to_char(w-7,'YYYY-MM-DD') AS week,
      (SELECT count(*)::int FROM service_request r WHERE r.institution_id=i.id AND r.status='resolved'
        AND r.closed_at>=(w-7)::timestamp AT TIME ZONE i.timezone AND r.closed_at<w::timestamp AT TIME ZONE i.timezone) AS resolved
    FROM institution i, LATERAL (SELECT date_trunc('week',now() AT TIME ZONE i.timezone)::date AS w) x WHERE i.id=$1`, [i]);
  assert.deepEqual([rows[0].period_start, rows[0].resolved], [expected.week, expected.resolved]);
  assert.equal(await deliverDigests(), 0, "a second run in the same week is a no-op");
  assert.equal((await latestDigest(as.get("admin")!))?.period_start, expected.week);
  assert.equal((await latestDigest(as.get("principal")!))?.period_start, expected.week);
  for (const alias of ["faculty", "hod", "student"]) assert.equal(await latestDigest(as.get(alias)!), null);
  assert.equal(await latestDigest({ ...as.get("tenant")!, role: "admin" }), null, "a claimed role without membership reads nothing");
});

test("a grievance stays confidential, has one owner, and the student sees only the outcome", async () => {
  const student = as.get("student")!, admin = as.get("admin")!;
  for (const alias of ["faculty", "hod", "admin"]) await rejects(() => openCase(as.get(alias)!, { kind: "grievance", title: "x", body: "y" }));
  const id = await open(student, { kind: "grievance", title: "Lab access", body: "Fictional: lab was locked during my slot" });
  assert.ok((await cases(admin, "grievance")).some(c => c.id === id && c.assignee === null));
  for (const alias of ["outsider", "faculty", "hod", "principal"]) assert.ok(!(await cases(as.get(alias)!, "grievance")).some(c => c.id === id));
  assert.ok(!(await cases(as.get("tenant")!, "grievance")).some(c => c.id === id));
  await rejects(() => assignCase(student, { case: id, assignee: admin.account }));
  await rejects(() => assignCase(admin, { case: id, assignee: as.get("faculty")!.account }));
  await rejects(() => startCase(admin, id));
  await assignCase(admin, { case: id, assignee: admin.account });
  await rejects(() => addCaseNote(student, { case: id, body: "Student note" }));
  await startCase(admin, id);
  await addCaseNote(admin, { case: id, body: "Checked the lab booking log" });
  await rejects(() => closeCase(student, { case: id, outcome: "resolved", reason: "x" }));
  await closeCase(admin, { case: id, outcome: "resolved", reason: "Lab timetable corrected; access restored" });
  await rejects(() => closeCase(admin, { case: id, outcome: "declined", reason: "again" }));
  const mine = (await cases(student, "grievance")).find(c => c.id === id)!;
  assert.deepEqual([mine.state, mine.outcome, mine.notes.length], ["resolved", "Lab timetable corrected; access restored", 0]);
  assert.equal((await cases(admin, "grievance")).find(c => c.id === id)!.notes.length, 1);
  const told = await eventually(() => notifications(student), items => items.some(n => n.entity_id === id));
  assert.equal(told.find(n => n.entity_id === id)?.title, "Your grievance has been resolved");
  const actions = (await owner.query("SELECT action FROM audit_event WHERE institution_id=$1 AND entity_id=$2 ORDER BY id", [i, id])).rows.map(r => r.action);
  assert.deepEqual(actions, ["case.opened", "case.assigned", "case.started", "case.noted", "case.closed"]);
});

test("a grievance open for more than seven days becomes visible to the principal without its contents' notes", async () => {
  const id = await open(as.get("student")!, { kind: "grievance", title: "Hostel noise", body: "Fictional" });
  assert.ok(!(await cases(as.get("principal")!, "grievance")).some(c => c.id === id));
  await owner.query("UPDATE case_record SET created_at=now()-interval '8 days' WHERE institution_id=$1 AND id=$2", [i, id]);
  const seen = (await cases(as.get("principal")!, "grievance")).find(c => c.id === id);
  assert.deepEqual([seen?.escalated, seen?.notes.length], [true, 0]);
  await rejects(() => assignCase(as.get("principal")!, { case: id, assignee: as.get("admin")!.account }));
});

test("support cases are coordinated by the department head, owned by a teacher, measured, and hidden from students", async () => {
  const hod = as.get("hod")!, faculty = as.get("faculty")!, student = as.get("student")!;
  const subject = { student: student.account, department: fixtures.department };
  for (const alias of ["student", "admin", "principal", "replacement"]) await rejects(() => openCase(as.get(alias)!, { kind: "support", ...subject, title: "x", body: "y" }));
  await rejects(() => openCase(hod, { kind: "support", student: as.get("tenant")!.account, department: fixtures.department, title: "x", body: "y" }));
  const before = await caseSummary(hod, "support");
  const id = await open(hod, { kind: "support", ...subject, title: "Falling behind on labs", body: "Fictional: three labs missing" });
  await rejects(() => assignCase(hod, { case: id, assignee: as.get("replacement")!.account }));
  await assignCase(hod, { case: id, assignee: faculty.account });
  const assigned = await eventually(() => notifications(faculty), items => items.some(n => n.entity_id === id));
  assert.equal(assigned.find(n => n.entity_id === id)?.title, "Student support case assigned to you");
  assert.ok(!(await cases(as.get("replacement")!, "support")).some(c => c.id === id));
  assert.deepEqual(await cases(student, "support"), [], "students never see support cases");
  await rejects(() => closeCase(hod, { case: id, outcome: "resolved", reason: "Not the owner" }));
  await startCase(faculty, id);
  await closeCase(faculty, { case: id, outcome: "resolved", reason: "Extra lab session completed" });
  const after = await caseSummary(hod, "support");
  assert.equal(after.closed_90d, before.closed_90d + 1);
  assert.ok(after.median_hours !== null);
  const own = await open(faculty, { kind: "support", ...subject, title: "Needs reading list", body: "Fictional" });
  assert.equal((await cases(faculty, "support")).find(c => c.id === own)?.assignee, "Riya Rao", "a teacher's own case is assigned to them");
  assert.ok((await cases(hod, "support")).some(c => c.id === own));
});

test("cohort progress is principal-only and reports each term and section", async () => {
  const rows = await cohortProgress(as.get("principal")!);
  const a = rows.find(r => r.section === "Section A");
  assert.ok(a && a.students >= 1 && a.marked >= a.present);
  for (const alias of ["admin", "hod", "faculty", "student"]) assert.deepEqual(await cohortProgress(as.get(alias)!), []);
});
