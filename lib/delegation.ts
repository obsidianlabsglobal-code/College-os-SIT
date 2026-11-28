import type { PoolClient } from "pg";
import { z } from "zod";
import { audit, WorkflowError } from "./assignments";
import { db, transaction } from "./db";
import type { Scope } from "./scope";

// AD-019 / ID-008 slice: bounded duties the office lends to a faculty member or HOD until an expiry. Holding a duty lets
// that person do exactly the duty's admin-only operations while acting in their own role; nothing else widens.
export type Duty = "exam_cell" | "calendar";
export const dutyLabel: Record<Duty, string> = { exam_cell: "Examination cell", calendar: "Institution calendar" };

/** SQL predicate ($1 institution, $2 account, $3 role): an active admin, or a staff member with a live delegation. */
export const holdsDuty = (duty: Duty) => `(($3='admin' AND EXISTS (SELECT 1 FROM membership da WHERE da.institution_id=$1 AND da.account_id=$2 AND da.role='admin' AND da.ended_at IS NULL))
  OR ($3 IN ('faculty','hod') AND EXISTS (SELECT 1 FROM delegation dd JOIN membership dm ON dm.institution_id=dd.institution_id AND dm.account_id=dd.delegate_id
      AND dm.role=$3 AND dm.ended_at IS NULL
    WHERE dd.institution_id=$1 AND dd.delegate_id=$2 AND dd.duty='${duty}' AND dd.revoked_at IS NULL
      AND clock_timestamp() >= dd.starts_at AND clock_timestamp() < dd.expires_at)))`;

export async function hasDuty(scope: Scope, duty: Duty, client: Pick<PoolClient, "query"> = db) {
  return (await client.query<{ ok: boolean }>(`SELECT ${holdsDuty(duty)} AS ok`, [scope.institution, scope.account, scope.role])).rows[0].ok;
}

export type Delegation = { id: string; duty: Duty; delegate: string; reason: string; granted_by: string; starts_at: Date; expires_at: Date;
  revoked_at: Date | null; active: boolean };
export async function delegations(scope: Scope) {
  if (scope.role !== "admin") return [];
  return (await db.query<Delegation>(`SELECT d.id,d.duty,u.name AS delegate,d.reason,g.name AS granted_by,d.starts_at,d.expires_at,d.revoked_at,
      (d.revoked_at IS NULL AND clock_timestamp() < d.expires_at) AS active
    FROM delegation d JOIN "user" u ON u.id=d.delegate_id JOIN "user" g ON g.id=d.granted_by
    WHERE d.institution_id=$1 AND EXISTS (SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role='admin' AND ended_at IS NULL)
    ORDER BY (d.revoked_at IS NULL AND clock_timestamp() < d.expires_at) DESC,d.expires_at DESC LIMIT 100`, [scope.institution, scope.account])).rows;
}

export async function delegateOptions(scope: Scope) {
  if (scope.role !== "admin") return [];
  return (await db.query<{ id: string; name: string }>(`SELECT DISTINCT u.id,u.name FROM membership m JOIN "user" u ON u.id=m.account_id
    WHERE m.institution_id=$1 AND m.role IN ('faculty','hod') AND m.ended_at IS NULL ORDER BY u.name`, [scope.institution])).rows;
}

const grantInput = z.object({ duty: z.enum(["exam_cell", "calendar"]), delegate: z.string().min(1).max(100),
  days: z.coerce.number().int().min(1).max(365), reason: z.string().trim().min(1).max(500) });
export function grantDelegation(scope: Scope, raw: unknown) {
  const input = grantInput.parse(raw);
  if (scope.role !== "admin" || input.delegate === scope.account) throw new WorkflowError("This action is unavailable.");
  return transaction(async client => {
    const { rows: [ok] } = await client.query<{ admin: boolean; staff: boolean }>(`SELECT
      EXISTS (SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role='admin' AND ended_at IS NULL) AS admin,
      EXISTS (SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$3 AND role IN ('faculty','hod') AND ended_at IS NULL) AS staff`,
    [scope.institution, scope.account, input.delegate]);
    if (!ok.admin) throw new WorkflowError("This action is unavailable.");
    if (!ok.staff) throw new WorkflowError("Choose a current faculty member or department head.");
    const { rows: [row] } = await client.query<{ id: string }>(`INSERT INTO delegation (institution_id,duty,delegate_id,reason,granted_by,expires_at)
      VALUES ($1,$2,$3,$4,$5,clock_timestamp()+make_interval(days=>$6)) RETURNING id`,
    [scope.institution, input.duty, input.delegate, input.reason, scope.account, input.days]);
    await audit(client, scope, row.id, "delegation.granted", undefined, input.delegate);
    return row.id;
  });
}

export function revokeDelegation(scope: Scope, id: unknown) {
  const delegation = z.uuid().parse(id);
  if (scope.role !== "admin") throw new WorkflowError("This action is unavailable.");
  return transaction(async client => {
    const { rowCount } = await client.query(`UPDATE delegation SET revoked_at=clock_timestamp(),revoked_by=$3
      WHERE institution_id=$1 AND id=$2 AND revoked_at IS NULL AND clock_timestamp() < expires_at
        AND EXISTS (SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$3 AND role='admin' AND ended_at IS NULL)`,
    [scope.institution, delegation, scope.account]);
    if (!rowCount) throw new WorkflowError("This delegation is not active.");
    await audit(client, scope, delegation, "delegation.revoked");
  });
}
