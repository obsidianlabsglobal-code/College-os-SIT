import { z } from "zod";
import { audit, WorkflowError } from "./assignments";
import { db, transaction } from "./db";
import type { Scope } from "./scope";

const unavailable = () => new WorkflowError("This action is unavailable.");
// Inner aliases are distinct from callers' (`o`), so the offering reference cannot bind to the subquery itself.
const hodOf = (offering: string) => `EXISTS (SELECT 1 FROM offering ho JOIN course hc ON (hc.institution_id,hc.id)=(ho.institution_id,ho.course_id)
  JOIN membership hm ON hm.institution_id=hc.institution_id AND hm.department_id=hc.department_id AND hm.account_id=$2 AND hm.role='hod' AND hm.ended_at IS NULL
  WHERE ho.institution_id=$1 AND ho.id=${offering})`;

// ---- DH-007: teaching allocation proposals ----

export type Proposal = { id: string; offering: string; offering_id: string; faculty: string; proposed_by: string; reason: string;
  state: "proposed" | "approved" | "rejected"; decision_reason: string | null; created_at: Date };

export async function allocationProposals(scope: Scope) {
  if (scope.role !== "hod" && scope.role !== "admin") return [];
  return (await db.query<Proposal>(`SELECT p.id,c.name||' · '||s.name||' · '||t.name AS offering,p.offering_id,fu.name AS faculty,pu.name AS proposed_by,
      p.reason,p.state,p.decision_reason,p.created_at
    FROM allocation_proposal p JOIN offering o ON (o.institution_id,o.id)=(p.institution_id,p.offering_id)
    JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id) JOIN section s ON (s.institution_id,s.id)=(o.institution_id,o.section_id)
    JOIN academic_term t ON (t.institution_id,t.id)=(o.institution_id,o.term_id) JOIN "user" fu ON fu.id=p.faculty_id JOIN "user" pu ON pu.id=p.proposed_by
    WHERE p.institution_id=$1 AND CASE $3 WHEN 'admin' THEN EXISTS (SELECT 1 FROM membership m WHERE m.institution_id=$1 AND m.account_id=$2 AND m.role='admin' AND m.ended_at IS NULL)
      ELSE ${hodOf("p.offering_id")} END
    ORDER BY (p.state='proposed') DESC,p.created_at DESC LIMIT 100`, [scope.institution, scope.account, scope.role])).rows;
}

/** Offerings in the HOD's departments and the current faculty who could teach them. */
export async function allocationOptions(scope: Scope) {
  if (scope.role !== "hod") return null;
  const [offerings, faculty] = await Promise.all([
    db.query<{ id: string; label: string }>(`SELECT o.id,c.name||' · '||s.name||' · '||t.name AS label FROM offering o
      JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id) JOIN section s ON (s.institution_id,s.id)=(o.institution_id,o.section_id)
      JOIN academic_term t ON (t.institution_id,t.id)=(o.institution_id,o.term_id)
      WHERE o.institution_id=$1 AND ${hodOf("o.id")} ORDER BY label`, [scope.institution, scope.account]),
    db.query<{ id: string; name: string }>(`SELECT DISTINCT u.id,u.name FROM membership m JOIN "user" u ON u.id=m.account_id
      WHERE m.institution_id=$1 AND m.role='faculty' AND m.ended_at IS NULL ORDER BY u.name`, [scope.institution])]);
  return { offerings: offerings.rows, faculty: faculty.rows };
}

const proposeInput = z.object({ offering: z.uuid(), faculty: z.string().min(1).max(100), reason: z.string().trim().min(1).max(500) });
export function proposeAllocation(scope: Scope, raw: unknown) {
  const input = proposeInput.parse(raw);
  if (scope.role !== "hod") throw unavailable();
  return transaction(async client => {
    const { rows: [ok] } = await client.query<{ hod: boolean; faculty: boolean; teaching: boolean }>(`SELECT ${hodOf("$3")} AS hod,
      EXISTS (SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$4 AND role='faculty' AND ended_at IS NULL) AS faculty,
      EXISTS (SELECT 1 FROM roster WHERE institution_id=$1 AND offering_id=$3 AND account_id=$4 AND role='faculty' AND ended_at IS NULL) AS teaching`,
    [scope.institution, scope.account, input.offering, input.faculty]);
    if (!ok.hod) throw unavailable();
    if (!ok.faculty) throw new WorkflowError("Choose a current faculty member.");
    if (ok.teaching) throw new WorkflowError("This faculty member already teaches the offering.");
    try {
      const { rows: [row] } = await client.query<{ id: string }>(`INSERT INTO allocation_proposal (institution_id,offering_id,faculty_id,proposed_by,reason)
        VALUES ($1,$2,$3,$4,$5) RETURNING id`, [scope.institution, input.offering, input.faculty, scope.account, input.reason]);
      await audit(client, scope, row.id, "allocation.proposed", 1, input.faculty);
      return row.id;
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw new WorkflowError("This allocation is already awaiting a decision.");
      throw error;
    }
  });
}

