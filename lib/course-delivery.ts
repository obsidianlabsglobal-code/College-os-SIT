import type { PoolClient } from "pg";
import { z } from "zod";
import { audit, WorkflowError } from "./assignments";
import { db, transaction } from "./db";
import type { Upload } from "./files";
import type { Scope } from "./scope";

const unavailable = () => new WorkflowError("This action is unavailable.");
const text = (max: number) => z.string().trim().min(1).max(max);

// Active roster of the given role on the offering, locked for the transaction.
async function teaches(client: PoolClient, scope: Scope, offering: string) {
  if (scope.role !== "faculty") throw unavailable();
  const { rowCount } = await client.query(`SELECT 1 FROM roster r JOIN membership m USING (institution_id,account_id,role)
    WHERE r.institution_id=$1 AND r.offering_id=$2 AND r.account_id=$3 AND r.role='faculty' AND r.ended_at IS NULL AND m.ended_at IS NULL
    FOR SHARE OF r,m`, [scope.institution, offering, scope.account]);
  if (!rowCount) throw unavailable();
}
// Read access: own active roster (student or faculty), or the HOD of the course's department.
const readable = `(EXISTS (SELECT 1 FROM roster r JOIN membership m USING (institution_id,account_id,role)
    WHERE r.institution_id=o.institution_id AND r.offering_id=o.id AND r.account_id=$2 AND r.role=$3 AND $3 IN ('student','faculty')
      AND r.ended_at IS NULL AND m.ended_at IS NULL)
  OR ($3='hod' AND EXISTS (SELECT 1 FROM course c JOIN membership h ON h.institution_id=c.institution_id AND h.department_id=c.department_id
    WHERE (c.institution_id,c.id)=(o.institution_id,o.course_id) AND h.account_id=$2 AND h.role='hod' AND h.ended_at IS NULL)))`;

// ---- Course materials (SA-018, FC-020) ----

export type Resource = { id: string; title: string; version: number; filename: string; note: string | null; uploaded_at: Date; versions: number };

export async function courseResources(scope: Scope, offering: string) {
  return (await db.query<Resource>(`SELECT cr.id,cr.title,v.version,v.filename,v.note,v.uploaded_at,v.version AS versions
    FROM course_resource cr JOIN offering o ON (o.institution_id,o.id)=(cr.institution_id,cr.offering_id)
    JOIN LATERAL (SELECT version,filename,note,uploaded_at FROM course_resource_version x
      WHERE (x.institution_id,x.resource_id)=(cr.institution_id,cr.id) ORDER BY version DESC LIMIT 1) v ON true
    WHERE cr.institution_id=$1 AND cr.offering_id=$4 AND cr.withdrawn_at IS NULL AND ${readable}
    ORDER BY cr.title,cr.id`, [scope.institution, scope.account, scope.role, offering])).rows;
}

/** Latest version for everyone who can read the course; earlier versions for its teachers only. */
export async function resourceFile(scope: Scope, resource: string, version?: number) {
  return (await db.query<{ filename: string; mime: string; bytes: Buffer }>(`SELECT v.filename,v.mime,v.bytes
    FROM course_resource cr JOIN offering o ON (o.institution_id,o.id)=(cr.institution_id,cr.offering_id)
    JOIN course_resource_version v ON (v.institution_id,v.resource_id)=(cr.institution_id,cr.id)
    WHERE cr.institution_id=$1 AND cr.id=$4 AND cr.withdrawn_at IS NULL AND ${readable}
      AND v.version = CASE WHEN $3='faculty' AND $5::int IS NOT NULL THEN $5::int
        ELSE (SELECT max(version) FROM course_resource_version x WHERE (x.institution_id,x.resource_id)=(cr.institution_id,cr.id)) END`,
  [scope.institution, scope.account, scope.role, resource, version ?? null])).rows[0] ?? null;
}

