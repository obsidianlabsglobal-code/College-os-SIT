// covers: AI-013, AD-023, SL-011
import "../scripts/environment";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Pool } from "pg";
import { createAssignment, publishAssignment, submitAssignment, updateGrade } from "../lib/assignments";
import { changeClass, sessionDetail } from "../lib/academic-day";
import { createRequest } from "../lib/connected";
import { automationOverview, cancelJob, effortSummary, markNotificationRead, notifications, retryJob, runJobs, setRuleState } from "../lib/automation";
import { db } from "../lib/db";
import type { Scope } from "../lib/scope";
import { fixtures as f, demoEmail } from "../scripts/fixtures";

const owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const people: Record<string, string> = {};
const room = randomUUID();
const as = (alias: string, role: Scope["role"], institution = f.institution): Scope => ({ account: people[alias], role, institution });
const wall = (offsetMs: number) => new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Kolkata" })
  .format(new Date(Date.now() + offsetMs)).replace(" ", "T");
const DAY = 86_400_000;
const publish = async (deadlineMs = 30 * DAY) => {
  const id = await createAssignment(as("faculty", "faculty"), { offering: f.offering, title: `Automation ${randomUUID()}`, description: "Steps.", deadline: wall(deadlineMs), marks: 10, file: null });
  await publishAssignment(as("faculty", "faculty"), id);
  return id;
};
type JobRow = { id: string; status: string; attempt: number; run_after: Date; outcome: { notified?: number; reason?: string } | null; last_error: string | null };
const jobFor = async (entity: string, rule: string) => (await owner.query<JobRow>(
  "SELECT j.id::text,j.status,j.attempt,j.run_after,j.outcome,j.last_error FROM job j JOIN audit_event e ON e.id=j.event_id WHERE e.entity_id=$1 AND j.rule_key=$2 ORDER BY j.id",
  [entity, rule])).rows;
const inbox = async (alias: string, role: Scope["role"], entity: string, institution = f.institution) =>
  (await notifications(as(alias, role, institution))).filter(n => n.entity_id === entity);
const dueNow = (rule: string) => owner.query("UPDATE job SET run_after=now() WHERE rule_key=$1 AND status='queued'", [rule]);

before(async () => {
  const { rows } = await owner.query<{ id: string; email: string }>('SELECT id,email FROM "user" WHERE email LIKE $1', ["%@nexus.example.invalid"]);
  for (const alias of ["student", "faculty", "outsider", "tenant", "admin", "principal"]) {
    const record = rows.find(row => row.email === demoEmail(alias));
    assert.ok(record, "Seed the fictional accounts before running integration tests.");
    people[alias] = record.id;
  }
  await owner.query("DELETE FROM automation_setting");
  await owner.query("INSERT INTO campus_resource (institution_id,id,name,kind,location) VALUES ($1,$2,$3,'room','Automation test wing')", [f.institution, room, `Room ${room.slice(0, 6)}`]);
});

after(async () => {
  try {
    for (const table of ["class_attendance_mark", "class_attendance_revision"]) await owner.query(
      `DELETE FROM ${table} WHERE institution_id=$1 AND session_id IN (SELECT id FROM class_session WHERE institution_id=$1 AND room_id=$2)`, [f.institution, room]);
    await owner.query("DELETE FROM class_session WHERE institution_id=$1 AND room_id=$2", [f.institution, room]);
    await owner.query("DELETE FROM campus_resource WHERE institution_id=$1 AND id=$2", [f.institution, room]);
    await owner.query("DELETE FROM automation_setting");
  } finally {
    await Promise.all([db.end(), owner.end()]);
  }
});

