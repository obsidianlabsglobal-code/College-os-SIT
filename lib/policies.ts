import { z } from "zod";
import { attendancePercentage, attendanceSummary } from "./academic-day";
import { audit, WorkflowError } from "./assignments";
import { db, transaction } from "./db";
import type { Scope } from "./scope";

// AD-021 / AD-016 slice: versioned institutional policies. An admin drafts; the principal approves or rejects with a
// reason; only approved versions are published, to their audience. SA-007 reads the latest approved attendance policy.
const unavailable = () => new WorkflowError("This action is unavailable.");
export type PolicyKind = "general" | "attendance" | "service" | "integrity";
const audienceFor = (role: Scope["role"]) => role === "student" ? ["everyone", "students"] : ["everyone", "staff"];

export type PublishedPolicy = { id: string; kind: PolicyKind; title: string; audience: string; version: number; body: string;
  attendance_threshold: number | null; approved_at: Date };
/** Latest approved version of each policy the caller's role may read. */
export async function publishedPolicies(scope: Scope) {
  return (await db.query<PublishedPolicy>(`SELECT DISTINCT ON (p.id) p.id,p.kind,p.title,p.audience,v.version,v.body,v.attendance_threshold,v.decided_at AS approved_at
    FROM policy p JOIN policy_version v ON (v.institution_id,v.policy_id)=(p.institution_id,p.id) AND v.state='approved'
    JOIN membership m ON m.institution_id=p.institution_id AND m.account_id=$2 AND m.role=$3 AND m.ended_at IS NULL
    WHERE p.institution_id=$1 AND (p.audience=ANY($4) OR $3 IN ('admin','principal'))
    ORDER BY p.id,v.version DESC`, [scope.institution, scope.account, scope.role, audienceFor(scope.role)])).rows
    .sort((a, b) => a.title.localeCompare(b.title));
}

export type PolicyDraft = { policy_id: string; title: string; kind: PolicyKind; version: number; body: string; attendance_threshold: number | null;
  state: string; drafted_by: string; decision_reason: string | null };
/** Admin and principal: every version awaiting or after a decision, newest first. */
export async function policyVersions(scope: Scope) {
  if (scope.role !== "admin" && scope.role !== "principal") return [];
  return (await db.query<PolicyDraft>(`SELECT v.policy_id,p.title,p.kind,v.version,v.body,v.attendance_threshold,v.state,u.name AS drafted_by,v.decision_reason
    FROM policy_version v JOIN policy p ON (p.institution_id,p.id)=(v.institution_id,v.policy_id) JOIN "user" u ON u.id=v.drafted_by
    JOIN membership m ON m.institution_id=v.institution_id AND m.account_id=$2 AND m.role=$3 AND m.ended_at IS NULL
    WHERE v.institution_id=$1 ORDER BY (v.state='draft') DESC,v.drafted_at DESC LIMIT 100`, [scope.institution, scope.account, scope.role])).rows;
}

const draftInput = z.object({
  policy: z.uuid().optional(), kind: z.enum(["general", "attendance", "service", "integrity"]).optional(), title: z.string().trim().min(1).max(160).optional(),
  audience: z.enum(["everyone", "staff", "students"]).optional(), body: z.string().trim().min(1).max(20000),
  threshold: z.coerce.number().int().min(1).max(100).optional(),
});
/** Draft a new policy, or a new version of an existing one. One open draft per policy. */
export function draftPolicy(scope: Scope, raw: unknown) {
  const input = draftInput.parse(raw);
  if (scope.role !== "admin") throw unavailable();
  return transaction(async client => {
    const { rowCount } = await client.query("SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role='admin' AND ended_at IS NULL FOR SHARE",
      [scope.institution, scope.account]);
    if (!rowCount) throw unavailable();
    let id = input.policy, kind = input.kind;
    if (id) {
      const { rows: [p] } = await client.query<{ kind: PolicyKind }>("SELECT kind FROM policy WHERE institution_id=$1 AND id=$2", [scope.institution, id]);
      if (!p) throw unavailable();
      kind = p.kind;
    } else {
      if (!input.kind || !input.title || !input.audience) throw new WorkflowError("Enter a title, type and audience.");
      id = (await client.query<{ id: string }>("INSERT INTO policy (institution_id,kind,title,audience,created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id",
        [scope.institution, input.kind, input.title, input.audience, scope.account])).rows[0].id;
    }
    if (kind === "attendance" && !input.threshold) throw new WorkflowError("An attendance policy needs its minimum percentage.");
    try {
      const { rows: [v] } = await client.query<{ version: number }>(`INSERT INTO policy_version (institution_id,policy_id,version,body,attendance_threshold,drafted_by)
        SELECT $1,$2,coalesce(max(version),0)+1,$3,$4,$5 FROM policy_version WHERE institution_id=$1 AND policy_id=$2 RETURNING version`,
      [scope.institution, id, input.body, kind === "attendance" ? input.threshold : null, scope.account]);
      await audit(client, scope, id!, "policy.drafted", v.version);
      return { policy: id!, version: v.version };
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw new WorkflowError("This policy already has a draft awaiting a decision.");
      throw error;
    }
  });
}

const decideInput = z.object({ policy: z.uuid(), version: z.coerce.number().int().min(1), decision: z.enum(["approve", "reject"]), reason: z.string().trim().min(1).max(500) });
export function decidePolicy(scope: Scope, raw: unknown) {
  const input = decideInput.parse(raw);
  if (scope.role !== "principal") throw unavailable();
  return transaction(async client => {
    const { rowCount } = await client.query("SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role='principal' AND ended_at IS NULL FOR SHARE",
      [scope.institution, scope.account]);
    if (!rowCount) throw unavailable();
    const { rowCount: changed } = await client.query(`UPDATE policy_version SET state=$4,decided_by=$5,decided_at=clock_timestamp(),decision_reason=$6
      WHERE institution_id=$1 AND policy_id=$2 AND version=$3 AND state='draft'`,
    [scope.institution, input.policy, input.version, input.decision === "approve" ? "approved" : "rejected", scope.account, input.reason]);
    if (!changed) throw new WorkflowError("This version is not awaiting a decision.");
    await audit(client, scope, input.policy, input.decision === "approve" ? "policy.approved" : "policy.rejected", input.version);
  });
}

/** SA-007: each course's record-based attendance against the latest approved attendance policy, citing its version. */
export async function attendanceEligibility(scope: Scope) {
  if (scope.role !== "student") return null;
  const policy = (await publishedPolicies(scope)).find(p => p.kind === "attendance" && p.attendance_threshold !== null);
  if (!policy) return null;
  const rows = (await attendanceSummary(scope)).map(row => {
    const percent = attendancePercentage(row.present, row.recorded);
    return { course: row.course, term: row.term, present: row.present, recorded: row.recorded, percent,
      eligible: percent !== null && Number(percent) >= policy.attendance_threshold! };
  });
  return { policy: { id: policy.id, title: policy.title, version: policy.version, threshold: policy.attendance_threshold!, approved_at: policy.approved_at }, rows };
}
