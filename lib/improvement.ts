import type { PoolClient } from "pg";
import { z } from "zod";
import { audit, WorkflowError } from "./assignments";
import { db, transaction } from "./db";
import type { Scope } from "./scope";

// LE-010 / LE-011 / DH-025: improvement actions. The principal sets institution actions owned by an HOD, admin or
// themself; an HOD sets department actions owned by a teacher in that department or themself. Only the owner posts
// progress and closes the action. Readers: the creator's level and the owner.
const unavailable = () => new WorkflowError("This action is unavailable.");

const readable = `(a.owner_id=$2 OR a.created_by=$2
  OR (a.department_id IS NULL AND $3 IN ('principal','hod','admin') AND EXISTS (SELECT 1 FROM membership x WHERE x.institution_id=a.institution_id AND x.account_id=$2 AND x.role=$3 AND x.ended_at IS NULL))
  OR (a.department_id IS NOT NULL AND (($3='principal' AND EXISTS (SELECT 1 FROM membership x WHERE x.institution_id=a.institution_id AND x.account_id=$2 AND x.role='principal' AND x.ended_at IS NULL))
    OR ($3='hod' AND EXISTS (SELECT 1 FROM membership h WHERE h.institution_id=a.institution_id AND h.account_id=$2 AND h.role='hod' AND h.department_id=a.department_id AND h.ended_at IS NULL)))))
  AND EXISTS (SELECT 1 FROM membership me WHERE me.institution_id=a.institution_id AND me.account_id=$2 AND me.role=$3 AND me.ended_at IS NULL)`;

export type Action = { id: string; title: string; measure: string; department: string | null; owner: string; owner_id: string; due_on: string;
  state: "open" | "done" | "dropped"; progress: number; overdue: boolean; closed_at: Date | null;
  updates: { author: string; progress: number; note: string; created_at: string }[] };

export async function improvementActions(scope: Scope) {
  return (await db.query<Action>(`SELECT a.id,a.title,a.measure,d.name AS department,u.name AS owner,a.owner_id,to_char(a.due_on,'YYYY-MM-DD') AS due_on,
      a.state,a.progress,(a.state='open' AND a.due_on < (clock_timestamp() AT TIME ZONE i.timezone)::date) AS overdue,a.closed_at,
      coalesce((SELECT json_agg(json_build_object('author',au.name,'progress',x.progress,'note',x.note,'created_at',x.created_at) ORDER BY x.created_at DESC)
        FROM improvement_update x JOIN "user" au ON au.id=x.author_id WHERE (x.institution_id,x.action_id)=(a.institution_id,a.id)),'[]') AS updates
    FROM improvement_action a JOIN institution i ON i.id=a.institution_id JOIN "user" u ON u.id=a.owner_id
    LEFT JOIN department d ON (d.institution_id,d.id)=(a.institution_id,a.department_id)
    WHERE a.institution_id=$1 AND ${readable}
    ORDER BY (a.state='open') DESC,a.due_on,a.id LIMIT 200`, [scope.institution, scope.account, scope.role])).rows;
}

/** LE-011 measure: open, overdue, and closed-done on or before the due date. */
export function actionMeasures(rows: Action[]) {
  const done = rows.filter(a => a.state === "done");
  return { open: rows.filter(a => a.state === "open").length, overdue: rows.filter(a => a.overdue).length, done: done.length,
    onTime: done.filter(a => a.closed_at && a.closed_at.toISOString().slice(0, 10) <= a.due_on).length };
}