const resourceInput = z.object({ offering: z.uuid(), title: text(160), note: z.string().trim().max(500).optional() });
export function addResource(scope: Scope, raw: unknown, file: Upload | null) {
  const input = resourceInput.parse(raw);
  if (!file) throw new WorkflowError("Choose a PDF or text file.");
  return transaction(async client => {
    await teaches(client, scope, input.offering);
    const { rows: [row] } = await client.query<{ id: string }>(
      "INSERT INTO course_resource (institution_id,offering_id,title,created_by) VALUES ($1,$2,$3,$4) RETURNING id",
      [scope.institution, input.offering, input.title, scope.account]);
    await client.query(`INSERT INTO course_resource_version (institution_id,resource_id,version,filename,mime,bytes,note,uploaded_by)
      VALUES ($1,$2,1,$3,$4,$5,$6,$7)`, [scope.institution, row.id, file.filename, file.mime, file.bytes, input.note || null, scope.account]);
    await audit(client, scope, row.id, "course_resource.added", 1);
    return row.id;
  });
}

async function lockResource(client: PoolClient, scope: Scope, resource: string) {
  const { rows: [row] } = await client.query<{ offering_id: string }>(
    "SELECT offering_id FROM course_resource WHERE institution_id=$1 AND id=$2 AND withdrawn_at IS NULL FOR UPDATE", [scope.institution, resource]);
  if (!row) throw unavailable();
  await teaches(client, scope, row.offering_id);
}

export function reviseResource(scope: Scope, raw: unknown, file: Upload | null) {
  const input = z.object({ resource: z.uuid(), note: text(500) }).parse(raw);
  if (!file) throw new WorkflowError("Choose a PDF or text file.");
  return transaction(async client => {
    await lockResource(client, scope, input.resource);
    const { rows: [row] } = await client.query<{ version: number }>(`INSERT INTO course_resource_version
      (institution_id,resource_id,version,filename,mime,bytes,note,uploaded_by)
      SELECT $1,$2,max(version)+1,$3,$4,$5,$6,$7 FROM course_resource_version WHERE institution_id=$1 AND resource_id=$2 RETURNING version`,
    [scope.institution, input.resource, file.filename, file.mime, file.bytes, input.note, scope.account]);
    await audit(client, scope, input.resource, "course_resource.revised", row.version);
    return row.version;
  });
}

export function withdrawResource(scope: Scope, resource: string) {
  const id = z.uuid().parse(resource);
  return transaction(async client => {
    await lockResource(client, scope, id);
    await client.query("UPDATE course_resource SET withdrawn_at=clock_timestamp() WHERE institution_id=$1 AND id=$2", [scope.institution, id]);
    await audit(client, scope, id, "course_resource.withdrawn");
  });
}

// ---- Course plan, approval and delivery (FC-006, DH-005, DH-011, DH-022) ----

export type Plan = { state: "none" | "draft" | "submitted" | "approved" | "returned"; revision: number; decision_reason: string | null;
  items: { id: string; sequence: number; topic: string; delivered: number }[] };

export async function coursePlan(scope: Scope, offering: string): Promise<Plan | null> {
  const { rows: [access] } = await db.query<{ ok: boolean }>(`SELECT ${readable} AS ok FROM offering o WHERE o.institution_id=$1 AND o.id=$4`,
    [scope.institution, scope.account, scope.role, offering]);
  if (!access?.ok) return null;
  const { rows: [plan] } = await db.query<{ state: Plan["state"]; revision: number; decision_reason: string | null }>(
    "SELECT state,revision,decision_reason FROM course_plan WHERE institution_id=$1 AND offering_id=$2", [scope.institution, offering]);
  if (!plan) return { state: "none", revision: 0, decision_reason: null, items: [] };
  // Students see topics only once the department has approved the plan.
  if (scope.role === "student" && plan.state !== "approved") return { state: "none", revision: 0, decision_reason: null, items: [] };
  const { rows: items } = await db.query<Plan["items"][number]>(`SELECT i.id,i.sequence,i.topic,
      (SELECT count(*)::int FROM class_delivery d WHERE (d.institution_id,d.plan_item_id)=(i.institution_id,i.id)) AS delivered
    FROM course_plan_item i WHERE i.institution_id=$1 AND i.offering_id=$2 ORDER BY i.sequence`, [scope.institution, offering]);
  return { ...plan, items };
}

