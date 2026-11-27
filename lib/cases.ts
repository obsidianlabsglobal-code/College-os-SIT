import type { PoolClient } from "pg";
import { z } from "zod";
import { audit, WorkflowError } from "./assignments";
import { db, transaction } from "./db";
import type { Scope } from "./scope";

// AD-020 slice: one case engine with shared ownership, transitions and audit. Each kind declares who may open,
// assign and read; the transitions (assign → start → resolve/decline, notes) are common.
//   support   — DH-014 / FC-015: academic support for a student, coordinated by the department head.
//   grievance — AD-017: a student's confidential complaint, handled by the administrative office.
export type CaseKind = "support" | "grievance";
const unavailable = () => new WorkflowError("This case is unavailable or has already changed.");
const ESCALATE_DAYS = 7;

const member = (role: string, account = "$2") =>
  `EXISTS (SELECT 1 FROM membership x WHERE x.institution_id=k.institution_id AND x.account_id=${account} AND x.role='${role}' AND x.ended_at IS NULL)`;
const hodOf = (account = "$2") =>
  `EXISTS (SELECT 1 FROM membership h WHERE h.institution_id=k.institution_id AND h.account_id=${account} AND h.role='hod' AND h.department_id=k.department_id AND h.ended_at IS NULL)`;
// Who can read a case. Students never see support cases about them; grievance notes stay with staff (see `notes`).
const readable = `CASE k.kind
  WHEN 'support' THEN ($3='hod' AND ${hodOf()}) OR ($3='faculty' AND ${member("faculty")} AND (k.assigned_to=$2 OR k.opened_by=$2))
  WHEN 'grievance' THEN ($3='student' AND k.subject_id=$2 AND ${member("student")}) OR ($3='admin' AND ${member("admin")})
    OR ($3='principal' AND ${member("principal")} AND k.state IN ('open','in_progress') AND k.created_at < clock_timestamp()-interval '${ESCALATE_DAYS} days')
END`;

export type CaseRow = { id: string; kind: CaseKind; title: string; body: string; state: "open" | "in_progress" | "resolved" | "declined";
  subject: string; opener: string; assignee: string | null; assigned_to: string | null; outcome: string | null; department: string | null; department_id: string | null;
  created_at: Date; closed_at: Date | null; escalated: boolean; notes: { author: string; body: string; created_at: string }[] };

export async function cases(scope: Scope, kind: CaseKind) {
  return (await db.query<CaseRow>(`SELECT k.id,k.kind,k.title,k.body,k.state,su.name AS subject,ou.name AS opener,au.name AS assignee,k.assigned_to,
      k.outcome,d.name AS department,k.department_id,k.created_at,k.closed_at,
      (k.kind='grievance' AND k.state IN ('open','in_progress') AND k.created_at < clock_timestamp()-interval '${ESCALATE_DAYS} days') AS escalated,
      CASE WHEN $3 IN ('student','principal') THEN '[]'::json ELSE coalesce((SELECT json_agg(json_build_object('author',nu.name,'body',n.body,'created_at',n.created_at) ORDER BY n.created_at)
        FROM case_note n JOIN "user" nu ON nu.id=n.author_id WHERE (n.institution_id,n.case_id)=(k.institution_id,k.id)),'[]') END AS notes
    FROM case_record k JOIN "user" su ON su.id=k.subject_id JOIN "user" ou ON ou.id=k.opened_by
    LEFT JOIN "user" au ON au.id=k.assigned_to LEFT JOIN department d ON (d.institution_id,d.id)=(k.institution_id,k.department_id)
    WHERE k.institution_id=$1 AND k.kind=$4 AND ${readable}
    ORDER BY (k.state IN ('open','in_progress')) DESC,k.created_at DESC LIMIT 100`, [scope.institution, scope.account, scope.role, kind])).rows;
}

/** FC-015 / AD-017 measurement: open and unowned cases, and median hours to close over the last 90 days. */
export async function caseSummary(scope: Scope, kind: CaseKind) {
  return (await db.query<{ open: number; unassigned: number; closed_90d: number; median_hours: number | null }>(`SELECT
      count(*) FILTER (WHERE k.state IN ('open','in_progress'))::int AS open,
      count(*) FILTER (WHERE k.state='open' AND k.assigned_to IS NULL)::int AS unassigned,
      count(*) FILTER (WHERE k.closed_at > clock_timestamp()-interval '90 days')::int AS closed_90d,
      round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM k.closed_at-k.created_at)/3600)
        FILTER (WHERE k.closed_at > clock_timestamp()-interval '90 days'))::numeric,1)::float8 AS median_hours
    FROM case_record k WHERE k.institution_id=$1 AND k.kind=$4 AND ${readable}`, [scope.institution, scope.account, scope.role, kind])).rows[0];
}

