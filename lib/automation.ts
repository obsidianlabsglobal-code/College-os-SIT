import type { PoolClient } from "pg";
import { WorkflowError } from "./assignments";
import { db, transaction } from "./db";
import type { Scope } from "./scope";

type Job = { id: string; institution_id: string; event_id: string; rule_key: string; attempt: number; lease_token: string;
  entity_id: string; revision: number | null; occurred_at: Date };
/** A handler re-reads current state and either acts (idempotently), skips with a reason, or defers to a later time. */
type Result = { notified: number } | { skip: string } | { defer: Date };
const MAX_ATTEMPTS = 5;
const DAY = 86_400_000;
const when = (column: string) => `to_char(${column} AT TIME ZONE i.timezone,'DD Mon YYYY, HH12:MI AM')`;
const notify = async (client: PoolClient, sql: string, params: unknown[]) => ({ notified: (await client.query(sql, params)).rowCount ?? 0 });
// Active students of an offering (roster and institutional membership both current).
const students = `JOIN roster r ON r.institution_id=o.institution_id AND r.offering_id=o.id AND r.role='student' AND r.ended_at IS NULL
  JOIN membership m ON m.institution_id=r.institution_id AND m.account_id=r.account_id AND m.role='student' AND m.ended_at IS NULL`;

async function classChange(client: PoolClient, job: Job, state: string, title: string): Promise<Result> {
  const { rows: [session] } = await client.query<{ state: string; revision: number }>(
    "SELECT state,revision FROM class_session WHERE institution_id=$1 AND id=$2", [job.institution_id, job.entity_id]);
  if (!session || session.state !== state) return { skip: "state_changed" };
  if (job.revision !== null && session.revision !== job.revision) return { skip: "superseded" };  // a later change has its own job
  return notify(client,
    `INSERT INTO notification (institution_id,recipient_id,event_id,kind,entity_id,title)
     SELECT s.institution_id,r.account_id,$3,'class',s.id,left(${title},300)
     FROM class_session s JOIN institution i ON i.id=s.institution_id JOIN offering o ON o.institution_id=s.institution_id AND o.id=s.offering_id
     JOIN course c ON c.institution_id=o.institution_id AND c.id=o.course_id
     JOIN campus_resource room ON room.institution_id=s.institution_id AND room.id=s.room_id ${students}
     WHERE s.institution_id=$1 AND s.id=$2 ON CONFLICT DO NOTHING`, [job.institution_id, job.entity_id, job.event_id]);
}

