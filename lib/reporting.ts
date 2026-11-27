import { z } from "zod";
import { db } from "./db";
import type { Scope } from "./scope";

export async function departmentSummary(scope: Scope) {
  if (scope.role !== "hod") return [];
  return (await db.query<{ name: string; assignments: number; submissions: number; results: number; hours: number | null }>(
    `SELECT d.name, count(DISTINCT a.id)::int AS assignments, count(s.id)::int AS submissions,
       count(p.at)::int AS results, avg(extract(epoch FROM (p.at-s.submitted_at))/3600)::float8 AS hours
     FROM membership m JOIN department d ON (d.institution_id,d.id)=(m.institution_id,m.department_id)
     LEFT JOIN course c ON c.institution_id=d.institution_id AND c.department_id=d.id
     LEFT JOIN offering o ON o.institution_id=c.institution_id AND o.course_id=c.id
     LEFT JOIN assignment a ON a.institution_id=o.institution_id AND a.offering_id=o.id AND a.published_at IS NOT NULL
     LEFT JOIN submission s ON s.institution_id=a.institution_id AND s.assignment_id=a.id
     LEFT JOIN LATERAL (SELECT min(published_at) AS at FROM grade g
       WHERE (g.institution_id,g.submission_id)=(s.institution_id,s.id)) p ON true
     WHERE m.institution_id=$1 AND m.account_id=$2 AND m.role='hod' AND m.ended_at IS NULL
     GROUP BY d.id,d.name ORDER BY d.name`, [scope.institution, scope.account],
  )).rows;
}

export async function institutionSummary(scope: Scope) {
  if (scope.role !== "principal") return [];
  return (await db.query<{ name: string; assignments: number; submissions: number; results: number; open_requests: number }>(
    `SELECT i.name,
      (SELECT count(*)::int FROM assignment a WHERE a.institution_id=i.id AND a.published_at IS NOT NULL) AS assignments,
      (SELECT count(*)::int FROM submission s WHERE s.institution_id=i.id) AS submissions,
      (SELECT count(DISTINCT submission_id)::int FROM grade g WHERE g.institution_id=i.id AND g.published_at IS NOT NULL) AS results,
      (SELECT count(*)::int FROM service_request s WHERE s.institution_id=i.id AND s.status IN ('submitted','in_progress')) AS open_requests
     FROM institution i JOIN membership m ON m.institution_id=i.id
     WHERE i.id=$1 AND m.account_id=$2 AND m.role='principal' AND m.ended_at IS NULL`, [scope.institution, scope.account],
  )).rows;
}

export async function adminRequestSummary(scope: Scope) {
  if (scope.role !== "admin") return null;
  const result = await db.query<{ submitted:number; in_review:number }>(
    `SELECT count(r.id) FILTER (WHERE r.status='submitted')::int AS submitted,
            count(r.id) FILTER (WHERE r.status='in_progress')::int AS in_review
       FROM membership m LEFT JOIN service_request r ON r.institution_id=m.institution_id
      WHERE m.institution_id=$1 AND m.account_id=$2 AND m.role='admin' AND m.ended_at IS NULL
      GROUP BY m.id`, [scope.institution,scope.account]);
  return result.rows[0] ?? null;
}

/** AD-024: queue age, resolution time and rework from records, over a fixed 30-day window. */
export async function operationsReport(scope: Scope) {
  if (scope.role !== "admin" && scope.role !== "principal") return null;
  return (await db.query<{ open: number; unassigned: number; oldest_open_hours: number | null; resolved_30d: number; declined_30d: number;
    median_resolution_hours: number | null; attendance_corrections_30d: number; grade_corrections_30d: number }>(
    `SELECT count(*) FILTER (WHERE r.status IN ('submitted','in_progress'))::int AS open,
       count(*) FILTER (WHERE r.status IN ('submitted','in_progress') AND r.assigned_to IS NULL)::int AS unassigned,
       round((extract(epoch FROM clock_timestamp()-min(r.created_at) FILTER (WHERE r.status IN ('submitted','in_progress')))/3600)::numeric,1)::float8 AS oldest_open_hours,
       count(*) FILTER (WHERE r.status='resolved' AND r.closed_at > clock_timestamp()-interval '30 days')::int AS resolved_30d,
       count(*) FILTER (WHERE r.status='declined' AND r.closed_at > clock_timestamp()-interval '30 days')::int AS declined_30d,
       round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM r.closed_at-r.created_at)/3600)
         FILTER (WHERE r.closed_at > clock_timestamp()-interval '30 days'))::numeric,1)::float8 AS median_resolution_hours,
       (SELECT count(*)::int FROM class_attendance_revision v WHERE v.institution_id=$1 AND v.revision>1 AND v.recorded_at > clock_timestamp()-interval '30 days') AS attendance_corrections_30d,
       (SELECT count(*)::int FROM grade g WHERE g.institution_id=$1 AND g.revision>1 AND g.published_at > clock_timestamp()-interval '30 days') AS grade_corrections_30d
     FROM membership m LEFT JOIN service_request r ON r.institution_id=m.institution_id
     WHERE m.institution_id=$1 AND m.account_id=$2 AND m.role=$3 AND m.ended_at IS NULL GROUP BY m.id`,
    [scope.institution, scope.account, scope.role])).rows[0] ?? null;
}

