import { z } from "zod";
import { audit, WorkflowError } from "./assignments";
import { clubAccess, lockClubActor } from "./clubverse";
import { db, transaction } from "./db";
import type { Scope } from "./scope";

// CL-047: a decision from a club meeting becomes a task with an owner and a due date. Officers (scoped club grant) assign
// to active members; only the owner marks it done; active members see the club's tasks.
const unavailable = () => new WorkflowError("This CLUBVERSE action is unavailable.");
const taskInput = z.object({ club: z.uuid(), decided: z.iso.date(), decision: z.string().trim().min(1).max(500), owner: z.string().min(1).max(100), due: z.iso.date() });

export async function addClubTask(scope: Scope, raw: unknown) {
  const input = taskInput.parse(raw);
  if (input.due < input.decided) throw new WorkflowError("The due date can't be before the meeting.");
  return transaction(async client => {
    await lockClubActor(client, scope);
    const access = await clubAccess(client, scope, input.club);
    if (access.state !== "active" || !access.officer) throw unavailable();
    const { rows: [row] } = await client.query<{ id: string }>(`INSERT INTO club_task (institution_id,club_id,decided_on,decision,owner_id,due_on,created_by)
      SELECT $1,$2,$3,$4,$5,$6,$7 FROM club_member cm WHERE (cm.institution_id,cm.club_id,cm.account_id)=($1,$2,$5) AND cm.state='active' RETURNING id`,
    [scope.institution, input.club, input.decided, input.decision, input.owner, input.due, scope.account]);
    if (!row) throw new WorkflowError("Assign the task to an active club member.");
    await audit(client, scope, row.id, "club.task_assigned", undefined, input.owner);
    return row.id;
  });
}

export function completeClubTask(scope: Scope, raw: unknown) {
  const input = z.object({ club: z.uuid(), task: z.uuid() }).parse(raw);
  return transaction(async client => {
    await lockClubActor(client, scope);
    const access = await clubAccess(client, scope, input.club);
    if (!access.member) throw unavailable();
    const done = await client.query(`UPDATE club_task SET done_at=clock_timestamp() WHERE institution_id=$1 AND club_id=$2 AND id=$3 AND owner_id=$4 AND done_at IS NULL`,
      [scope.institution, input.club, input.task, scope.account]);
    if (!done.rowCount) throw new WorkflowError("Only the task's owner can mark it done, once.");
    await audit(client, scope, input.task, "club.task_done", undefined, scope.account);
  });
}

export type ClubTask = { id: string; decided_on: string; decision: string; owner: string; owner_id: string; due_on: string; done: boolean; overdue: boolean };
/** Open tasks and those done in the last 30 days, for active members of an active club. */
export async function clubTasks(scope: Scope, club: string) {
  return (await db.query<ClubTask>(`SELECT t.id,to_char(t.decided_on,'YYYY-MM-DD') AS decided_on,t.decision,u.name AS owner,t.owner_id,
      to_char(t.due_on,'YYYY-MM-DD') AS due_on,t.done_at IS NOT NULL AS done,
      (t.done_at IS NULL AND t.due_on < (clock_timestamp() AT TIME ZONE i.timezone)::date) AS overdue
    FROM club_task t JOIN "user" u ON u.id=t.owner_id JOIN institution i ON i.id=t.institution_id
    JOIN club c ON (c.institution_id,c.id)=(t.institution_id,t.club_id) AND c.state='active'
    WHERE t.institution_id=$1 AND t.club_id=$2 AND (t.done_at IS NULL OR t.done_at > clock_timestamp()-interval '30 days')
      AND EXISTS (SELECT 1 FROM membership m WHERE m.institution_id=$1 AND m.account_id=$3 AND m.role=$4 AND m.role IN ('student','faculty') AND m.ended_at IS NULL)
      AND EXISTS (SELECT 1 FROM club_member cm WHERE (cm.institution_id,cm.club_id,cm.account_id)=($1,$2,$3) AND cm.state='active')
    ORDER BY t.done_at IS NOT NULL,t.due_on,t.id LIMIT 50`, [scope.institution, club, scope.account, scope.role])).rows;
}