const handlers: Record<string, (client: PoolClient, job: Job) => Promise<Result>> = {
  async "assignment-published-notify"(client, job) {
    const live = await client.query("SELECT 1 FROM assignment WHERE institution_id=$1 AND id=$2 AND published_at IS NOT NULL", [job.institution_id, job.entity_id]);
    if (!live.rowCount) return { skip: "state_changed" };
    return notify(client,
      `INSERT INTO notification (institution_id,recipient_id,event_id,kind,entity_id,title)
       SELECT a.institution_id,r.account_id,$3,'assignment',a.id,left('New assignment: '||a.title||' · due '||${when("a.deadline")},300)
       FROM assignment a JOIN institution i ON i.id=a.institution_id JOIN offering o ON o.institution_id=a.institution_id AND o.id=a.offering_id ${students}
       WHERE a.institution_id=$1 AND a.id=$2 ON CONFLICT DO NOTHING`, [job.institution_id, job.entity_id, job.event_id]);
  },
  async "assignment-deadline-reminder"(client, job) {
    const { rows: [a] } = await client.query<{ deadline: Date; published: boolean; now: Date }>(
      "SELECT deadline,published_at IS NOT NULL AS published,clock_timestamp() AS now FROM assignment WHERE institution_id=$1 AND id=$2",
      [job.institution_id, job.entity_id]);
    if (!a?.published) return { skip: "state_changed" };
    if (a.deadline <= a.now) return { skip: "deadline_passed" };
    const due = new Date(a.deadline.getTime() - DAY);
    if (a.now < due) return { defer: due };  // re-read on every run, so a moved deadline moves the reminder
    return notify(client,
      `INSERT INTO notification (institution_id,recipient_id,event_id,kind,entity_id,title)
       SELECT a.institution_id,r.account_id,$3,'reminder',a.id,left('Due within 24 hours: '||a.title||' · '||${when("a.deadline")},300)
       FROM assignment a JOIN institution i ON i.id=a.institution_id JOIN offering o ON o.institution_id=a.institution_id AND o.id=a.offering_id ${students}
       WHERE a.institution_id=$1 AND a.id=$2
         AND NOT EXISTS (SELECT 1 FROM submission s WHERE s.institution_id=a.institution_id AND s.assignment_id=a.id AND s.student_id=r.account_id)
       ON CONFLICT DO NOTHING`, [job.institution_id, job.entity_id, job.event_id]);
  },
  async "grade-published-notify"(client, job) {
    const live = await client.query("SELECT 1 FROM grade WHERE institution_id=$1 AND submission_id=$2 AND published_at IS NOT NULL", [job.institution_id, job.entity_id]);
    if (!live.rowCount) return { skip: "state_changed" };
    return notify(client,
      `INSERT INTO notification (institution_id,recipient_id,event_id,kind,entity_id,title)
       SELECT s.institution_id,s.student_id,$3,'result',a.id,left('Result published: '||a.title,300)
       FROM submission s JOIN assignment a ON a.institution_id=s.institution_id AND a.id=s.assignment_id
       WHERE s.institution_id=$1 AND s.id=$2 ON CONFLICT DO NOTHING`, [job.institution_id, job.entity_id, job.event_id]);
  },
  "class-change-notify": (client, job) => classChange(client, job, "published", `'Class moved: '||c.name||' · now '||${when("lower(s.slot)")}||' · '||room.name`),
  "class-cancel-notify": (client, job) => classChange(client, job, "cancelled", `'Class cancelled: '||c.name||' · '||${when("lower(s.slot)")}`),
  "class-room-notify": (client, job) => classChange(client, job, "published", `'Room changed: '||c.name||' · '||${when("lower(s.slot)")}||' · now in '||room.name`),
  async "attendance-summary-prepare"(client, job) {
    const { rows: [s] } = await client.query<{ revision: number }>(
      "SELECT max(revision) AS revision FROM class_attendance_revision WHERE institution_id=$1 AND session_id=$2", [job.institution_id, job.entity_id]);
    if (!s?.revision) return { skip: "state_changed" };
    return notify(client,
      `INSERT INTO notification (institution_id,recipient_id,event_id,kind,entity_id,title)
       SELECT s.institution_id,s.faculty_id,$3,'attendance',s.id,left('Attendance summary ready to share: '||c.name||' · '||${when("lower(s.slot)")}
         ||' · '||count(*) FILTER (WHERE k.status='present')||' of '||count(*)||' present',300)
       FROM class_session s JOIN institution i ON i.id=s.institution_id JOIN offering o ON o.institution_id=s.institution_id AND o.id=s.offering_id
       JOIN course c ON c.institution_id=o.institution_id AND c.id=o.course_id
       JOIN class_attendance_mark k ON k.institution_id=s.institution_id AND k.session_id=s.id AND k.revision=$4
       WHERE s.institution_id=$1 AND s.id=$2
         AND EXISTS (SELECT 1 FROM roster f WHERE f.institution_id=s.institution_id AND f.offering_id=s.offering_id AND f.account_id=s.faculty_id AND f.role='faculty' AND f.ended_at IS NULL)
       GROUP BY s.institution_id,s.faculty_id,s.id,c.name,s.slot,i.timezone ON CONFLICT DO NOTHING`,
      [job.institution_id, job.entity_id, job.event_id, s.revision]);
  },
  async "request-submitted-route"(client, job) {
    const live = await client.query("SELECT 1 FROM service_request WHERE institution_id=$1 AND id=$2 AND status='submitted'", [job.institution_id, job.entity_id]);
    if (!live.rowCount) return { skip: "state_changed" };
    return notify(client,
      `INSERT INTO notification (institution_id,recipient_id,event_id,kind,entity_id,title)
       SELECT m.institution_id,m.account_id,$3::bigint,'request',$2::uuid,'New enrollment-letter request awaiting review'
       FROM membership m WHERE m.institution_id=$1 AND m.role='admin' AND m.ended_at IS NULL ON CONFLICT DO NOTHING`,
      [job.institution_id, job.entity_id, job.event_id]);
  },
  async "request-assigned-notify"(client, job) {
    // Only the latest assignment notifies: a later reassignment supersedes this event.
    const { rows: [r] } = await client.query<{ open: boolean; current: boolean }>(
      `SELECT q.status IN ('submitted','in_progress') AS open, q.assigned_at <= e.occurred_at AS current
       FROM service_request q JOIN audit_event e ON e.institution_id=q.institution_id AND e.id=$3
       WHERE q.institution_id=$1 AND q.id=$2 AND q.assigned_to IS NOT NULL`, [job.institution_id, job.entity_id, job.event_id]);
    if (!r?.open) return { skip: "handled" };
    if (!r.current) return { skip: "superseded" };
    return notify(client,
      `INSERT INTO notification (institution_id,recipient_id,event_id,kind,entity_id,title)
       SELECT q.institution_id,q.assigned_to,$3::bigint,'request',q.id,'Enrollment-letter request assigned to you'
       FROM service_request q JOIN membership m ON m.institution_id=q.institution_id AND m.account_id=q.assigned_to AND m.role='admin' AND m.ended_at IS NULL
       WHERE q.institution_id=$1 AND q.id=$2 ON CONFLICT DO NOTHING`,
      [job.institution_id, job.entity_id, job.event_id]);
  },
  async "attendance-correction-route"(client, job) {
    const live = await client.query("SELECT 1 FROM attendance_correction WHERE institution_id=$1 AND id=$2 AND status='submitted'", [job.institution_id, job.entity_id]);
    if (!live.rowCount) return { skip: "handled" };
    return notify(client,
      `INSERT INTO notification (institution_id,recipient_id,event_id,kind,entity_id,title)
       SELECT k.institution_id,s.faculty_id,$3::bigint,'correction',k.id,left('Attendance correction requested: '||c.name||' · '||${when("lower(s.slot)")},300)
       FROM attendance_correction k JOIN class_session s ON s.institution_id=k.institution_id AND s.id=k.session_id
       JOIN institution i ON i.id=k.institution_id JOIN offering o ON o.institution_id=s.institution_id AND o.id=s.offering_id
       JOIN course c ON c.institution_id=o.institution_id AND c.id=o.course_id
       WHERE k.institution_id=$1 AND k.id=$2 ON CONFLICT DO NOTHING`, [job.institution_id, job.entity_id, job.event_id]);
  },
  async "attendance-correction-decided"(client, job) {
    return notify(client,
      `INSERT INTO notification (institution_id,recipient_id,event_id,kind,entity_id,title)
       SELECT k.institution_id,k.student_id,$3::bigint,'correction',k.id,left('Attendance correction '||k.status||': '||c.name||' · '||${when("lower(s.slot)")},300)
       FROM attendance_correction k JOIN class_session s ON s.institution_id=k.institution_id AND s.id=k.session_id
       JOIN institution i ON i.id=k.institution_id JOIN offering o ON o.institution_id=s.institution_id AND o.id=s.offering_id
       JOIN course c ON c.institution_id=o.institution_id AND c.id=o.course_id
       WHERE k.institution_id=$1 AND k.id=$2 AND k.status<>'submitted' ON CONFLICT DO NOTHING`, [job.institution_id, job.entity_id, job.event_id]);
  },
  async "request-sla-escalate"(client, job) {
    const { rows: [r] } = await client.query<{ status: string; created_at: Date; now: Date }>(
      "SELECT status,created_at,clock_timestamp() AS now FROM service_request WHERE institution_id=$1 AND id=$2", [job.institution_id, job.entity_id]);
    if (!r || r.status !== "submitted") return { skip: "handled" };
    const due = new Date(r.created_at.getTime() + 2 * DAY);
    if (r.now < due) return { defer: due };
    return notify(client,
      `INSERT INTO notification (institution_id,recipient_id,event_id,kind,entity_id,title)
       SELECT m.institution_id,m.account_id,$3::bigint,CASE m.role WHEN 'admin' THEN 'followup' ELSE 'escalation' END,$2::uuid,
         'Enrollment-letter request waiting more than 48 hours without review'
       FROM membership m WHERE m.institution_id=$1 AND m.role IN ('admin','principal') AND m.ended_at IS NULL ON CONFLICT DO NOTHING`,
      [job.institution_id, job.entity_id, job.event_id]);
  },
};

