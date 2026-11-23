import { z } from "zod";
import { audit, WorkflowError } from "./assignments";
import { db, transaction } from "./db";
import type { Scope } from "./scope";

const target = z.object({
  offering: z.uuid(),
  revision: z.number().int().nonnegative(),
  percent: z.number().int().min(1).max(100).nullable(),
  source: z.string().trim().min(1).max(200),
});

export async function planningOptions(scope: Scope) {
  if (scope.role !== "admin") return [];
  return (await db.query<{id:string; label:string; revision:number; percent:number|null; source:string|null}>(`
    SELECT o.id, concat_ws(' · ',c.name,s.name,t.name) AS label,
      coalesce(p.revision,0) AS revision,p.percent,p.source
    FROM offering o JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id)
    JOIN section s ON (s.institution_id,s.id)=(o.institution_id,o.section_id)
    JOIN academic_term t ON (t.institution_id,t.id)=(o.institution_id,o.term_id)
    LEFT JOIN LATERAL (SELECT revision,percent,source FROM attendance_planning_target
      WHERE (institution_id,offering_id)=(o.institution_id,o.id) ORDER BY revision DESC LIMIT 1) p ON true
    WHERE o.institution_id=$1 AND EXISTS (SELECT 1 FROM membership WHERE institution_id=$1
      AND account_id=$2 AND role='admin' AND ended_at IS NULL) ORDER BY label,o.id`,
    [scope.institution,scope.account])).rows;
}

export async function savePlanningTarget(scope: Scope, raw: unknown) {
  const input = target.parse(raw);
  const denied = () => new WorkflowError("This planning target is unavailable.");
  if (scope.role !== "admin") throw denied();
  await transaction(async client => {
    const args = [scope.institution,input.offering];
    const allowed = await client.query(`SELECT 1 FROM membership WHERE institution_id=$1
      AND account_id=$2 AND role='admin' AND ended_at IS NULL FOR SHARE`,[scope.institution,scope.account]);
    if (!allowed.rowCount) throw denied();
    // Serialize first-time creation as well as revisions, including withdrawing a target.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [args.join("/")]);
    if (!(await client.query("SELECT 1 FROM offering WHERE institution_id=$1 AND id=$2",args)).rowCount) throw denied();
    const {rows:[current]} = await client.query("SELECT coalesce(max(revision),0) AS revision FROM attendance_planning_target WHERE institution_id=$1 AND offering_id=$2",args);
    if (current.revision !== input.revision) throw new WorkflowError("The planning target changed. Refresh and review the current value.");
    await client.query(`INSERT INTO attendance_planning_target (institution_id,offering_id,revision,percent,source,actor_id)
      VALUES ($1,$2,$3,$4,$5,$6)`,[...args,input.revision+1,input.percent,input.source,scope.account]);
    await audit(client,scope,input.offering,"attendance.planning_target",input.revision+1);
  });
}