const auditFilter = z.object({
  action: z.string().trim().max(80).regex(/^[a-z_.]*$/).default(""),
  actor: z.string().trim().max(120).default(""),
  from: z.iso.date().optional(), to: z.iso.date().optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
});
export type AuditFilter = z.infer<typeof auditFilter>;
export const parseAuditFilter = (raw: Record<string, unknown>) =>
  auditFilter.safeParse(Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== "" && value !== undefined)));

/** AD-022: admin-only search over audit metadata (who, what, which record, when). Payloads are never stored or shown. */
export async function auditEvents(scope: Scope, filter: AuditFilter) {
  if (scope.role !== "admin") return null;
  const { action, actor, from, to, page } = auditFilter.parse(filter);
  const rows = (await db.query<{ id: string; action: string; actor: string; actor_role: string | null; entity_id: string; revision: number | null; ref: string | null; occurred_at: Date }>(
    `SELECT e.id::text,e.action,u.name AS actor,
       (SELECT string_agg(DISTINCT am.role,', ' ORDER BY am.role) FROM membership am WHERE am.institution_id=e.institution_id AND am.account_id=e.actor_id) AS actor_role,
       e.entity_id,e.revision,e.ref,e.occurred_at
     FROM audit_event e JOIN "user" u ON u.id=e.actor_id
     WHERE e.institution_id=$1
       AND EXISTS (SELECT 1 FROM membership m WHERE m.institution_id=$1 AND m.account_id=$2 AND m.role='admin' AND m.ended_at IS NULL)
       AND ($3='' OR e.action LIKE $3 || '%') AND ($4='' OR strpos(lower(u.name),lower($4))>0)
       AND ($5::date IS NULL OR e.occurred_at >= $5::date) AND ($6::date IS NULL OR e.occurred_at < $6::date + 1)
     ORDER BY e.occurred_at DESC,e.id DESC LIMIT 51 OFFSET $7`,
    [scope.institution, scope.account, action, actor, from ?? null, to ?? null, (page - 1) * 50])).rows;
  return { rows: rows.slice(0, 50), more: rows.length > 50, page };
}

export type Digest = { period_start: string; generated_at: Date; metrics: { submitted: number; resolved: number; declined: number; open_at_end: number;
  median_resolution_hours: number | null; attendance_corrections: number; result_corrections: number } };
/** AD-024: the latest scheduled weekly digest, for current admins and the principal. */
export async function latestDigest(scope: Scope) {
  if (scope.role !== "admin" && scope.role !== "principal") return null;
  return (await db.query<Digest>(`SELECT to_char(o.period_start,'YYYY-MM-DD') AS period_start,o.generated_at,o.metrics FROM operations_digest o
    JOIN membership m ON m.institution_id=o.institution_id AND m.account_id=$2 AND m.role=$3 AND m.ended_at IS NULL
    WHERE o.institution_id=$1 ORDER BY o.period_start DESC LIMIT 1`, [scope.institution, scope.account, scope.role])).rows[0] ?? null;
}

