import { z } from "zod";
import { audit, WorkflowError } from "./assignments";
import { db, transaction } from "./db";
import type { Scope } from "./scope";

// DH-020: departmental associations. Only the office links or unlinks a club; the department's current HOD sees an overview.
const unavailable = () => new WorkflowError("This action is unavailable.");

export function linkClubDepartment(scope: Scope, raw: unknown) {
  const input = z.object({ club: z.uuid(), department: z.uuid().or(z.literal("")) }).parse(raw);
  return transaction(async client => {
    const office = await client.query("SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role='admin' AND ended_at IS NULL FOR SHARE",
      [scope.institution, scope.account]);
    if (scope.role !== "admin" || !office.rowCount) throw unavailable();
    if (!(await client.query("SELECT 1 FROM club WHERE institution_id=$1 AND id=$2", [scope.institution, input.club])).rowCount) throw unavailable();
    await client.query("DELETE FROM club_department WHERE institution_id=$1 AND club_id=$2", [scope.institution, input.club]);
    if (input.department) {
      const linked = await client.query(`INSERT INTO club_department (institution_id,club_id,department_id,linked_by)
        SELECT $1,$2,d.id,$4 FROM department d WHERE d.institution_id=$1 AND d.id=$3`, [scope.institution, input.club, input.department, scope.account]);
      if (!linked.rowCount) throw new WorkflowError("Choose a department of this college.");
    }
    await audit(client, scope, input.club, input.department ? "club.department_linked" : "club.department_unlinked");
  });
}

export async function clubDepartment(scope: Scope, club: string) {
  return (await db.query<{ id: string; name: string }>(`SELECT d.id,d.name FROM club_department cd JOIN department d ON (d.institution_id,d.id)=(cd.institution_id,cd.department_id)
    WHERE cd.institution_id=$1 AND cd.club_id=$2`, [scope.institution, club])).rows[0] ?? null;
}

export type DepartmentClub = { id: string; name: string; state: string; department: string; members: number; upcoming: number };
/** For a current HOD: the clubs linked to their department(s), with active members and upcoming published events. */
export async function departmentClubs(scope: Scope) {
  if (scope.role !== "hod") return [];
  return (await db.query<DepartmentClub>(`SELECT c.id,p.name,c.state,d.name AS department,
      (SELECT count(*)::int FROM club_member cm WHERE (cm.institution_id,cm.club_id)=(c.institution_id,c.id) AND cm.state='active') AS members,
      (SELECT count(*)::int FROM club_event e WHERE (e.institution_id,e.club_id)=(c.institution_id,c.id) AND e.published_at IS NOT NULL
        AND e.state IN ('published','registration_open','registration_closed') AND e.starts_at > clock_timestamp()) AS upcoming
    FROM club_department cd JOIN club c ON (c.institution_id,c.id)=(cd.institution_id,cd.club_id)
    JOIN club_proposal p ON (p.institution_id,p.id)=(c.institution_id,c.id)
    JOIN department d ON (d.institution_id,d.id)=(cd.institution_id,cd.department_id)
    JOIN membership m ON m.institution_id=cd.institution_id AND m.account_id=$2 AND m.role='hod' AND m.department_id=cd.department_id AND m.ended_at IS NULL
    WHERE cd.institution_id=$1 ORDER BY p.name LIMIT 100`, [scope.institution, scope.account])).rows;
}