async function lockPlan(client: PoolClient, scope: Scope, offering: string) {
  await client.query(`INSERT INTO course_plan (institution_id,offering_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [scope.institution, offering]);
  return (await client.query<{ state: string; revision: number }>(
    "SELECT state,revision FROM course_plan WHERE institution_id=$1 AND offering_id=$2 FOR UPDATE", [scope.institution, offering])).rows[0];
}

const topicsInput = z.object({ offering: z.uuid(), topics: z.array(text(200)).min(1).max(100) });
/** Replace the draft topics. Only a draft or returned plan can change; approval freezes it. */
export function savePlan(scope: Scope, raw: unknown) {
  const input = topicsInput.parse(raw);
  return transaction(async client => {
    await teaches(client, scope, input.offering);
    const plan = await lockPlan(client, scope, input.offering);
    if (plan.state !== "draft" && plan.state !== "returned") throw new WorkflowError("This plan is awaiting or has received department approval.");
    await client.query("DELETE FROM course_plan_item WHERE institution_id=$1 AND offering_id=$2", [scope.institution, input.offering]);
    await client.query(`INSERT INTO course_plan_item (institution_id,offering_id,sequence,topic)
      SELECT $1,$2,n,t FROM unnest($3::text[]) WITH ORDINALITY AS u(t,n)`, [scope.institution, input.offering, input.topics]);
    await client.query("UPDATE course_plan SET state='draft',decided_by=NULL,decided_at=NULL,decision_reason=NULL WHERE institution_id=$1 AND offering_id=$2",
      [scope.institution, input.offering]);
    await audit(client, scope, input.offering, "course_plan.saved", plan.revision);
  });
}

export function submitPlan(scope: Scope, offering: string) {
  const id = z.uuid().parse(offering);
  return transaction(async client => {
    await teaches(client, scope, id);
    const plan = await lockPlan(client, scope, id);
    const { rows: [count] } = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM course_plan_item WHERE institution_id=$1 AND offering_id=$2", [scope.institution, id]);
    if (plan.state !== "draft" || !count.n) throw new WorkflowError("Save at least one topic before submitting the plan.");
    await client.query("UPDATE course_plan SET state='submitted',submitted_by=$3 WHERE institution_id=$1 AND offering_id=$2", [scope.institution, id, scope.account]);
    await audit(client, scope, id, "course_plan.submitted", plan.revision);
  });
}

const decisionInput = z.object({ offering: z.uuid(), decision: z.enum(["approve", "return"]), reason: text(500) });
export function decidePlan(scope: Scope, raw: unknown) {
  const input = decisionInput.parse(raw);
  if (scope.role !== "hod") throw unavailable();
  return transaction(async client => {
    const { rowCount } = await client.query(`SELECT 1 FROM offering o JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id)
      JOIN membership h ON h.institution_id=c.institution_id AND h.department_id=c.department_id AND h.account_id=$3 AND h.role='hod' AND h.ended_at IS NULL
      WHERE o.institution_id=$1 AND o.id=$2 FOR SHARE OF h`, [scope.institution, input.offering, scope.account]);
    if (!rowCount) throw unavailable();
    const { rows: [plan] } = await client.query<{ state: string; revision: number }>(
      "SELECT state,revision FROM course_plan WHERE institution_id=$1 AND offering_id=$2 FOR UPDATE", [scope.institution, input.offering]);
    if (plan?.state !== "submitted") throw new WorkflowError("This plan is not awaiting a decision.");
    await client.query(`UPDATE course_plan SET state=$3,decided_by=$4,decided_at=clock_timestamp(),decision_reason=$5,
      revision=revision+CASE WHEN $3='returned' THEN 1 ELSE 0 END WHERE institution_id=$1 AND offering_id=$2`,
    [scope.institution, input.offering, input.decision === "approve" ? "approved" : "returned", scope.account, input.reason]);
    await audit(client, scope, input.offering, "course_plan.decided", plan.revision);
  });
}

export type DeliverySession = { id: string; start: Date; state: string; plan_item_id: string | null; summary: string | null; revision: number | null };
/** The teacher's ended classes for this offering with any recorded delivery. */
export async function deliverySessions(scope: Scope, offering: string) {
  if (scope.role !== "faculty") return [];
  return (await db.query<DeliverySession>(`SELECT s.id,lower(s.slot) AS start,s.state,d.plan_item_id,d.summary,d.revision
    FROM class_session s JOIN offering o ON (o.institution_id,o.id)=(s.institution_id,s.offering_id)
    LEFT JOIN class_delivery d ON (d.institution_id,d.session_id)=(s.institution_id,s.id)
    WHERE s.institution_id=$1 AND s.offering_id=$4 AND s.faculty_id=$2 AND s.state IN ('published','conducted') AND upper(s.slot)<=now() AND ${readable}
    ORDER BY lower(s.slot) DESC LIMIT 60`, [scope.institution, scope.account, scope.role, offering])).rows;
}

const deliveryInput = z.object({ session: z.uuid(), item: z.uuid().optional(), summary: text(1000) });
export function recordDelivery(scope: Scope, raw: unknown) {
  const input = deliveryInput.parse(raw);
  return transaction(async client => {
    const { rows: [session] } = await client.query<{ offering_id: string; faculty_id: string; ended: boolean; state: string }>(
      "SELECT offering_id,faculty_id,upper(slot)<=now() AS ended,state FROM class_session WHERE institution_id=$1 AND id=$2 FOR UPDATE",
      [scope.institution, input.session]);
    if (!session || session.faculty_id !== scope.account || !session.ended || !["published", "conducted"].includes(session.state)) throw unavailable();
    await teaches(client, scope, session.offering_id);
    if (input.item) {
      const { rowCount } = await client.query(`SELECT 1 FROM course_plan_item i JOIN course_plan p USING (institution_id,offering_id)
        WHERE i.institution_id=$1 AND i.id=$2 AND i.offering_id=$3 AND p.state='approved'`, [scope.institution, input.item, session.offering_id]);
      if (!rowCount) throw new WorkflowError("Choose a topic from this course’s approved plan.");
    }
    const { rows: [row] } = await client.query<{ revision: number }>(`INSERT INTO class_delivery (institution_id,session_id,plan_item_id,summary,recorded_by)
      VALUES ($1,$2,$3,$4,$5) ON CONFLICT (institution_id,session_id) DO UPDATE
      SET plan_item_id=EXCLUDED.plan_item_id,summary=EXCLUDED.summary,recorded_by=EXCLUDED.recorded_by,
        recorded_at=clock_timestamp(),revision=class_delivery.revision+1 RETURNING revision`,
    [scope.institution, input.session, input.item ?? null, input.summary, scope.account]);
    await audit(client, scope, input.session, "class.delivery_recorded", row.revision);
  });
}

export type DeliveryRow = { offering: string; course: string; section: string; term: string; plan: Plan["state"]; topics: number; covered: number;
  held: number; logged: number; submitted_by: string | null };
/** HOD: per offering in the department, plan state and coverage of approved topics, and recorded classes with a delivery log. */
export async function departmentDelivery(scope: Scope) {
  if (scope.role !== "hod") return [];
  return (await db.query<DeliveryRow>(`SELECT o.id AS offering,c.name AS course,s.name AS section,t.name AS term,coalesce(p.state,'none') AS plan,
      (SELECT count(*)::int FROM course_plan_item i WHERE (i.institution_id,i.offering_id)=(o.institution_id,o.id)) AS topics,
      (SELECT count(DISTINCT d.plan_item_id)::int FROM class_delivery d JOIN course_plan_item i ON (i.institution_id,i.id)=(d.institution_id,d.plan_item_id)
        WHERE (i.institution_id,i.offering_id)=(o.institution_id,o.id)) AS covered,
      (SELECT count(*)::int FROM class_session cs WHERE (cs.institution_id,cs.offering_id)=(o.institution_id,o.id) AND cs.state='conducted') AS held,
      (SELECT count(*)::int FROM class_session cs JOIN class_delivery d ON (d.institution_id,d.session_id)=(cs.institution_id,cs.id)
        WHERE (cs.institution_id,cs.offering_id)=(o.institution_id,o.id)) AS logged,
      u.name AS submitted_by
    FROM offering o JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id)
    JOIN section s ON (s.institution_id,s.id)=(o.institution_id,o.section_id)
    JOIN academic_term t ON (t.institution_id,t.id)=(o.institution_id,o.term_id)
    JOIN membership h ON h.institution_id=c.institution_id AND h.department_id=c.department_id AND h.account_id=$2 AND h.role='hod' AND h.ended_at IS NULL
    LEFT JOIN course_plan p ON (p.institution_id,p.offering_id)=(o.institution_id,o.id)
    LEFT JOIN "user" u ON u.id=p.submitted_by
    WHERE o.institution_id=$1 ORDER BY (p.state='submitted') DESC NULLS LAST,c.name,s.name`, [scope.institution, scope.account])).rows;
}