export type Indicator = { name: string; value: string; definition: string; limitation: string };
/** LE-004: a fixed set of record-derived quality measures, each shown with its definition and its limits. */
export async function qualityIndicators(scope: Scope): Promise<Indicator[]> {
  if (scope.role !== "principal" && scope.role !== "admin") return [];
  const { rows: [q] } = await db.query<{ ok: boolean; turnaround: number | null; submissions: number; published: number; present: number; marked: number;
    recorded: number; corrected: number; results: number; regraded: number; request_hours: number | null; case_hours: number | null }>(`SELECT
      EXISTS (SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role=$3 AND ended_at IS NULL) AS ok,
      (SELECT round(avg(extract(epoch FROM p.first - s.submitted_at)/3600)::numeric,1)::float8 FROM submission s
        JOIN LATERAL (SELECT min(g.published_at) AS first FROM grade g WHERE (g.institution_id,g.submission_id)=(s.institution_id,s.id) AND g.published_at IS NOT NULL) p ON p.first IS NOT NULL
        WHERE s.institution_id=$1) AS turnaround,
      (SELECT count(*)::int FROM submission WHERE institution_id=$1) AS submissions,
      (SELECT count(DISTINCT submission_id)::int FROM grade WHERE institution_id=$1 AND published_at IS NOT NULL) AS published,
      (SELECT count(*) FILTER (WHERE m.status='present')::int FROM class_attendance_mark m WHERE m.institution_id=$1
        AND m.revision=(SELECT max(revision) FROM class_attendance_revision v WHERE (v.institution_id,v.session_id)=(m.institution_id,m.session_id))) AS present,
      (SELECT count(*)::int FROM class_attendance_mark m WHERE m.institution_id=$1
        AND m.revision=(SELECT max(revision) FROM class_attendance_revision v WHERE (v.institution_id,v.session_id)=(m.institution_id,m.session_id))) AS marked,
      (SELECT count(DISTINCT session_id)::int FROM class_attendance_revision WHERE institution_id=$1) AS recorded,
      (SELECT count(DISTINCT session_id)::int FROM class_attendance_revision WHERE institution_id=$1 AND revision>1) AS corrected,
      (SELECT count(DISTINCT submission_id)::int FROM grade WHERE institution_id=$1 AND published_at IS NOT NULL) AS results,
      (SELECT count(DISTINCT submission_id)::int FROM grade WHERE institution_id=$1 AND published_at IS NOT NULL AND revision>1) AS regraded,
      (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM closed_at-created_at)/3600))::numeric,1)::float8
        FROM service_request WHERE institution_id=$1 AND closed_at > clock_timestamp()-interval '90 days') AS request_hours,
      (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM closed_at-created_at)/3600))::numeric,1)::float8
        FROM case_record WHERE institution_id=$1 AND closed_at > clock_timestamp()-interval '90 days') AS case_hours`,
  [scope.institution, scope.account, scope.role]);
  if (!q.ok) return [];
  const pct = (a: number, b: number) => b ? `${(100 * a / b).toFixed(1)}%` : "No records";
  const hours = (h: number | null) => h === null ? "No records" : `${h} h`;
  return [
    { name: "Result turnaround", value: hours(q.turnaround), definition: "Mean hours from submission to the first published result, all time.",
      limitation: "Ignores submissions still awaiting a result, so a backlog can make it look faster." },
    { name: "Results published", value: pct(q.published, q.submissions), definition: "Submissions with at least one published result ÷ all submissions.",
      limitation: "Recent submissions within their normal evaluation window lower the rate." },
    { name: "Attendance", value: pct(q.present, q.marked), definition: "Present marks ÷ all marks in each class's latest attendance revision.",
      limitation: "Classes without a record are excluded; this is not an eligibility calculation." },
    { name: "Attendance correction rate", value: pct(q.corrected, q.recorded), definition: "Recorded classes with more than one revision ÷ recorded classes.",
      limitation: "Counts corrections, not their cause; an accepted student request and a teacher's own fix count the same." },
    { name: "Result correction rate", value: pct(q.regraded, q.results), definition: "Published results revised after first publication ÷ published results.",
      limitation: "Unpublished draft changes are not counted." },
    { name: "Request resolution (median)", value: hours(q.request_hours), definition: "Median hours from submission to recorded outcome, last 90 days.",
      limitation: "Enrollment-letter requests only." },
    { name: "Case closure (median)", value: hours(q.case_hours), definition: "Median hours from opening to outcome for support cases and grievances, last 90 days.",
      limitation: "Mixes two case kinds with different urgency." },
  ];
}
