import { z } from "zod";
import { audit, WorkflowError } from "./assignments";
import { db, transaction } from "./db";
import type { Scope } from "./scope";

// FC-025 / DH-016: professional development records verified by the department head.
// DH-017 / FC-021 / LE-012: departmental research projects approved by the HOD, with milestones and evidence.
const unavailable = () => new WorkflowError("This action is unavailable.");
// Departments the caller currently teaches in ($1 institution, $2 account).
const teachesIn = `SELECT DISTINCT c.department_id FROM roster r JOIN offering o ON (o.institution_id,o.id)=(r.institution_id,r.offering_id)
  JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id)
  JOIN membership m ON m.institution_id=r.institution_id AND m.account_id=r.account_id AND m.role='faculty' AND m.ended_at IS NULL
  WHERE r.institution_id=$1 AND r.account_id=$2 AND r.role='faculty' AND r.ended_at IS NULL`;
const hodDepartments = `SELECT department_id FROM membership WHERE institution_id=$1 AND account_id=$2 AND role='hod' AND ended_at IS NULL`;

export async function teachingDepartments(scope: Scope) {
  if (scope.role !== "faculty") return [];
  return (await db.query<{ id: string; name: string }>(`SELECT id,name FROM department WHERE institution_id=$1 AND id IN (${teachesIn}) ORDER BY name`,
    [scope.institution, scope.account])).rows;
}

export type DevRecord = { id: string; faculty: string; department: string; title: string; completed_on: string; hours: number; evidence: string;
  state: "submitted" | "verified" | "returned"; decision_reason: string | null };
export async function developmentRecords(scope: Scope) {
  const where = scope.role === "faculty" ? "r.faculty_id=$2 AND EXISTS (SELECT 1 FROM membership m WHERE m.institution_id=$1 AND m.account_id=$2 AND m.role='faculty' AND m.ended_at IS NULL)"
    : scope.role === "hod" ? `r.department_id IN (${hodDepartments})` : null;
  if (!where) return [];
  return (await db.query<DevRecord>(`SELECT r.id,u.name AS faculty,d.name AS department,r.title,to_char(r.completed_on,'YYYY-MM-DD') AS completed_on,
      r.hours::float8 AS hours,r.evidence,r.state,r.decision_reason
    FROM development_record r JOIN "user" u ON u.id=r.faculty_id JOIN department d ON (d.institution_id,d.id)=(r.institution_id,r.department_id)
    WHERE r.institution_id=$1 AND ${where} ORDER BY (r.state='submitted') DESC,r.completed_on DESC LIMIT 200`, [scope.institution, scope.account])).rows;
}

const devInput = z.object({ department: z.uuid(), title: z.string().trim().min(1).max(160), completed: z.iso.date(),
  hours: z.coerce.number().positive().max(500), evidence: z.string().trim().min(1).max(1000) });
export function addDevelopmentRecord(scope: Scope, raw: unknown) {
  const input = devInput.parse(raw);
  if (scope.role !== "faculty") throw unavailable();
  return transaction(async client => {
    const { rows: [row] } = await client.query<{ id: string }>(`INSERT INTO development_record (institution_id,faculty_id,department_id,title,completed_on,hours,evidence)
      SELECT $1,$2,$3,$4,$5,$6,$7 FROM institution i WHERE i.id=$1 AND $3::uuid IN (${teachesIn})
        AND $5::date <= (clock_timestamp() AT TIME ZONE i.timezone)::date RETURNING id`,
    [scope.institution, scope.account, input.department, input.title, input.completed, input.hours, input.evidence]);
    if (!row) throw new WorkflowError("Choose a department you teach in and a completion date that has passed.");
    await audit(client, scope, row.id, "development.recorded");
    return row.id;
  });
}

const decideDev = z.object({ record: z.uuid(), decision: z.enum(["verify", "return"]), reason: z.string().trim().min(1).max(500) });
export function decideDevelopmentRecord(scope: Scope, raw: unknown) {
  const input = decideDev.parse(raw);
  if (scope.role !== "hod") throw unavailable();
  return transaction(async client => {
    const { rowCount } = await client.query(`UPDATE development_record SET state=$4,decided_by=$2,decided_at=clock_timestamp(),decision_reason=$5
      WHERE institution_id=$1 AND id=$3 AND state='submitted' AND faculty_id<>$2 AND department_id IN (${hodDepartments})`,
    [scope.institution, scope.account, input.record, input.decision === "verify" ? "verified" : "returned", input.reason]);
    if (!rowCount) throw new WorkflowError("This record is not awaiting your decision.");
    await audit(client, scope, input.record, `development.${input.decision === "verify" ? "verified" : "returned"}`);
  });
}

export type Project = { id: string; title: string; summary: string; department: string; lead: string; lead_id: string;
  state: "proposed" | "approved" | "returned" | "completed"; disclosure: "department" | "institution"; decision_reason: string | null;
  milestones: { id: string; title: string; due_on: string; done_at: string | null; evidence: string | null }[] };
/** Lead: own projects. Department teachers: approved projects in their departments. HOD: all in their departments.
 * Principal: approved or completed projects disclosed to the institution (LE-012). */