test("publication enqueues atomically; delivery reaches only the current roster, once, and is re-checked on display", async () => {
  const id = await publish();
  assert.deepEqual((await jobFor(id, "assignment-published-notify")).map(j => j.status), ["queued"]);
  await runJobs({ worker: "test" });
  const [job] = await jobFor(id, "assignment-published-notify");
  assert.equal(job.status, "succeeded");
  const [notice] = await inbox("student", "student", id);
  assert.match(notice.title, /^New assignment: Automation .* · due /);
  for (const [alias, role, inst] of [["outsider", "student", f.institution], ["tenant", "student", f.otherInstitution], ["faculty", "faculty", f.institution]] as const)
    assert.equal((await inbox(alias, role, id, inst)).length, 0);

  // Crash after commit but before acknowledgement: the lease expires, the job re-runs, nothing is duplicated.
  await owner.query("UPDATE job SET status='running',lease_until=now()-interval '1 second',lease_token=gen_random_uuid() WHERE id=$1", [job.id]);
  await runJobs({ worker: "test" });
  assert.equal((await inbox("student", "student", id)).length, 1);
  // A lease still held by another worker is never stolen.
  await owner.query("UPDATE job SET status='running',lease_until=now()+interval '1 minute',lease_token=gen_random_uuid() WHERE id=$1", [job.id]);
  await runJobs({ worker: "test" });
  assert.equal((await owner.query("SELECT status FROM job WHERE id=$1", [job.id])).rows[0].status, "running");
  await owner.query("UPDATE job SET status='succeeded',lease_until=NULL WHERE id=$1", [job.id]);

  // Revoked roster hides the item immediately, even though it was delivered.
  await owner.query("UPDATE roster SET ended_at=now() WHERE institution_id=$1 AND offering_id=$2 AND account_id=$3 AND role='student'", [f.institution, f.offering, people.student]);
  try {
    assert.equal((await inbox("student", "student", id)).length, 0);
    await assert.rejects(markNotificationRead(as("student", "student"), notice.id), /unavailable/);
  } finally {
    await owner.query("UPDATE roster SET ended_at=NULL WHERE institution_id=$1 AND offering_id=$2 AND account_id=$3 AND role='student'", [f.institution, f.offering, people.student]);
  }
  await assert.rejects(markNotificationRead(as("outsider", "student"), notice.id), /unavailable/);
  await markNotificationRead(as("student", "student"), notice.id);
  assert.ok((await inbox("student", "student", id))[0].read_at);
});

test("jobs and notifications cannot reference another institution's events", async () => {
  const { rows: [event] } = await owner.query<{ id: string }>("SELECT id::text FROM audit_event WHERE institution_id=$1 ORDER BY id DESC LIMIT 1", [f.institution]);
  await assert.rejects(owner.query("INSERT INTO job (institution_id,event_id,rule_key) VALUES ($1,$2,'assignment-published-notify')", [f.otherInstitution, event.id]),
    (error: { code?: string }) => error.code === "23503");
  await assert.rejects(owner.query("INSERT INTO notification (institution_id,recipient_id,event_id,kind,entity_id,title) VALUES ($1,$2,$3,'assignment',$4,'x')",
    [f.otherInstitution, people.tenant, event.id, randomUUID()]), (error: { code?: string }) => error.code === "23503");
});

test("pause holds work, resume releases it, disable ignores events and cancels waiting work; every change is audited", async () => {
  const rule = "assignment-published-notify";
  for (const [alias, role] of [["faculty", "faculty"], ["principal", "principal"]] as const)
    await assert.rejects(setRuleState(as(alias, role), rule, "paused"), /unavailable/);
  await setRuleState(as("admin", "admin"), rule, "paused");
  const held = await publish();
  await runJobs({ worker: "test" });
  assert.deepEqual((await jobFor(held, rule)).map(j => [j.status, j.attempt]), [["queued", 0]]);
  assert.equal((await inbox("student", "student", held)).length, 0);
  await setRuleState(as("admin", "admin"), rule, "active");
  await runJobs({ worker: "test" });
  assert.equal((await jobFor(held, rule))[0].status, "succeeded");
  assert.equal((await inbox("student", "student", held)).length, 1);

  await setRuleState(as("admin", "admin"), rule, "paused");
  const waiting = await publish();
  await setRuleState(as("admin", "admin"), rule, "disabled");
  assert.equal((await jobFor(waiting, rule))[0].status, "cancelled");
  const ignored = await publish();
  assert.equal((await jobFor(ignored, rule)).length, 0, "a disabled rule creates no jobs");
  assert.equal((await jobFor(ignored, "assignment-deadline-reminder")).length, 1, "other rules for the same event are unaffected");
  await setRuleState(as("admin", "admin"), rule, "active");
  const { rows } = await owner.query<{ action: string }>(
    "SELECT action FROM audit_event WHERE institution_id=$1 AND ref=$2 AND action LIKE 'automation.rule.%' ORDER BY id DESC LIMIT 5", [f.institution, rule]);
  assert.deepEqual(rows.map(r => r.action), ["automation.rule.active", "automation.rule.disabled", "automation.rule.paused", "automation.rule.active", "automation.rule.paused"]);
});

