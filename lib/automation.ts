import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { WorkflowError } from "./assignments";
import { db, transaction } from "./db";
import type { Scope } from "./scope";

type Job = { id: string; institution_id: string; event_id: string; rule_key: string; attempt: number; lease_token: string; entity_id: string };
const MAX_ATTEMPTS = 5;
const due = (column: string) => `to_char(${column} AT TIME ZONE i.timezone,'DD Mon YYYY, HH12:MI AM')`;

/**
 * Deterministic handlers. Each re-reads current state (the event may be stale), writes idempotently
 * (UNIQUE recipient+event) and returns a verifiable outcome, or null when the state no longer applies.
 */
const handlers: Record<string, (client: PoolClient, job: Job) => Promise<{ notified: number } | null>> = {
  async "assignment-published-notify"(client, job) {
    const live = await client.query("SELECT 1 FROM assignment WHERE institution_id=$1 AND id=$2 AND published_at IS NOT NULL", [job.institution_id, job.entity_id]);
    if (!live.rowCount) return null;
    const { rowCount } = await client.query(
      `INSERT INTO notification (institution_id,recipient_id,event_id,kind,entity_id,title)
       SELECT a.institution_id,r.account_id,$3,'assignment',a.id,left('New assignment: '||a.title||' · due '||${due("a.deadline")},300)
       FROM assignment a JOIN institution i ON i.id=a.institution_id
       JOIN roster r ON r.institution_id=a.institution_id AND r.offering_id=a.offering_id AND r.role='student' AND r.ended_at IS NULL
       JOIN membership m ON m.institution_id=r.institution_id AND m.account_id=r.account_id AND m.role='student' AND m.ended_at IS NULL
       WHERE a.institution_id=$1 AND a.id=$2 ON CONFLICT DO NOTHING`, [job.institution_id, job.entity_id, job.event_id]);
    return { notified: rowCount ?? 0 };
  },
  async "grade-published-notify"(client, job) {
    const { rowCount } = await client.query(
      `INSERT INTO notification (institution_id,recipient_id,event_id,kind,entity_id,title)
       SELECT s.institution_id,s.student_id,$3,'result',a.id,left('Result published: '||a.title,300)
       FROM submission s JOIN assignment a ON a.institution_id=s.institution_id AND a.id=s.assignment_id
       WHERE s.institution_id=$1 AND s.id=$2
         AND EXISTS (SELECT 1 FROM grade g WHERE g.institution_id=s.institution_id AND g.submission_id=s.id AND g.published_at IS NOT NULL)
       ON CONFLICT DO NOTHING`, [job.institution_id, job.entity_id, job.event_id]);
    const live = await client.query("SELECT 1 FROM grade WHERE institution_id=$1 AND submission_id=$2 AND published_at IS NOT NULL", [job.institution_id, job.entity_id]);
    return live.rowCount ? { notified: rowCount ?? 0 } : null;
  },
  async "request-submitted-route"(client, job) {
    const live = await client.query("SELECT 1 FROM service_request WHERE institution_id=$1 AND id=$2 AND status='submitted'", [job.institution_id, job.entity_id]);
    if (!live.rowCount) return null;
    const { rowCount } = await client.query(
      `INSERT INTO notification (institution_id,recipient_id,event_id,kind,entity_id,title)
       SELECT DISTINCT m.institution_id,m.account_id,$3::bigint,'request',$2::uuid,'New enrollment-letter request awaiting review'
       FROM membership m WHERE m.institution_id=$1 AND m.role='admin' AND m.ended_at IS NULL ON CONFLICT DO NOTHING`,
      [job.institution_id, job.entity_id, job.event_id]);
    return { notified: rowCount ?? 0 };
  },
};

/** Claim a bounded batch with a lease, then run each job in its own fenced transaction. */
export async function runJobs({ worker = "local", limit = 20, leaseSeconds = 60 } = {}) {
  await db.query("INSERT INTO worker_heartbeat (worker,seen_at) VALUES ($1,clock_timestamp()) ON CONFLICT (worker) DO UPDATE SET seen_at=EXCLUDED.seen_at", [worker]);
  const { rows: claimed } = await db.query<Job>(
    `WITH next AS (SELECT id FROM job WHERE (status='queued' AND run_after<=clock_timestamp()) OR (status='running' AND lease_until<clock_timestamp())
       ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED)
     UPDATE job j SET status='running',attempt=j.attempt+1,lease_token=gen_random_uuid(),lease_until=clock_timestamp()+make_interval(secs=>$2)
     FROM next, audit_event e WHERE j.id=next.id AND e.id=j.event_id
     RETURNING j.id::text,j.institution_id,j.event_id::text,j.rule_key,j.attempt,j.lease_token,e.entity_id`, [limit, leaseSeconds]);
  const summary = { succeeded: 0, skipped: 0, retried: 0, dead: 0 };
  for (const job of claimed) {
    try {
      const result = await transaction(async client => {
        const fence = await client.query("SELECT 1 FROM job WHERE id=$1 AND lease_token=$2 AND status='running' FOR UPDATE", [job.id, job.lease_token]);
        if (!fence.rowCount) return "fenced" as const;  // another worker re-leased an expired lease
        const paused = await client.query("SELECT 1 FROM automation_pause WHERE institution_id=$1 AND rule_key=$2", [job.institution_id, job.rule_key]);
        const handler = handlers[job.rule_key];
        if (!handler) throw new Error("unknown_handler");
        const outcome = paused.rowCount ? null : await handler(client, job);
        const status = outcome ? "succeeded" : "skipped";
        await client.query("UPDATE job SET status=$2,outcome=$3,finished_at=clock_timestamp(),lease_until=NULL,last_error=NULL WHERE id=$1",
          [job.id, status, outcome ?? { reason: paused.rowCount ? "paused" : "state_changed" }]);
        return status;
      });
      if (result !== "fenced") summary[result]++;
    } catch (error) {
      const dead = job.attempt >= MAX_ATTEMPTS;
      await db.query(
        `UPDATE job SET status=$3,last_error=$4,lease_until=NULL,run_after=clock_timestamp()+make_interval(secs=>$5),finished_at=CASE WHEN $3='dead' THEN clock_timestamp() END
         WHERE id=$1 AND lease_token=$2`,
        [job.id, job.lease_token, dead ? "dead" : "queued", (error as { code?: string }).code ?? (error as Error).message.slice(0, 80),
          Math.round(2 ** job.attempt * (1 + Math.random()))]);
      summary[dead ? "dead" : "retried"]++;
    }
  }
  return summary;
}