export async function researchProjects(scope: Scope) {
  const visible = {
    faculty: `(p.lead_id=$2 OR (p.state IN ('approved','completed') AND p.department_id IN (${teachesIn})))`,
    hod: `p.department_id IN (${hodDepartments})`,
    principal: `p.state IN ('approved','completed') AND p.disclosure='institution' AND EXISTS (SELECT 1 FROM membership m WHERE m.institution_id=$1 AND m.account_id=$2 AND m.role='principal' AND m.ended_at IS NULL)`,
  }[scope.role as "faculty" | "hod" | "principal"];
  if (!visible) return [];
  return (await db.query<Project>(`SELECT p.id,p.title,p.summary,d.name AS department,u.name AS lead,p.lead_id,p.state,p.disclosure,p.decision_reason,
      coalesce((SELECT json_agg(json_build_object('id',m.id,'title',m.title,'due_on',to_char(m.due_on,'YYYY-MM-DD'),'done_at',m.done_at,'evidence',m.evidence) ORDER BY m.due_on)
        FROM research_milestone m WHERE (m.institution_id,m.project_id)=(p.institution_id,p.id)),'[]') AS milestones
    FROM research_project p JOIN "user" u ON u.id=p.lead_id JOIN department d ON (d.institution_id,d.id)=(p.institution_id,p.department_id)
    WHERE p.institution_id=$1 AND ${visible} ORDER BY (p.state='proposed') DESC,p.created_at DESC LIMIT 100`, [scope.institution, scope.account])).rows;
}

const proposeInput = z.object({ department: z.uuid(), title: z.string().trim().min(1).max(200), summary: z.string().trim().min(1).max(2000) });
export function proposeProject(scope: Scope, raw: unknown) {
  const input = proposeInput.parse(raw);
  if (scope.role !== "faculty") throw unavailable();
  return transaction(async client => {
    const { rows: [row] } = await client.query<{ id: string }>(`INSERT INTO research_project (institution_id,department_id,lead_id,title,summary)
      SELECT $1,$3,$2,$4,$5 WHERE $3::uuid IN (${teachesIn}) RETURNING id`, [scope.institution, scope.account, input.department, input.title, input.summary]);
    if (!row) throw new WorkflowError("Choose a department you teach in.");
    await audit(client, scope, row.id, "research.proposed");
    return row.id;
  });
}

const decideProjectInput = z.object({ project: z.uuid(), decision: z.enum(["approve", "return"]), reason: z.string().trim().min(1).max(500),
  disclosure: z.enum(["department", "institution"]).default("department") });
export function decideProject(scope: Scope, raw: unknown) {
  const input = decideProjectInput.parse(raw);
  if (scope.role !== "hod") throw unavailable();
  return transaction(async client => {
    const { rowCount } = await client.query(`UPDATE research_project SET state=$4,disclosure=$5,decided_by=$2,decision_reason=$6
      WHERE institution_id=$1 AND id=$3 AND state='proposed' AND department_id IN (${hodDepartments})`,
    [scope.institution, scope.account, input.project, input.decision === "approve" ? "approved" : "returned", input.disclosure, input.reason]);
    if (!rowCount) throw new WorkflowError("This project is not awaiting your decision.");
    await audit(client, scope, input.project, `research.${input.decision === "approve" ? "approved" : "returned"}`);
  });
}

async function leadOf(scope: Scope, project: string, client: { query: typeof db.query }) {
  const { rows: [p] } = await client.query<{ state: string }>(`SELECT p.state FROM research_project p WHERE p.institution_id=$1 AND p.id=$3 AND p.lead_id=$2
    AND p.department_id IN (${teachesIn}) FOR UPDATE`, [scope.institution, scope.account, project]);
  if (scope.role !== "faculty" || p?.state !== "approved") throw unavailable();
}

export function addResearchMilestone(scope: Scope, raw: unknown) {
  const input = z.object({ project: z.uuid(), title: z.string().trim().min(1).max(160), due: z.iso.date() }).parse(raw);
  return transaction(async client => {
    await leadOf(scope, input.project, client);
    await client.query("INSERT INTO research_milestone (institution_id,project_id,title,due_on) VALUES ($1,$2,$3,$4)", [scope.institution, input.project, input.title, input.due]);
    await audit(client, scope, input.project, "research.milestone_set");
  });
}

export function completeResearchMilestone(scope: Scope, raw: unknown) {
  const input = z.object({ milestone: z.uuid(), evidence: z.string().trim().min(1).max(1000) }).parse(raw);
  return transaction(async client => {
    const { rows: [m] } = await client.query<{ project_id: string }>(
      "SELECT project_id FROM research_milestone WHERE institution_id=$1 AND id=$2 AND done_at IS NULL", [scope.institution, input.milestone]);
    if (!m) throw unavailable();
    await leadOf(scope, m.project_id, client);
    await client.query("UPDATE research_milestone SET done_at=clock_timestamp(),evidence=$3 WHERE institution_id=$1 AND id=$2", [scope.institution, input.milestone, input.evidence]);
    const { rows: [left] } = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM research_milestone WHERE institution_id=$1 AND project_id=$2 AND done_at IS NULL",
      [scope.institution, m.project_id]);
    if (left.n === 0) await client.query("UPDATE research_project SET state='completed' WHERE institution_id=$1 AND id=$2", [scope.institution, m.project_id]);
    await audit(client, scope, m.project_id, left.n === 0 ? "research.completed" : "research.milestone_done");
  });
}