/** Who may own an action the caller creates, and in which department. */
export async function actionOwners(scope: Scope) {
  if (scope.role === "principal") return (await db.query<{ id: string; name: string; department: string | null; label: string }>(`SELECT DISTINCT u.id,u.name,NULL::uuid AS department,
      u.name||' · '||CASE m.role WHEN 'hod' THEN 'Department head' WHEN 'admin' THEN 'Administration' ELSE 'Principal' END AS label
    FROM membership m JOIN "user" u ON u.id=m.account_id WHERE m.institution_id=$1 AND m.role IN ('hod','admin','principal') AND m.ended_at IS NULL
      AND EXISTS (SELECT 1 FROM membership p WHERE p.institution_id=$1 AND p.account_id=$2 AND p.role='principal' AND p.ended_at IS NULL)
    ORDER BY label`, [scope.institution, scope.account])).rows;
  if (scope.role === "hod") return (await db.query<{ id: string; name: string; department: string | null; label: string }>(`SELECT DISTINCT u.id,u.name,h.department_id AS department,
      u.name||' · '||d.name AS label
    FROM membership h JOIN department d ON (d.institution_id,d.id)=(h.institution_id,h.department_id)
    JOIN "user" u ON u.id=h.account_id OR u.id IN (SELECT r.account_id FROM roster r JOIN offering o ON (o.institution_id,o.id)=(r.institution_id,r.offering_id)
      JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id) JOIN membership fm ON fm.institution_id=r.institution_id AND fm.account_id=r.account_id AND fm.role='faculty' AND fm.ended_at IS NULL
      WHERE r.institution_id=h.institution_id AND c.department_id=h.department_id AND r.role='faculty' AND r.ended_at IS NULL)
    WHERE h.institution_id=$1 AND h.account_id=$2 AND h.role='hod' AND h.ended_at IS NULL ORDER BY label`, [scope.institution, scope.account])).rows;
  return [];
}

const createInput = z.object({ title: z.string().trim().min(1).max(160), measure: z.string().trim().min(1).max(500),
  owner: z.string().min(1).max(100), department: z.uuid().optional(), due: z.iso.date() });

export function createAction(scope: Scope, raw: unknown) {
  const input = createInput.parse(raw);
  return transaction(async client => {
    const owners = await actionOwners(scope);
    if (!owners.some(o => o.id === input.owner && (o.department ?? undefined) === input.department)) throw new WorkflowError("Choose an owner you can assign.");
    const { rows: [row] } = await client.query<{ id: string }>(`INSERT INTO improvement_action (institution_id,department_id,title,measure,owner_id,due_on,created_by)
      SELECT $1,$2,$3,$4,$5,$6,$7 FROM institution i WHERE i.id=$1 AND $6::date >= (clock_timestamp() AT TIME ZONE i.timezone)::date
        AND EXISTS (SELECT 1 FROM membership m WHERE m.institution_id=$1 AND m.account_id=$7 AND m.role=$8 AND m.ended_at IS NULL)
      RETURNING id`, [scope.institution, input.department ?? null, input.title, input.measure, input.owner, input.due, scope.account, scope.role]);
    if (!row) throw new WorkflowError("Choose a due date from today onward.");
    await audit(client, scope, row.id, "improvement.created", 1, input.owner);
    return row.id;
  });
}

async function lockOwned(client: PoolClient, scope: Scope, id: string) {
  const { rows: [row] } = await client.query<{ state: string }>(`SELECT a.state FROM improvement_action a
    WHERE a.institution_id=$1 AND a.id=$4 AND a.owner_id=$2 AND ${readable} FOR UPDATE OF a`, [scope.institution, scope.account, scope.role, id]);
  if (!row || row.state !== "open") throw unavailable();
}

const updateInput = z.object({ action: z.uuid(), progress: z.coerce.number().int().min(0).max(100), note: z.string().trim().min(1).max(1000),
  close: z.enum(["done", "dropped"]).optional() });
export function updateAction(scope: Scope, raw: unknown) {
  const input = updateInput.parse(raw);
  return transaction(async client => {
    await lockOwned(client, scope, input.action);
    await client.query("INSERT INTO improvement_update (institution_id,action_id,author_id,progress,note) VALUES ($1,$2,$3,$4,$5)",
      [scope.institution, input.action, scope.account, input.close === "done" ? 100 : input.progress, input.note]);
    await client.query(`UPDATE improvement_action SET progress=$3,state=coalesce($4,'open'),closed_at=CASE WHEN $4::text IS NULL THEN NULL ELSE clock_timestamp() END
      WHERE institution_id=$1 AND id=$2`, [scope.institution, input.action, input.close === "done" ? 100 : input.progress, input.close ?? null]);
    await audit(client, scope, input.action, input.close ? `improvement.${input.close}` : "improvement.updated");
  });
}