// Stored errors are categories, never raw messages (which can carry record contents).
const category = (error: unknown) => {
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return `db_${code}`;
  return (error as Error)?.message === "unknown_handler" ? "unknown_handler" : "handler_error";
};
const held = `EXISTS (SELECT 1 FROM automation_setting s WHERE s.institution_id=j.institution_id AND s.rule_key=j.rule_key AND s.state<>'active')`;

/** Claim a bounded batch with a lease, then run each job in its own fenced transaction. */
export async function runJobs({ worker = "local", limit = 20, leaseSeconds = 60 } = {}) {
  await db.query("INSERT INTO worker_heartbeat (worker,seen_at) VALUES ($1,clock_timestamp()) ON CONFLICT (worker) DO UPDATE SET seen_at=EXCLUDED.seen_at", [worker]);
  const { rows: claimed } = await db.query<Job>(
    `WITH next AS (SELECT j.id FROM job j WHERE ((j.status='queued' AND j.run_after<=clock_timestamp()) OR (j.status='running' AND j.lease_until<clock_timestamp()))
       AND NOT ${held} ORDER BY j.run_after,j.id LIMIT $1 FOR UPDATE SKIP LOCKED)
     UPDATE job j SET status='running',attempt=j.attempt+1,lease_token=gen_random_uuid(),lease_until=clock_timestamp()+make_interval(secs=>$2)
     FROM next, audit_event e WHERE j.id=next.id AND e.institution_id=j.institution_id AND e.id=j.event_id
     RETURNING j.id::text,j.institution_id,j.event_id::text,j.rule_key,j.attempt,j.lease_token,e.entity_id,e.revision,e.occurred_at`, [limit, leaseSeconds]);
  const summary = { succeeded: 0, skipped: 0, deferred: 0, held: 0, retried: 0, dead: 0, fenced: 0 };
  for (const job of claimed) {
    try {
      const status = await transaction(async client => {
        const fence = await client.query(`SELECT ${held} AS held FROM job j WHERE id=$1 AND lease_token=$2 AND status='running' FOR UPDATE`, [job.id, job.lease_token]);
        if (!fence.rowCount) return "fenced" as const;  // the lease expired and another worker owns the job now
        if (fence.rows[0].held) {  // paused or disabled after the claim: hand back without spending an attempt
          await client.query("UPDATE job SET status='queued',attempt=attempt-1,lease_until=NULL WHERE id=$1", [job.id]);
          return "held" as const;
        }
        const handler = handlers[job.rule_key];
        if (!handler) throw new Error("unknown_handler");
        const result = await handler(client, job);
        if ("defer" in result) {
          await client.query("UPDATE job SET status='queued',attempt=attempt-1,run_after=$2,lease_until=NULL WHERE id=$1", [job.id, result.defer]);
          return "deferred" as const;
        }
        const done = "skip" in result ? "skipped" : "succeeded";
        await client.query("UPDATE job SET status=$2,outcome=$3,finished_at=clock_timestamp(),lease_until=NULL,last_error=NULL WHERE id=$1",
          [job.id, done, "skip" in result ? { reason: result.skip } : result]);
        return done;
      });
      summary[status]++;
    } catch (error) {
      const dead = job.attempt >= MAX_ATTEMPTS;
      const { rowCount } = await db.query(
        `UPDATE job SET status=$3,last_error=$4,lease_until=NULL,run_after=clock_timestamp()+make_interval(secs=>$5),finished_at=CASE WHEN $3='dead' THEN clock_timestamp() END
         WHERE id=$1 AND lease_token=$2 AND status='running'`,
        [job.id, job.lease_token, dead ? "dead" : "queued", category(error), Math.round(2 ** job.attempt * (1 + Math.random()))]);
      summary[rowCount ? (dead ? "dead" : "retried") : "fenced"]++;
    }
  }
  return summary;
}

