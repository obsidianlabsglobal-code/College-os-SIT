import { z } from "zod";
import { audit, WorkflowError } from "./assignments";
import { db, transaction } from "./db";
import type { Scope } from "./scope";

// Pilot switch: everything is built for every department, and the office decides which departments are on. Sign-up,
// imports and live transport check these helpers, so widening the pilot is a setting, not code.

/** SQL: the department (an expression) is switched on. `$1` must be the institution id. */
export const departmentActiveSql = (department: string) =>
  `EXISTS (SELECT 1 FROM department ad WHERE ad.institution_id=$1 AND ad.id=${department} AND ad.active)`;

/** SQL: the account (an expression) belongs to a switched-on department — as HOD of one, or through a current roster in a
 * course of one. `$1` must be the institution id. */
export const accountInActiveDepartmentSql = (account: string) => `(EXISTS (SELECT 1 FROM membership am JOIN department ad
    ON ad.institution_id=am.institution_id AND ad.id=am.department_id AND ad.active
    WHERE am.institution_id=$1 AND am.account_id=${account} AND am.ended_at IS NULL)
  OR EXISTS (SELECT 1 FROM roster ar JOIN offering ao ON (ao.institution_id,ao.id)=(ar.institution_id,ar.offering_id)
    JOIN course ac ON (ac.institution_id,ac.id)=(ao.institution_id,ao.course_id)
    JOIN department ad ON (ad.institution_id,ad.id)=(ac.institution_id,ac.department_id) AND ad.active
    WHERE ar.institution_id=$1 AND ar.account_id=${account} AND ar.ended_at IS NULL))`;

export async function departmentSwitches(scope: Scope) {
  return (await db.query<{ id: string; name: string; active: boolean }>(`SELECT d.id,d.name,d.active FROM department d WHERE d.institution_id=$1
    AND EXISTS (SELECT 1 FROM membership m WHERE m.institution_id=$1 AND m.account_id=$2 AND m.role IN ('admin','principal','transport') AND m.role=$3 AND m.ended_at IS NULL)
    ORDER BY d.name`, [scope.institution, scope.account, scope.role])).rows;
}

export async function isAccountInActiveDepartment(scope: Scope, account = scope.account) {
  return (await db.query<{ ok: boolean }>(`SELECT ${accountInActiveDepartmentSql("$2")} AS ok`, [scope.institution, account])).rows[0].ok;
}

/** The office switches a department on or off for the pilot, with a reason; audited. */
export function setDepartmentActive(scope: Scope, raw: unknown) {
  const input = z.object({ department: z.uuid(), active: z.boolean(), reason: z.string().trim().min(1).max(300) }).parse(raw);
  return transaction(async client => {
    const { rowCount: admin } = await client.query("SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role='admin' AND ended_at IS NULL FOR SHARE",
      [scope.institution, scope.account]);
    if (scope.role !== "admin" || !admin) throw new WorkflowError("This action is unavailable.");
    const { rowCount } = await client.query("UPDATE department SET active=$3 WHERE institution_id=$1 AND id=$2 AND active<>$3",
      [scope.institution, input.department, input.active]);
    if (!rowCount) throw new WorkflowError("This department is unavailable or already in that state.");
    await audit(client, scope, input.department, input.active ? "department.switched_on" : "department.switched_off");
  });
}
