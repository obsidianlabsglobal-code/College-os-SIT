import type { PoolClient } from "pg";
import { audit, offerings, WorkflowError } from "./assignments";
import { db, transaction } from "./db";
import type { Scope } from "./scope";

async function lockMembership(client: PoolClient, current: Scope, department?: string) {
  const result = await client.query(
    `SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role=$3
     AND ended_at IS NULL AND ($4::uuid IS NULL OR department_id=$4) FOR SHARE`,
    [current.institution, current.account, current.role, department],
  );
  if (!result.rowCount) throw new WorkflowError("This action is unavailable.");
}

async function lockNoticeScope(client: PoolClient, current: Scope, target?: string) {
  if (current.role === "admin" && !target) {
    await lockMembership(client,current);
  } else if (current.role === "hod" && target) {
    await lockMembership(client,current,target);
  } else if (current.role === "faculty" && target) {
    await lockMembership(client,current);
    const roster = await client.query(
      "SELECT 1 FROM roster WHERE institution_id=$1 AND offering_id=$2 AND account_id=$3 AND role='faculty' AND ended_at IS NULL FOR SHARE",
      [current.institution,target,current.account],
    );
    if (!roster.rowCount) throw new WorkflowError("This audience is unavailable.");
  } else {
    throw new WorkflowError("This audience is unavailable.");
  }
}

export async function noticeTargets(current: Scope) {
  if (current.role === "faculty") return (await offerings(current)).map(row => ({ id: row.id, name: row.label }));
  if (current.role !== "hod") return [];
  return (await db.query<{ id: string; name: string }>(
    `SELECT d.id,d.name FROM membership m JOIN department d ON (d.institution_id,d.id)=(m.institution_id,m.department_id)
     WHERE m.institution_id=$1 AND m.account_id=$2 AND m.role='hod' AND m.ended_at IS NULL ORDER BY d.name`,
     [current.institution,current.account],
  )).rows;
}

export async function notices(current: Scope, filter: "all" | "published" | "draft", limit?: number) {
  return (await db.query<{ id: string; title: string; body: string; author: string; audience: string; published_at: Date | null }>(
    `SELECT n.id,n.title,n.body,u.name AS author,n.published_at,
      COALESCE(d.name,c.name || ' · ' || s.name,'Institution') AS audience
      FROM notice n JOIN "user" u ON u.id=n.author_id
      LEFT JOIN department d ON (d.institution_id,d.id)=(n.institution_id,n.department_id)
      LEFT JOIN offering o ON (o.institution_id,o.id)=(n.institution_id,n.offering_id)
      LEFT JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id)
      LEFT JOIN section s ON (s.institution_id,s.id)=(o.institution_id,o.section_id)
      WHERE n.institution_id=$1
      AND EXISTS (SELECT 1 FROM membership m WHERE m.institution_id=$1 AND m.account_id=$2 AND m.role=$3 AND m.ended_at IS NULL)
      AND ($4='all' OR ($4='draft' AND n.published_at IS NULL) OR ($4='published' AND n.published_at IS NOT NULL))
      AND (
        (n.published_at IS NOT NULL AND n.department_id IS NULL AND n.offering_id IS NULL)
        OR ((n.published_at IS NOT NULL OR (n.author_id=$2 AND n.author_role=$3)) AND (
          $3 IN ('admin','principal') OR
          ($3='hod' AND EXISTS (SELECT 1 FROM membership m WHERE m.institution_id=$1 AND m.account_id=$2 AND m.role=$3
             AND m.ended_at IS NULL AND m.department_id=COALESCE(n.department_id,c.department_id))) OR
          ($3 IN ('faculty','student') AND EXISTS (
            SELECT 1 FROM roster r JOIN offering ro ON (ro.institution_id,ro.id)=(r.institution_id,r.offering_id)
            JOIN course rc ON (rc.institution_id,rc.id)=(ro.institution_id,ro.course_id)
            WHERE r.institution_id=$1 AND r.account_id=$2 AND r.role=$3 AND r.ended_at IS NULL
            AND (r.offering_id=n.offering_id OR rc.department_id=n.department_id)))
        ))
      ) ORDER BY n.published_at DESC NULLS FIRST,n.id LIMIT $5`,
    [current.institution,current.account,current.role,filter,limit ?? null],
  )).rows;
}

export function draftNotice(current: Scope, title: string, body: string, target?: string) {
  return transaction(async client => {
    await lockNoticeScope(client,current,target);
    const { rows: [notice] } = await client.query<{ id: string }>(
      "INSERT INTO notice (institution_id,author_id,author_role,department_id,offering_id,title,body) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
      [current.institution,current.account,current.role,current.role === "hod" ? target : null,current.role === "faculty" ? target : null,title,body],
    );
    await audit(client,current,notice.id,"notice.drafted");
  });
}

