import "../scripts/environment";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createAssignment, publishAssignment, submitAssignment, updateGrade } from "../lib/assignments";
import { createRequest } from "../lib/connected";
import { automationOverview, markNotificationRead, notifications, retryJob, runJobs, setRulePaused } from "../lib/automation";
import { db } from "../lib/db";
import type { Scope } from "../lib/scope";
import { fixtures as f, demoEmail } from "../scripts/fixtures";

const owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const people: Record<string, string> = {};
const as = (alias: string, role: Scope["role"], institution = f.institution): Scope => ({ account: people[alias], role, institution });
const future = () => new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Kolkata" })
  .format(new Date(Date.now() + 86_400_000)).replace(" ", "T");
const publish = async () => {
  const id = await createAssignment(as("faculty", "faculty"), { offering: f.offering, title: `Automation ${randomUUID()}`, description: "Steps.", deadline: future(), marks: 10, file: null });
  await publishAssignment(as("faculty", "faculty"), id);
  return id;
};
const jobFor = async (entity: string, rule: string) => (await owner.query<{ id: string; status: string; outcome: { notified?: number; reason?: string } }>(
  "SELECT j.id::text,j.status,j.outcome FROM job j JOIN audit_event e ON e.id=j.event_id WHERE e.entity_id=$1 AND j.rule_key=$2", [entity, rule])).rows;
const inbox = async (alias: string, role: Scope["role"], entity: string, institution = f.institution) =>
  (await notifications(as(alias, role, institution))).filter(n => n.entity_id === entity);

before(async () => {
  const { rows } = await owner.query<{ id: string; email: string }>('SELECT id,email FROM "user" WHERE email LIKE $1', ["%@nexus.example.invalid"]);
  for (const alias of ["student", "faculty", "outsider", "tenant", "admin", "principal"]) {
    const record = rows.find(row => row.email === demoEmail(alias));
    assert.ok(record, "Seed the fictional accounts before running integration tests.");
    people[alias] = record.id;
  }
  await owner.query("DELETE FROM automation_pause");
});

after(async () => { await Promise.all([db.end(), owner.end()]); });

test("publication enqueues in the same transaction and the worker notifies only the current roster, once", async () => {
  const id = await publish();
  assert.deepEqual((await jobFor(id, "assignment-published-notify")).map(j => j.status), ["queued"]);
  await runJobs({ worker: "test" });
  const [job] = await jobFor(id, "assignment-published-notify");
  assert.equal(job.status, "succeeded");
  assert.ok(job.outcome.notified! >= 1);
  const [notice] = await inbox("student", "student", id);
  assert.match(notice.title, /^New assignment: Automation .* · due /);
  assert.equal((await inbox("outsider", "student", id)).length, 0);
  assert.equal((await inbox("tenant", "student", id, f.otherInstitution)).length, 0);
  assert.equal((await inbox("faculty", "faculty", id)).length, 0);

  // Crash after commit but before acknowledgement: the lease expires, the job is re-run, nothing is duplicated.
  await owner.query("UPDATE job SET status='running',lease_until=now()-interval '1 second',lease_token=gen_random_uuid() WHERE id=$1", [job.id]);
  await runJobs({ worker: "test" });
  assert.equal((await jobFor(id, "assignment-published-notify"))[0].status, "succeeded");
  assert.equal((await inbox("student", "student", id)).length, 1);

  await assert.rejects(markNotificationRead(as("outsider", "student"), notice.id), /unavailable/);
  await markNotificationRead(as("student", "student"), notice.id);
  assert.ok((await inbox("student", "student", id))[0].read_at);
});

test("failed publication writes no job, and a paused rule is skipped with a recorded reason", async () => {
  const id = await createAssignment(as("faculty", "faculty"), { offering: f.offering, title: `Draft ${randomUUID()}`, description: "x", deadline: future(), marks: 10, file: null });
  assert.equal((await jobFor(id, "assignment-published-notify")).length, 0);
  await assert.rejects(setRulePaused(as("faculty", "faculty"), "assignment-published-notify", true), /unavailable/);
  await assert.rejects(setRulePaused(as("principal", "principal"), "assignment-published-notify", true), /unavailable/);
  await setRulePaused(as("admin", "admin"), "assignment-published-notify", true);
  try {
    const paused = await publish();
    await runJobs({ worker: "test" });
    const [job] = await jobFor(paused, "assignment-published-notify");
    assert.deepEqual([job.status, job.outcome.reason], ["skipped", "paused"]);
    assert.equal((await inbox("student", "student", paused)).length, 0);
  } finally {
    await setRulePaused(as("admin", "admin"), "assignment-published-notify", false);
  }
});

test("grade publication and service requests reach the right people", async () => {
  const id = await publish();
  const submission = await submitAssignment(as("student", "student"), id, randomUUID(), "Work", null);
  const grade = { assignment: id, submission, expected: 0, expectedDraft: false, marks: 8, feedback: "Clear.", publish: false };
  await updateGrade(as("faculty", "faculty"), grade);
  await runJobs({ worker: "test" });
  assert.equal((await inbox("student", "student", id)).filter(n => n.kind === "result").length, 0, "a draft grade is never announced");
  await updateGrade(as("faculty", "faculty"), { ...grade, expected: 1, expectedDraft: true, publish: true });
  await runJobs({ worker: "test" });
  assert.equal((await inbox("student", "student", id)).filter(n => n.kind === "result").length, 1);

  const before = (await notifications(as("admin", "admin"))).length;
  await createRequest(as("student", "student"), "Letter for a fictional scholarship.");
  await runJobs({ worker: "test" });
  assert.equal((await notifications(as("admin", "admin"))).length, Math.min(20, before + 1));
  assert.equal((await notifications(as("student", "student"))).filter(n => n.kind === "request").length, 0);
});

test("exhausted jobs go to the dead-letter list and only an admin can retry them", async () => {
  await owner.query("INSERT INTO automation_rule (key,event_type,title,authority) VALUES ('test-no-handler','test.none','Test only','L0') ON CONFLICT DO NOTHING");
  const { rows: [event] } = await owner.query<{ id: string }>("SELECT id::text FROM audit_event WHERE institution_id=$1 ORDER BY id DESC LIMIT 1", [f.institution]);
  const { rows: [job] } = await owner.query<{ id: string }>(
    "INSERT INTO job (institution_id,event_id,rule_key,attempt) VALUES ($1,$2,'test-no-handler',4) RETURNING id::text", [f.institution, event.id]);
  try {
    assert.equal((await runJobs({ worker: "test" })).dead >= 1, true);
    const overview = await automationOverview(as("admin", "admin"));
    assert.ok(overview?.failures.some(row => row.id === job.id && row.last_error === "unknown_handler"));
    assert.ok(overview?.workerSeenAt);
    assert.equal(await automationOverview(as("student", "student")), null);
    await assert.rejects(retryJob(as("principal", "principal"), job.id), /unavailable/);
    await retryJob(as("admin", "admin"), job.id);
    assert.equal((await owner.query("SELECT status FROM job WHERE id=$1", [job.id])).rows[0].status, "queued");
  } finally {
    await owner.query("DELETE FROM job WHERE rule_key='test-no-handler'");
    await owner.query("DELETE FROM automation_rule WHERE key='test-no-handler'");
  }
});