export async function notifications(current: Scope) {
  return (await db.query<{ id: string; kind: string; entity_id: string; title: string; created_at: Date; read_at: Date | null }>(
    `SELECT n.id,n.kind,n.entity_id,n.title,n.created_at,n.read_at FROM notification n
     WHERE n.institution_id=$1 AND n.recipient_id=$2
       AND EXISTS (SELECT 1 FROM membership m WHERE m.institution_id=n.institution_id AND m.account_id=n.recipient_id AND m.role=$3 AND m.ended_at IS NULL)
       AND n.kind = ANY($4) ORDER BY n.created_at DESC LIMIT 20`,
    [current.institution, current.account, current.role, current.role === "admin" ? ["request"] : ["assignment", "result"]],
  )).rows;
}

export async function markNotificationRead(current: Scope, id: string) {
  const { rowCount } = await db.query(
    "UPDATE notification SET read_at=coalesce(read_at,clock_timestamp()) WHERE institution_id=$1 AND recipient_id=$2 AND id=$3",
    [current.institution, current.account, id]);
  if (!rowCount) throw new WorkflowError("This notification is unavailable.");
}

async function requireAdmin(client: PoolClient | typeof db, current: Scope) {
  const { rowCount } = await client.query("SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role='admin' AND ended_at IS NULL", [current.institution, current.account]);
  if (current.role !== "admin" || !rowCount) throw new WorkflowError("This action is unavailable.");
}

/** Automation Centre read model: rules with measured run counts and worker liveness. Admin and principal only. */
export async function automationOverview(current: Scope) {
  if (current.role !== "admin" && current.role !== "principal") return null;
  const member = await db.query("SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role=$3 AND ended_at IS NULL", [current.institution, current.account, current.role]);
  if (!member.rowCount) return null;
  const [rules, failures, worker] = await Promise.all([
    db.query<{ key: string; title: string; event_type: string; authority: string; baseline_minutes: string | null; paused: boolean;
      succeeded: number; skipped: number; waiting: number; dead: number; notified: number; last_run: Date | null }>(
      `SELECT r.key,r.title,r.event_type,r.authority,r.baseline_minutes,
         EXISTS (SELECT 1 FROM automation_pause p WHERE p.institution_id=$1 AND p.rule_key=r.key) AS paused,
         count(j.id) FILTER (WHERE j.status='succeeded')::int AS succeeded, count(j.id) FILTER (WHERE j.status='skipped')::int AS skipped,
         count(j.id) FILTER (WHERE j.status IN ('queued','running'))::int AS waiting, count(j.id) FILTER (WHERE j.status='dead')::int AS dead,
         coalesce(sum((j.outcome->>'notified')::int),0)::int AS notified, max(j.finished_at) AS last_run
       FROM automation_rule r LEFT JOIN job j ON j.rule_key=r.key AND j.institution_id=$1 GROUP BY r.key ORDER BY r.key`, [current.institution]),
    db.query<{ id: string; rule_key: string; attempt: number; last_error: string | null; created_at: Date }>(
      "SELECT id::text,rule_key,attempt,last_error,created_at FROM job WHERE institution_id=$1 AND status='dead' ORDER BY id DESC LIMIT 10", [current.institution]),
    db.query<{ seen_at: Date | null; live: boolean }>("SELECT max(seen_at) AS seen_at, coalesce(max(seen_at) > clock_timestamp()-interval '30 seconds',false) AS live FROM worker_heartbeat"),
  ]);
  return { rules: rules.rows, failures: failures.rows, workerSeenAt: worker.rows[0]?.seen_at ?? null, workerLive: worker.rows[0]?.live ?? false };
}

export async function setRulePaused(current: Scope, rule: string, paused: boolean) {
  await transaction(async client => {
    await requireAdmin(client, current);
    const known = await client.query("SELECT 1 FROM automation_rule WHERE key=$1", [rule]);
    if (!known.rowCount) throw new WorkflowError("This rule is unavailable.");
    await client.query(paused
      ? "INSERT INTO automation_pause (institution_id,rule_key,paused_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING"
      : "DELETE FROM automation_pause WHERE institution_id=$1 AND rule_key=$2", paused ? [current.institution, rule, current.account] : [current.institution, rule]);
  });
}

export async function retryJob(current: Scope, id: string) {
  await transaction(async client => {
    await requireAdmin(client, current);
    const { rowCount } = await client.query(
      "UPDATE job SET status='queued',attempt=0,run_after=clock_timestamp(),finished_at=NULL,lease_token=$3 WHERE institution_id=$1 AND id=$2 AND status='dead'",
      [current.institution, id, randomUUID()]);
    if (!rowCount) throw new WorkflowError("This job is unavailable.");
  });
}