export function publishNotice(current: Scope, id: string) {
  return transaction(async client => {
    const { rows: [notice] } = await client.query<{ department_id: string | null; offering_id: string | null; published_at: Date | null }>(
      "SELECT department_id,offering_id,published_at FROM notice WHERE institution_id=$1 AND id=$2 AND author_id=$3 AND author_role=$4 FOR UPDATE",
      [current.institution,id,current.account,current.role],
    );
    if (!notice) throw new WorkflowError("This notice is unavailable.");
    await lockNoticeScope(client,current,notice.department_id ?? notice.offering_id ?? undefined);
    if (notice.published_at) return;
    await client.query("UPDATE notice SET published_at=clock_timestamp() WHERE institution_id=$1 AND id=$2", [current.institution,id]);
    await audit(client,current,id,"notice.published");
  });
}

export type QueueView = "mine" | "unassigned" | "all";

export async function requests(current: Scope, view: QueueView = "all") {
  if (current.role !== "admin" && current.role !== "student") return [];
  return (await db.query<{ id: string; student: string; description: string; status: string; outcome: string | null; handler: string | null;
    assigned_to: string | null; assignee: string | null; created_at: Date }>(
    `SELECT r.id,s.name AS student,r.description,r.status,r.outcome,h.name AS handler,r.assigned_to,a.name AS assignee,r.created_at
     FROM service_request r JOIN "user" s ON s.id=r.student_id LEFT JOIN "user" h ON h.id=r.handled_by LEFT JOIN "user" a ON a.id=r.assigned_to
     WHERE r.institution_id=$1 AND ($3='admin' OR r.student_id=$2)
     AND ($4='all' OR $3<>'admin' OR ($4='mine' AND r.assigned_to=$2) OR ($4='unassigned' AND r.assigned_to IS NULL AND r.status IN ('submitted','in_progress')))
     AND EXISTS (SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role=$3 AND ended_at IS NULL)
     ORDER BY r.created_at DESC,r.id`, [current.institution,current.account,current.role,view],
  )).rows;
}

/** Active administrative staff who can own a request. */
export async function requestStaff(current: Scope) {
  if (current.role !== "admin") return [];
  return (await db.query<{ id: string; name: string }>(
    `SELECT u.id,u.name FROM membership m JOIN "user" u ON u.id=m.account_id
     WHERE m.institution_id=$1 AND m.role='admin' AND m.ended_at IS NULL
     AND EXISTS (SELECT 1 FROM membership c WHERE c.institution_id=$1 AND c.account_id=$2 AND c.role='admin' AND c.ended_at IS NULL)
     ORDER BY u.name`, [current.institution,current.account])).rows;
}

/** Assign an open request to an active admin. Reassignment is allowed; the change is audited and notifies the assignee. */
export async function assignRequest(current: Scope, id: string, assignee: string) {
  if (current.role !== "admin") throw new WorkflowError("This action is unavailable.");
  return transaction(async client => {
    await lockMembership(client,current);
    const staff = await client.query("SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role='admin' AND ended_at IS NULL FOR SHARE",
      [current.institution,assignee]);
    if (!staff.rowCount) throw new WorkflowError("Choose an active administrative staff member.");
    const result = await client.query(
      `UPDATE service_request SET assigned_to=$3,assigned_at=clock_timestamp()
       WHERE institution_id=$1 AND id=$2 AND status IN ('submitted','in_progress') AND assigned_to IS DISTINCT FROM $3`,
      [current.institution,id,assignee]);
    if (!result.rowCount) throw new WorkflowError("This request is unavailable, closed or already assigned to that person.");
    await audit(client,current,id,"service_request.assigned");
  });
}

export async function createRequest(current: Scope, description: string) {
  if (current.role !== "student") throw new WorkflowError("This action is unavailable.");
  return transaction(async client => {
    await lockMembership(client,current);
    const { rows: [request] } = await client.query<{ id: string }>(
      "INSERT INTO service_request (institution_id,student_id,description) VALUES ($1,$2,$3) RETURNING id",
      [current.institution,current.account,description],
    );
    await audit(client,current,request.id,"service_request.submitted");
  });
}

export async function advanceRequest(current: Scope, id: string, next: "in_progress" | "resolved" | "declined", outcome?: string) {
  if (current.role !== "admin") throw new WorkflowError("This action is unavailable.");
  if (next !== "in_progress" && !outcome?.trim()) throw new WorkflowError("Record the outcome before closing this request.");
  return transaction(async client => {
    await lockMembership(client,current);
    const result = await client.query(
      `UPDATE service_request SET status=$3, handled_by=$4, outcome=$5,
          closed_at=CASE WHEN $3='in_progress' THEN NULL ELSE clock_timestamp() END,
          assigned_to=coalesce(assigned_to,$4), assigned_at=coalesce(assigned_at,clock_timestamp())
       WHERE institution_id=$1 AND id=$2 AND (assigned_to IS NULL OR assigned_to=$4) AND (
         ($3='in_progress' AND status='submitted') OR
         ($3 IN ('resolved','declined') AND status='in_progress'))`,
      [current.institution,id,next,current.account,next === "in_progress" ? null : outcome],
    );
    if (!result.rowCount) throw new WorkflowError("This request is unavailable, assigned to someone else, or has already changed.");
    await audit(client,current,id,`service_request.${next}`);
  });
}