/** People a case can be assigned to: department teachers for support, office staff for grievances. */
export async function caseStaff(scope: Scope, kind: CaseKind) {
  if (kind === "support" && scope.role === "hod") return (await db.query<{ id: string; name: string; department: string }>(`SELECT DISTINCT u.id,u.name,c.department_id AS department
    FROM membership h JOIN course c ON c.institution_id=h.institution_id AND c.department_id=h.department_id
    JOIN offering o ON (o.institution_id,o.course_id)=(c.institution_id,c.id)
    JOIN roster r ON (r.institution_id,r.offering_id)=(o.institution_id,o.id) AND r.role='faculty' AND r.ended_at IS NULL
    JOIN membership m ON m.institution_id=r.institution_id AND m.account_id=r.account_id AND m.role='faculty' AND m.ended_at IS NULL
    JOIN "user" u ON u.id=r.account_id
    WHERE h.institution_id=$1 AND h.account_id=$2 AND h.role='hod' AND h.ended_at IS NULL ORDER BY u.name`, [scope.institution, scope.account])).rows;
  if (kind === "grievance" && scope.role === "admin") return (await db.query<{ id: string; name: string; department: string }>(`SELECT DISTINCT u.id,u.name,'' AS department
    FROM membership m JOIN "user" u ON u.id=m.account_id WHERE m.institution_id=$1 AND m.role='admin' AND m.ended_at IS NULL
      AND EXISTS (SELECT 1 FROM membership me WHERE me.institution_id=$1 AND me.account_id=$2 AND me.role='admin' AND me.ended_at IS NULL)
    ORDER BY u.name`, [scope.institution, scope.account])).rows;
  return [];
}

/** Students a support case can be opened for: the HOD's department rosters, or the teacher's own rosters. */
export async function supportStudents(scope: Scope) {
  if (scope.role !== "hod" && scope.role !== "faculty") return [];
  return (await db.query<{ id: string; name: string; department: string; department_name: string }>(`SELECT DISTINCT u.id,u.name,c.department_id AS department,d.name AS department_name
    FROM roster r JOIN membership m ON m.institution_id=r.institution_id AND m.account_id=r.account_id AND m.role='student' AND m.ended_at IS NULL
    JOIN offering o ON (o.institution_id,o.id)=(r.institution_id,r.offering_id) JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id)
    JOIN department d ON (d.institution_id,d.id)=(c.institution_id,c.department_id) JOIN "user" u ON u.id=r.account_id
    WHERE r.institution_id=$1 AND r.role='student' AND r.ended_at IS NULL AND (
      ($3='hod' AND EXISTS (SELECT 1 FROM membership h WHERE h.institution_id=c.institution_id AND h.department_id=c.department_id AND h.account_id=$2 AND h.role='hod' AND h.ended_at IS NULL))
      OR ($3='faculty' AND EXISTS (SELECT 1 FROM roster f JOIN membership fm ON fm.institution_id=f.institution_id AND fm.account_id=f.account_id AND fm.role='faculty' AND fm.ended_at IS NULL
        WHERE (f.institution_id,f.offering_id)=(o.institution_id,o.id) AND f.account_id=$2 AND f.role='faculty' AND f.ended_at IS NULL)))
    ORDER BY u.name,c.department_id`, [scope.institution, scope.account, scope.role])).rows;
}

const text = (max: number) => z.string().trim().min(1).max(max);
const openInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("support"), student: z.string().min(1).max(100), department: z.uuid(), title: text(160), body: text(4000) }),
  z.object({ kind: z.literal("grievance"), title: text(160), body: text(4000) }),
]);