test("deadline reminders wait for T-24h, follow a moved deadline, skip submitters and expire after the deadline", async () => {
  const rule = "assignment-deadline-reminder";
  const submitted = await publish(), open = await publish(), late = await publish();
  await runJobs({ worker: "test" });
  const [deferred] = await jobFor(open, rule);
  assert.deepEqual([deferred.status, deferred.attempt], ["queued", 0]);
  assert.ok(Math.abs(deferred.run_after.getTime() - (Date.now() + 29 * DAY)) < 5 * 60_000, "deferred to deadline − 24h");
  // Reschedule: the deadline moves closer; the handler re-reads it, so the next run delivers.
  await submitAssignment(as("student", "student"), submitted, randomUUID(), "Done early", null);
  await owner.query("UPDATE assignment SET deadline=now()+interval '12 hours' WHERE id = ANY($1)", [[submitted, open]]);
  await owner.query("UPDATE assignment SET deadline=now()-interval '1 minute' WHERE id=$1", [late]);
  await dueNow(rule);
  await runJobs({ worker: "test" });
  assert.equal((await inbox("student", "student", open)).filter(n => n.kind === "reminder").length, 1);
  assert.equal((await inbox("student", "student", submitted)).filter(n => n.kind === "reminder").length, 0, "submitters are not reminded");
  assert.equal((await jobFor(late, rule))[0].outcome?.reason, "deadline_passed");
  await owner.query("UPDATE job SET status='queued',run_after=now() WHERE id=$1", [(await jobFor(open, rule))[0].id]);
  await runJobs({ worker: "test" });
  assert.equal((await inbox("student", "student", open)).filter(n => n.kind === "reminder").length, 1, "duplicate delivery is impossible");
  // Leave no near-due fixtures behind for the browser suites' "Due next" checks.
  await owner.query("UPDATE assignment SET deadline=now()-interval '1 minute' WHERE id = ANY($1)", [[submitted, open]]);
});

test("timetable changes notify enrolled students; superseded changes are skipped; attendance summaries go to the teacher", async () => {
  const admin = as("admin", "admin");
  const day = wall(2 * DAY).slice(0, 10);
  const session = await changeClass(admin, { operation: "draft", room, offering: f.offering, faculty: people.faculty, start: `${day}T08:00`, end: `${day}T08:30`, weeks: 1 });
  await changeClass(admin, { operation: "publish", session, revision: 0 });
  await changeClass(admin, { operation: "move", session, revision: 1, start: `${day}T13:00`, end: `${day}T13:30`, reason: "Fictional seminar" });
  await changeClass(admin, { operation: "move", session, revision: 2, start: `${day}T14:00`, end: `${day}T14:30`, reason: "Fictional seminar" });
  await runJobs({ worker: "test" });
  const moves = await jobFor(session, "class-change-notify");
  assert.deepEqual(moves.map(j => [j.status, j.outcome?.reason ?? null]), [["skipped", "superseded"], ["succeeded", null]]);
  const [moved] = (await inbox("student", "student", session)).filter(n => n.kind === "class");
  assert.match(moved.title, /^Class moved: .* · now .*02:00 PM/);
  assert.equal((await inbox("outsider", "student", session)).length, 0);
  await changeClass(admin, { operation: "cancel", session, revision: 3, reason: "Fictional holiday" });
  await runJobs({ worker: "test" });
  assert.ok((await inbox("student", "student", session)).some(n => n.title.startsWith("Class cancelled: ")));

  const yesterday = wall(-DAY).slice(0, 10);
  const held = await changeClass(admin, { operation: "draft", room, offering: f.offering, faculty: people.faculty, start: `${yesterday}T10:00`, end: `${yesterday}T10:30`, weeks: 1 });
  await changeClass(admin, { operation: "publish", session: held, revision: 0 });
  const detail = await sessionDetail(as("faculty", "faculty"), held);
  await changeClass(as("faculty", "faculty"), { operation: "attendance", session: held, revision: 1, reason: "",
    marks: detail!.learners.map(l => ({ student: l.student, status: l.student === people.student ? "present" : "absent" })) });
  await runJobs({ worker: "test" });
  const [summary] = await inbox("faculty", "faculty", held);
  assert.match(summary.title, /^Attendance summary ready to share: .* · 1 of \d+ present$/);
  assert.equal((await inbox("student", "student", held)).length, 0, "students do not see the teacher's summary");
});