const decideInput = z.object({ proposal: z.uuid(), decision: z.enum(["approve", "reject"]), reason: z.string().trim().min(1).max(500) });
/** The office decides. Approval adds (or reactivates) the faculty roster row in the same transaction. */
export function decideAllocation(scope: Scope, raw: unknown) {
  const input = decideInput.parse(raw);
  if (scope.role !== "admin") throw unavailable();
  return transaction(async client => {
    const { rowCount } = await client.query("SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role='admin' AND ended_at IS NULL FOR SHARE",
      [scope.institution, scope.account]);
    if (!rowCount) throw unavailable();
    const { rows: [p] } = await client.query<{ offering_id: string; faculty_id: string; state: string }>(
      "SELECT offering_id,faculty_id,state FROM allocation_proposal WHERE institution_id=$1 AND id=$2 FOR UPDATE", [scope.institution, input.proposal]);
    if (!p || p.state !== "proposed") throw new WorkflowError("This proposal has already been decided.");
    if (input.decision === "approve") {
      const added = await client.query(`INSERT INTO roster (institution_id,offering_id,account_id,role)
        SELECT institution_id,$2,account_id,'faculty' FROM membership WHERE institution_id=$1 AND account_id=$3 AND role='faculty' AND ended_at IS NULL
        ON CONFLICT (institution_id,offering_id,account_id,role) DO UPDATE SET ended_at=NULL WHERE roster.ended_at IS NOT NULL RETURNING 1`,
      [scope.institution, p.offering_id, p.faculty_id]);
      if (!added.rowCount) throw new WorkflowError("The faculty member no longer holds a post or already teaches this offering.");
      await audit(client, scope, p.offering_id, "academic.add-roster", undefined, p.faculty_id);
    }
    await client.query(`UPDATE allocation_proposal SET state=$3,decided_by=$4,decided_at=clock_timestamp(),decision_reason=$5 WHERE institution_id=$1 AND id=$2`,
      [scope.institution, input.proposal, input.decision === "approve" ? "approved" : "rejected", scope.account, input.reason]);
    await audit(client, scope, input.proposal, "allocation.decided");
  });
}

// ---- DH-004: schemes, terms and section mappings in the HOD's departments ----

export async function departmentSchemes(scope: Scope) {
  if (scope.role !== "hod") return [];
  return (await db.query<{ scheme: string; term: string; course: string; sections: string[] }>(`SELECT sc.name AS scheme,t.name AS term,c.name AS course,
      array_agg(DISTINCT s.name ORDER BY s.name) AS sections
    FROM offering o JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id)
    JOIN academic_term t ON (t.institution_id,t.id)=(o.institution_id,o.term_id) JOIN academic_scheme sc ON (sc.institution_id,sc.id)=(t.institution_id,t.scheme_id)
    JOIN section s ON (s.institution_id,s.id)=(o.institution_id,o.section_id)
    WHERE o.institution_id=$1 AND ${hodOf("o.id")}
    GROUP BY sc.name,t.name,c.name ORDER BY sc.name,t.name,c.name`, [scope.institution, scope.account])).rows;
}

// ---- ID-009: offboarding within one institution ----

export type OffboardEffects = { memberships: number; rosters: number; mentoring: number; open_cases: number; open_requests: number };

/** Ends every non-admin post, roster and mentoring pairing the person holds here, in one audited transaction, and
 * reports work that now needs a new owner. Admin posts and the caller's own account are refused. */
export function offboard(scope: Scope, raw: unknown) {
  const account = z.string().min(1).max(100).parse(raw);
  if (scope.role !== "admin" || account === scope.account) throw unavailable();
  return transaction(async client => {
    const { rowCount } = await client.query("SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role='admin' AND ended_at IS NULL FOR SHARE",
      [scope.institution, scope.account]);
    if (!rowCount) throw unavailable();
    const admin = await client.query("SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role='admin' AND ended_at IS NULL", [scope.institution, account]);
    if (admin.rowCount) throw new WorkflowError("End this person's administrator post through the platform operator first.");
    const ended = async (sql: string) => (await client.query(sql, [scope.institution, account])).rowCount ?? 0;
    const effects: OffboardEffects = {
      memberships: await ended("UPDATE membership SET ended_at=clock_timestamp() WHERE institution_id=$1 AND account_id=$2 AND ended_at IS NULL"),
      rosters: await ended("UPDATE roster SET ended_at=clock_timestamp() WHERE institution_id=$1 AND account_id=$2 AND ended_at IS NULL"),
      mentoring: await ended("UPDATE mentor_assignment SET ended_at=clock_timestamp() WHERE institution_id=$1 AND (mentor_id=$2 OR student_id=$2) AND ended_at IS NULL"),
      open_cases: Number((await client.query("SELECT count(*) FROM case_record WHERE institution_id=$1 AND assigned_to=$2 AND state IN ('open','in_progress')",
        [scope.institution, account])).rows[0].count),
      open_requests: Number((await client.query("SELECT count(*) FROM service_request WHERE institution_id=$1 AND assigned_to=$2 AND status IN ('submitted','in_progress')",
        [scope.institution, account])).rows[0].count),
    };
    if (!effects.memberships) throw new WorkflowError("This person holds no current post here.");
    await audit(client, scope, scope.institution, "account.offboarded", undefined, account);
    return effects;
  });
}