const roleKinds: Record<Scope["role"], string[]> = {
  student: ["assignment", "reminder", "result", "class", "correction"], faculty: ["attendance", "correction"], admin: ["request", "followup"], principal: ["escalation"], hod: [],
};

/** Inbox read model. Access is re-checked at read time, so a revoked roster, grant or withdrawn record hides the item. */
export async function notifications(current: Scope) {
  return (await db.query<{ id: string; kind: string; entity_id: string; title: string; created_at: Date; read_at: Date | null }>(
    `SELECT n.id,n.kind,n.entity_id,n.title,n.created_at,n.read_at FROM notification n
     WHERE n.institution_id=$1 AND n.recipient_id=$2 AND n.kind = ANY($4)
       AND EXISTS (SELECT 1 FROM membership m WHERE m.institution_id=n.institution_id AND m.account_id=n.recipient_id AND m.role=$3 AND m.ended_at IS NULL)
       AND CASE
         WHEN n.kind IN ('assignment','reminder','result') THEN EXISTS (
           SELECT 1 FROM assignment a JOIN roster r ON r.institution_id=a.institution_id AND r.offering_id=a.offering_id
           WHERE a.institution_id=n.institution_id AND a.id=n.entity_id AND a.published_at IS NOT NULL
             AND r.account_id=n.recipient_id AND r.role='student' AND r.ended_at IS NULL)
         WHEN n.kind='class' THEN EXISTS (
           SELECT 1 FROM class_session s JOIN roster r ON r.institution_id=s.institution_id AND r.offering_id=s.offering_id
           WHERE s.institution_id=n.institution_id AND s.id=n.entity_id AND s.state<>'draft'
             AND r.account_id=n.recipient_id AND r.role='student' AND r.ended_at IS NULL)
         WHEN n.kind='attendance' THEN EXISTS (
           SELECT 1 FROM class_session s JOIN roster r ON r.institution_id=s.institution_id AND r.offering_id=s.offering_id
           WHERE s.institution_id=n.institution_id AND s.id=n.entity_id AND s.faculty_id=n.recipient_id
             AND r.account_id=n.recipient_id AND r.role='faculty' AND r.ended_at IS NULL)
         WHEN n.kind='correction' THEN EXISTS (
           SELECT 1 FROM attendance_correction k JOIN class_session s ON s.institution_id=k.institution_id AND s.id=k.session_id
           JOIN roster r ON r.institution_id=s.institution_id AND r.offering_id=s.offering_id AND r.account_id=n.recipient_id AND r.ended_at IS NULL
           WHERE k.institution_id=n.institution_id AND k.id=n.entity_id
             AND ((r.role='student' AND k.student_id=n.recipient_id) OR (r.role='faculty' AND s.faculty_id=n.recipient_id)))
         ELSE EXISTS (SELECT 1 FROM service_request q WHERE q.institution_id=n.institution_id AND q.id=n.entity_id)
       END
     ORDER BY n.created_at DESC LIMIT 20`,
    [current.institution, current.account, current.role, roleKinds[current.role]],
  )).rows;
}

