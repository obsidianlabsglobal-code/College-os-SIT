import type { PoolClient } from "pg";
import { eventPlanner } from "./registry";
import { audit, WorkflowError } from "../assignments";
import { clubAccess, eventSchedule, lockClubActor, saveEventDraft } from "../clubverse";
import { db, transaction } from "../db";
import type { Scope } from "../scope";

const unavailable = () => new WorkflowError("This AURA task is unavailable.");

function requireSupportedRole(scope: Scope) {
  if (!(eventPlanner.roles as readonly string[]).includes(scope.role)) throw unavailable();
}

async function logTool(client: PoolClient, scope: Scope, task: string, sequence: number, tool: string, started: number) {
  await client.query(
    "INSERT INTO aura_invocation (institution_id,task_id,sequence,tool,duration_ms) VALUES ($1,$2,$3,$4,$5)",
    [scope.institution,task,sequence,tool,Math.max(0,Math.round(performance.now()-started))],
  );
}

export async function prepareEventPlan(scope: Scope, raw: unknown) {
  requireSupportedRole(scope);
  const input = eventPlanner.input.parse(raw);
  return transaction(async client => {
    await lockClubActor(client,scope);
    const access = await clubAccess(client,scope,input.club);
    if (access.state !== "active" || !access.officer) throw unavailable();
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`aura-budget:${scope.institution}`]);
    const { rows: [budget] } = await client.query<{ total:number; personal:number }>(
      `SELECT count(*)::int AS total,count(*) FILTER (WHERE actor_id=$2)::int AS personal
       FROM aura_task WHERE institution_id=$1 AND created_at > clock_timestamp()-interval '1 hour'`,[scope.institution,scope.account],
    );
    if (budget.total >= 200 || budget.personal >= 20) throw new WorkflowError("The event planning limit has been reached for this hour.");
    const started = performance.now();
    const plan = eventPlanner.output.parse(await eventPlanner.provider.prepare(input,AbortSignal.timeout(eventPlanner.timeoutMs)));
    if (plan.club !== input.club) throw unavailable();
    await eventSchedule(client,scope.institution,plan);
    const { rows: [task] } = await client.query<{ id:string }>(
      `INSERT INTO aura_task (institution_id,club_id,actor_id,actor_role,agent,agent_version,provider,payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [scope.institution,plan.club,scope.account,scope.role,eventPlanner.id,eventPlanner.version,eventPlanner.provider.id,plan],
    );
    await logTool(client,scope,task.id,1,eventPlanner.tools.prepare,started);
    await audit(client,scope,task.id,"aura.event_preview_created");
    return task.id;
  });
}

type Task = {
  id: string; club_id: string; event_id: string | null; state: string; payload: unknown;
  expires_at: Date; expired: boolean; agent_version: number; provider: string; tools?: string[];
};

export async function decideEventPlan(scope: Scope, id: string, decision: "confirmed" | "cancelled") {
  requireSupportedRole(scope);
  return transaction(async client => {
    await lockClubActor(client,scope);
    const key = [scope.institution,id,scope.account,scope.role,eventPlanner.id];
    const { rows: [task] } = await client.query<Task>(
      `SELECT *,clock_timestamp() >= expires_at AS expired FROM aura_task
       WHERE (institution_id,id,actor_id,actor_role,agent)=($1,$2,$3,$4,$5) FOR UPDATE`,key,
    );
    if (!task) throw unavailable();
    if (task.state === "succeeded" && decision === "confirmed") {
      const access = await clubAccess(client,scope,task.club_id);
      if (access.state !== "active" || !access.officer) throw unavailable();
      return task.event_id;
    }
    if (task.state !== "awaiting_approval") throw unavailable();
    if (decision === "confirmed" && (task.expired || task.agent_version !== eventPlanner.version)) {
      throw new WorkflowError("This preview has expired. Prepare a new plan.");
    }
    let event: string | null = null;
    if (decision === "confirmed") {
      const input = eventPlanner.input.parse(task.payload);
      if (input.club !== task.club_id) throw unavailable();
      const access = await clubAccess(client,scope,task.club_id);
      if (access.state !== "active" || !access.officer) throw unavailable();
      const deadline = await client.query("SELECT 1 FROM aura_task WHERE (institution_id,id)=($1,$2) AND expires_at>clock_timestamp()",[scope.institution,id]);
      if (!deadline.rowCount) throw new WorkflowError("This preview has expired. Prepare a new plan.");
      const started = performance.now();
      event = await saveEventDraft(client,scope,input);
      await logTool(client,scope,id,eventPlanner.maxToolCalls,eventPlanner.tools.execute,started);
    }
    await client.query("INSERT INTO aura_approval (institution_id,task_id,decided_by,decision) VALUES ($1,$2,$3,$4)",[scope.institution,id,scope.account,decision]);
    await client.query(
      "UPDATE aura_task SET state=$3,event_id=$4,finished_at=clock_timestamp() WHERE (institution_id,id)=($1,$2)",
      [scope.institution,id,event ? "succeeded" : "cancelled",event],
    );
    // A chat request that produced this preview finishes with the same truthful outcome, in the same transaction.
    await client.query(
      `UPDATE aura_request SET state=$3,result=COALESCE(result,'{}'::jsonb) || jsonb_build_object('eventId',$4::uuid),finished_at=clock_timestamp()
       WHERE (institution_id,task_id,actor_id)=($1,$2,$5) AND state='awaiting_confirmation'`,
      [scope.institution,id,event ? "succeeded" : "cancelled",event,scope.account],
    );
    await audit(client,scope,id,event ? "aura.event_draft_created" : "aura.event_preview_cancelled");
    return event;
  });
}

export async function eventPlans(scope: Scope) {
  requireSupportedRole(scope);
  return (await db.query<Task>(
    `SELECT t.id,t.club_id,t.event_id,t.state,t.payload,t.expires_at,t.agent_version,t.provider,clock_timestamp() >= t.expires_at AS expired,
       ARRAY(SELECT i.tool FROM aura_invocation i WHERE (i.institution_id,i.task_id)=(t.institution_id,t.id) ORDER BY i.sequence) AS tools
     FROM aura_task t WHERE (t.institution_id,t.actor_id,t.actor_role,t.agent)=($1,$2,$3,$4)
     AND EXISTS (SELECT 1 FROM membership m WHERE (m.institution_id,m.account_id,m.role)=($1,$2,$3) AND m.ended_at IS NULL)
     ORDER BY t.created_at DESC LIMIT 30`,[scope.institution,scope.account,scope.role,eventPlanner.id],
  )).rows;
}