test("results and requests: drafts stay private, requests route to admins and escalate after 48 hours", async () => {
  const id = await publish();
  const submission = await submitAssignment(as("student", "student"), id, randomUUID(), "Work", null);
  const grade = { assignment: id, submission, expected: 0, expectedDraft: false, marks: 8, feedback: "Clear.", publish: false };
  await updateGrade(as("faculty", "faculty"), grade);
  await runJobs({ worker: "test" });
  assert.equal((await inbox("student", "student", id)).filter(n => n.kind === "result").length, 0, "a draft grade is never announced");
  await updateGrade(as("faculty", "faculty"), { ...grade, expected: 1, expectedDraft: true, publish: true });
  await runJobs({ worker: "test" });
  assert.equal((await inbox("student", "student", id)).filter(n => n.kind === "result").length, 1);

  await createRequest(as("student", "student"), "Letter for a fictional scholarship.");
  const { rows: [request] } = await owner.query<{ id: string }>("SELECT id FROM service_request WHERE student_id=$1 ORDER BY created_at DESC LIMIT 1", [people.student]);
  await runJobs({ worker: "test" });
  assert.equal((await inbox("admin", "admin", request.id)).map(n => n.kind).join(), "request");
  assert.equal((await jobFor(request.id, "request-sla-escalate"))[0].status, "queued", "escalation is scheduled, not immediate");
  await owner.query("UPDATE service_request SET created_at=now()-interval '49 hours' WHERE id=$1", [request.id]);
  await dueNow("request-sla-escalate");
  await runJobs({ worker: "test" });
  assert.deepEqual((await inbox("admin", "admin", request.id)).map(n => n.kind).sort(), ["followup", "request"]);
  assert.equal((await inbox("principal", "principal", request.id))[0].kind, "escalation");
  assert.equal((await inbox("student", "student", request.id)).length, 0);
});

test("concurrent workers process each job exactly once", async () => {
  const ids = await Promise.all([publish(), publish(), publish()]);
  const results = await Promise.all([runJobs({ worker: "a" }), runJobs({ worker: "b" }), runJobs({ worker: "c" })]);
  assert.equal(results.reduce((sum, r) => sum + r.fenced + r.dead + r.retried, 0), 0);
  for (const id of ids) {
    assert.deepEqual((await jobFor(id, "assignment-published-notify")).map(j => [j.status, j.attempt]), [["succeeded", 1]]);
    assert.equal((await inbox("student", "student", id)).length, 1);
  }
});