export async function markNotificationRead(current: Scope, id: string) {
  const visible = (await notifications(current)).some(n => n.id === id);
  const { rowCount } = visible ? await db.query(
    "UPDATE notification SET read_at=coalesce(read_at,clock_timestamp()) WHERE institution_id=$1 AND recipient_id=$2 AND id=$3",
    [current.institution, current.account, id]) : { rowCount: 0 };
  if (!rowCount) throw new WorkflowError("This notification is unavailable.");
}

async function requireAdmin(client: PoolClient, current: Scope) {
  const { rowCount } = await client.query("SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role='admin' AND ended_at IS NULL FOR SHARE", [current.institution, current.account]);
  if (current.role !== "admin" || !rowCount) throw new WorkflowError("This action is unavailable.");
}
const operatorAudit = (client: PoolClient, current: Scope, action: string, ref: string) => client.query(
  "INSERT INTO audit_event (institution_id,actor_id,entity_id,action,ref) VALUES ($1,$2,$1,$3,$4)", [current.institution, current.account, action, ref]);

/** Automation Centre read model: rules, institution job health, global worker liveness and effort evidence. Admin and principal only. */
export async function automationOverview(current: Scope) {
  if (current.role !== "admin" && current.role !== "principal") return null;
  const member = await db.query("SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role=$3 AND ended_at IS NULL", [current.institution, current.account, current.role]);
  if (!member.rowCount) return null;
  const [rules, failures, health, workers, effort] = await Promise.all([
    db.query<{ key: string; title: string; event_type: string; authority: string; workflow: string; state: string;
      succeeded: number; skipped: number; waiting: number; scheduled: number; dead: number; cancelled: number; notified: number; last_run: Date | null }>(
      `SELECT r.key,r.title,r.event_type,r.authority,r.workflow,coalesce(s.state,'active') AS state,
         count(j.id) FILTER (WHERE j.status='succeeded')::int AS succeeded, count(j.id) FILTER (WHERE j.status='skipped')::int AS skipped,
         count(j.id) FILTER (WHERE j.status IN ('queued','running') AND j.run_after<=clock_timestamp())::int AS waiting,
         count(j.id) FILTER (WHERE j.status='queued' AND j.run_after>clock_timestamp())::int AS scheduled,
         count(j.id) FILTER (WHERE j.status='dead')::int AS dead, count(j.id) FILTER (WHERE j.status='cancelled')::int AS cancelled,
         coalesce(sum((j.outcome->>'notified')::int),0)::int AS notified, max(j.finished_at) AS last_run
       FROM automation_rule r LEFT JOIN automation_setting s ON s.institution_id=$1 AND s.rule_key=r.key
       LEFT JOIN job j ON j.rule_key=r.key AND j.institution_id=$1 GROUP BY r.key,s.state ORDER BY r.workflow,r.key`, [current.institution]),
    db.query<{ id: string; rule_key: string; attempt: number; last_error: string | null; created_at: Date }>(
      "SELECT id::text,rule_key,attempt,last_error,created_at FROM job WHERE institution_id=$1 AND status='dead' ORDER BY id DESC LIMIT 10", [current.institution]),
    db.query<{ oldest_wait_seconds: number | null; failed_24h: number; succeeded_24h: number }>(
      `SELECT extract(epoch FROM clock_timestamp()-min(run_after) FILTER (WHERE status='queued' AND run_after<=clock_timestamp()))::int AS oldest_wait_seconds,
         count(*) FILTER (WHERE status='dead' AND finished_at>clock_timestamp()-interval '24 hours')::int AS failed_24h,
         count(*) FILTER (WHERE status='succeeded' AND finished_at>clock_timestamp()-interval '24 hours')::int AS succeeded_24h
       FROM job WHERE institution_id=$1`, [current.institution]),
    db.query<{ live: number; seen_at: Date | null }>(
      "SELECT count(*) FILTER (WHERE seen_at>clock_timestamp()-interval '30 seconds')::int AS live, max(seen_at) AS seen_at FROM worker_heartbeat"),
    effortSummary(current),
  ]);
  return { rules: rules.rows, failures: failures.rows, health: health.rows[0], workersLive: workers.rows[0].live,
    workerSeenAt: workers.rows[0].seen_at, workerLive: workers.rows[0].live > 0, effort };
}