export function openCase(scope: Scope, raw: unknown) {
  const input = openInput.parse(raw);
  return transaction(async client => {
    let subject = scope.account, department: string | null = null, assignee: string | null = null;
    if (input.kind === "grievance") {
      if (scope.role !== "student" || !(await locked(client, scope, "student"))) throw unavailable();
    } else {
      if (scope.role !== "hod" && scope.role !== "faculty") throw unavailable();
      if (!(await locked(client, scope, scope.role))) throw unavailable();
      const allowed = (await supportStudents(scope)).some(s => s.id === input.student && s.department === input.department);
      if (!allowed) throw new WorkflowError("Choose a current student from your department or your own classes.");
      [subject, department] = [input.student, input.department];
      if (scope.role === "faculty") assignee = scope.account;  // a teacher opening a support case owns it
    }
    const { rows: [row] } = await client.query<{ id: string }>(`INSERT INTO case_record
      (institution_id,kind,subject_id,department_id,opened_by,title,body,assigned_to,assigned_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::text,CASE WHEN $8::text IS NULL THEN NULL ELSE clock_timestamp() END) RETURNING id`,
    [scope.institution, input.kind, subject, department, scope.account, input.title, input.body, assignee]);
    await audit(client, scope, row.id, "case.opened", 1);
    return row.id;
  });
}

async function locked(client: PoolClient, scope: Scope, role: string) {
  return (await client.query("SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role=$3 AND ended_at IS NULL FOR SHARE",
    [scope.institution, scope.account, role])).rowCount;
}

type Locked = { kind: CaseKind; state: string; department_id: string | null; assigned_to: string | null; revision: number };
async function lockCase(client: PoolClient, scope: Scope, id: string) {
  const { rows: [row] } = await client.query<Locked>(`SELECT k.kind,k.state,k.department_id,k.assigned_to,k.revision FROM case_record k
    WHERE k.institution_id=$1 AND k.id=$4 AND ${readable} FOR UPDATE`, [scope.institution, scope.account, scope.role, id]);
  if (!row) throw unavailable();
  return row;
}

const assignInput = z.object({ case: z.uuid(), assignee: z.string().min(1).max(100) });
export function assignCase(scope: Scope, raw: unknown) {
  const input = assignInput.parse(raw);
  return transaction(async client => {
    const row = await lockCase(client, scope, input.case);
    const coordinator = row.kind === "support" ? scope.role === "hod" : scope.role === "admin";
    if (!coordinator || !["open", "in_progress"].includes(row.state) || row.assigned_to === input.assignee) throw unavailable();
    const staff = (await caseStaff(scope, row.kind)).filter(p => row.kind === "grievance" || p.department === row.department_id);
    if (!staff.some(p => p.id === input.assignee)) throw new WorkflowError("Choose a current staff member who can take this case.");
    await client.query(`UPDATE case_record SET assigned_to=$3,assigned_at=clock_timestamp(),state='open',revision=revision+1
      WHERE institution_id=$1 AND id=$2`, [scope.institution, input.case, input.assignee]);
    await audit(client, scope, input.case, "case.assigned", row.revision + 1, input.assignee);
  });
}

export function startCase(scope: Scope, id: unknown) {
  const caseId = z.uuid().parse(id);
  return transaction(async client => {
    const row = await lockCase(client, scope, caseId);
    if (row.assigned_to !== scope.account || row.state !== "open") throw unavailable();
    await client.query("UPDATE case_record SET state='in_progress',revision=revision+1 WHERE institution_id=$1 AND id=$2", [scope.institution, caseId]);
    await audit(client, scope, caseId, "case.started", row.revision + 1);
  });
}

export function addCaseNote(scope: Scope, raw: unknown) {
  const input = z.object({ case: z.uuid(), body: text(2000) }).parse(raw);
  if (scope.role === "student") throw unavailable();
  return transaction(async client => {
    const row = await lockCase(client, scope, input.case);
    if (!["open", "in_progress"].includes(row.state)) throw unavailable();
    await client.query("INSERT INTO case_note (institution_id,case_id,author_id,body) VALUES ($1,$2,$3,$4)", [scope.institution, input.case, scope.account, input.body]);
    await audit(client, scope, input.case, "case.noted", row.revision);
  });
}

const closeInput = z.object({ case: z.uuid(), outcome: z.enum(["resolved", "declined"]), reason: text(1000) });
export function closeCase(scope: Scope, raw: unknown) {
  const input = closeInput.parse(raw);
  return transaction(async client => {
    const row = await lockCase(client, scope, input.case);
    if (row.assigned_to !== scope.account || !["open", "in_progress"].includes(row.state)) throw unavailable();
    await client.query(`UPDATE case_record SET state=$3,outcome=$4,closed_at=clock_timestamp(),revision=revision+1 WHERE institution_id=$1 AND id=$2`,
      [scope.institution, input.case, input.outcome, input.reason]);
    await audit(client, scope, input.case, "case.closed", row.revision + 1);
  });
}