test("exhausted jobs dead-letter with a sanitized category; only admins retry or cancel, and both are audited", async () => {
  await owner.query("INSERT INTO automation_rule (key,event_type,title,authority,workflow) VALUES ('test-no-handler','test.none','Test only','L0','requests') ON CONFLICT DO NOTHING");
  const { rows: [event] } = await owner.query<{ id: string }>("SELECT id::text FROM audit_event WHERE institution_id=$1 ORDER BY id DESC LIMIT 1", [f.institution]);
  const { rows: [job] } = await owner.query<{ id: string }>(
    "INSERT INTO job (institution_id,event_id,rule_key,attempt) VALUES ($1,$2,'test-no-handler',4) RETURNING id::text", [f.institution, event.id]);
  try {
    assert.ok((await runJobs({ worker: "test" })).dead >= 1);
    const overview = await automationOverview(as("admin", "admin"));
    assert.ok(overview?.failures.some(row => row.id === job.id && row.last_error === "unknown_handler"));
    assert.equal(await automationOverview(as("student", "student")), null);
    await assert.rejects(retryJob(as("principal", "principal"), job.id), /unavailable/);
    await retryJob(as("admin", "admin"), job.id);
    await cancelJob(as("admin", "admin"), job.id);
    assert.equal((await owner.query("SELECT status FROM job WHERE id=$1", [job.id])).rows[0].status, "cancelled");
    await assert.rejects(cancelJob(as("admin", "admin"), job.id), /unavailable/);
    const { rows } = await owner.query("SELECT action FROM audit_event WHERE ref=$1 ORDER BY id", [`job:${job.id}`]);
    assert.deepEqual(rows.map(r => r.action), ["automation.job.retried", "automation.job.cancelled"]);
    const errors = (await owner.query<{ last_error: string }>("SELECT DISTINCT last_error FROM job WHERE last_error IS NOT NULL")).rows;
    assert.ok(errors.every(e => /^(db_[0-9A-Z]{5}|unknown_handler|handler_error)$/.test(e.last_error)), "no raw error text is stored");
  } finally {
    await owner.query("DELETE FROM job WHERE rule_key='test-no-handler'");
    await owner.query("DELETE FROM automation_rule WHERE key='test-no-handler'");
  }
});

test("effort reduction is computed per case and never mixes synthetic with measured evidence", async () => {
  const sample = (phase: string, quality: string, cases: number, minutes: number) => owner.query(
    "INSERT INTO automation_effort_sample (institution_id,workflow,phase,quality,cases,human_minutes,method,recorded_by) VALUES ($1,'timetable',$2,$3,$4,$5,'Test fixture',$6)",
    [f.otherInstitution, phase, quality, cases, minutes, people.tenant]);
  try {
    await sample("baseline", "synthetic", 10, 150); await sample("post", "synthetic", 10, 15); await sample("baseline", "measured", 4, 40);
    const rows = await effortSummary({ account: people.tenant, role: "admin", institution: f.otherInstitution });
    assert.deepEqual(rows.map(r => [r.quality, r.baseline, r.post, r.reduction]), [["measured", 10, null, null], ["synthetic", 15, 1.5, 90]]);
  } finally {
    await owner.query("DELETE FROM automation_effort_sample WHERE institution_id=$1", [f.otherInstitution]);
  }
});

test("the worker runs as the least-privilege role and cannot read credentials", async () => {
  assert.ok(process.env.WORKER_DATABASE_URL, "Set WORKER_DATABASE_URL for the nexus_worker role.");
  const worker = new Pool({ connectionString: process.env.WORKER_DATABASE_URL });
  try {
    await assert.rejects(worker.query("SELECT 1 FROM account LIMIT 1"), (error: { code?: string }) => error.code === "42501");
    await assert.rejects(worker.query("UPDATE assignment SET title=title"), (error: { code?: string }) => error.code === "42501");
    await assert.rejects(worker.query("INSERT INTO audit_event (institution_id,actor_id,entity_id,action) VALUES ($1,$2,$1,'x')", [f.institution, people.admin]),
      (error: { code?: string }) => error.code === "42501");
  } finally {
    await worker.end();
  }
  const id = await publish();
  const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/worker.ts", "--once"], { env: { ...process.env, NEXUS_DB_ROLE: "worker" } });
  assert.match(stdout, /succeeded/);
  assert.equal((await inbox("student", "student", id)).length, 1);
});