/** Reduction = 100 × (baseline − post) / baseline, per case, kept separate by evidence quality. Never mixes synthetic and measured. */
export async function effortSummary(current: Scope) {
  const { rows } = await db.query<{ workflow: string; quality: string; baseline: string | null; post: string | null; baseline_cases: number; post_cases: number }>(
    `SELECT workflow,quality,
       sum(human_minutes) FILTER (WHERE phase='baseline')/nullif(sum(cases) FILTER (WHERE phase='baseline'),0) AS baseline,
       sum(human_minutes) FILTER (WHERE phase='post')/nullif(sum(cases) FILTER (WHERE phase='post'),0) AS post,
       coalesce(sum(cases) FILTER (WHERE phase='baseline'),0)::int AS baseline_cases, coalesce(sum(cases) FILTER (WHERE phase='post'),0)::int AS post_cases
     FROM automation_effort_sample WHERE institution_id=$1 GROUP BY workflow,quality ORDER BY workflow,quality`, [current.institution]);
  return rows.map(row => {
    const baseline = row.baseline === null ? null : Number(row.baseline), post = row.post === null ? null : Number(row.post);
    return { ...row, baseline, post, reduction: baseline && post !== null ? Math.round(1000 * (baseline - post) / baseline) / 10 : null };
  });
}

export async function setRuleState(current: Scope, rule: string, state: "active" | "paused" | "disabled") {
  await transaction(async client => {
    await requireAdmin(client, current);
    const known = await client.query("SELECT 1 FROM automation_rule WHERE key=$1", [rule]);
    if (!known.rowCount) throw new WorkflowError("This rule is unavailable.");
    await client.query(
      `INSERT INTO automation_setting (institution_id,rule_key,state,changed_by) VALUES ($1,$2,$3,$4)
       ON CONFLICT (institution_id,rule_key) DO UPDATE SET state=EXCLUDED.state,changed_by=EXCLUDED.changed_by,changed_at=clock_timestamp()`,
      [current.institution, rule, state, current.account]);
    // Disabling stops future events and cancels waiting work; running work finishes or is fenced.
    if (state === "disabled") await client.query(
      "UPDATE job SET status='cancelled',finished_at=clock_timestamp() WHERE institution_id=$1 AND rule_key=$2 AND status='queued'", [current.institution, rule]);
    await operatorAudit(client, current, `automation.rule.${state}`, rule);
  });
}

async function changeJob(current: Scope, id: string, action: "retried" | "cancelled") {
  await transaction(async client => {
    await requireAdmin(client, current);
    const { rowCount } = await client.query(action === "retried"
      ? "UPDATE job SET status='queued',attempt=0,run_after=clock_timestamp(),finished_at=NULL,last_error=NULL WHERE institution_id=$1 AND id=$2 AND status='dead'"
      : "UPDATE job SET status='cancelled',finished_at=clock_timestamp() WHERE institution_id=$1 AND id=$2 AND status IN ('queued','dead')",
      [current.institution, id]);
    if (!rowCount) throw new WorkflowError("This job is unavailable.");
    await operatorAudit(client, current, `automation.job.${action}`, `job:${id}`);
  });
}
export const retryJob = (current: Scope, id: string) => changeJob(current, id, "retried");
export const cancelJob = (current: Scope, id: string) => changeJob(current, id, "cancelled");
