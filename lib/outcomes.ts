import type { PoolClient } from "pg";
import { z } from "zod";
import { audit, WorkflowError } from "./assignments";
import { db, transaction } from "./db";
import type { Scope } from "./scope";

// DH-012 / DH-013 / FC-014 / SA-019: outcome-based evidence.
// Attainment rule (stated on every screen that shows it): a student attains a course outcome when their published marks on the
// assessments tagged with it total at least 60% of the available marks. Level 3 when at least 70% of assessed students attain it,
// 2 at 60%, 1 at 50%, otherwise 0. A programme outcome's level is the mapping-weighted mean of its course outcome levels.
export const ATTAIN_PERCENT = 60;
const unavailable = () => new WorkflowError("This action is unavailable.");
const text = (max: number) => z.string().trim().min(1).max(max);

async function holds(client: PoolClient, scope: Scope, role: Scope["role"]) {
  return scope.role === role && !!(await client.query("SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role=$3 AND ended_at IS NULL FOR SHARE",
    [scope.institution, scope.account, role])).rowCount;
}
/** A current teacher of any offering of the course. */
const teachesCourse = (course: string) => `EXISTS (SELECT 1 FROM offering xo JOIN roster xr ON (xr.institution_id,xr.offering_id)=(xo.institution_id,xo.id)
  WHERE xo.institution_id=$1 AND xo.course_id=${course} AND xr.account_id=$2 AND xr.role='faculty' AND xr.ended_at IS NULL)`;
const headsCourse = (course: string) => `EXISTS (SELECT 1 FROM course hc JOIN membership hm ON hm.institution_id=hc.institution_id AND hm.department_id=hc.department_id
  WHERE hc.institution_id=$1 AND hc.id=${course} AND hm.account_id=$2 AND hm.role='hod' AND hm.ended_at IS NULL)`;

export function addProgrammeOutcome(scope: Scope, raw: unknown) {
  const input = z.object({ code: z.string().trim().regex(/^PS?O[0-9]{1,2}$/), statement: text(500) }).parse(raw);
  return transaction(async client => {
    if (!(await holds(client, scope, "admin"))) throw unavailable();
    try {
      const { rows: [row] } = await client.query<{ id: string }>("INSERT INTO programme_outcome (institution_id,code,statement,created_by) VALUES ($1,$2,$3,$4) RETURNING id",
        [scope.institution, input.code, input.statement, scope.account]);
      await audit(client, scope, row.id, "outcome.programme_added");
      return row.id;
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw new WorkflowError("That code already exists.");
      throw error;
    }
  });
}

const proposeInput = z.object({ course: z.uuid(), code: z.string().trim().regex(/^CO[0-9]{1,2}$/), statement: text(500),
  mapping: z.array(z.object({ outcome: z.uuid(), level: z.coerce.number().int().min(1).max(3) })).min(1).max(20) });
/** DH-012: a current teacher of the course proposes a course outcome with its programme outcome mapping. */
export function proposeCourseOutcome(scope: Scope, raw: unknown) {
  const input = proposeInput.parse(raw);
  if (new Set(input.mapping.map(m => m.outcome)).size !== input.mapping.length) throw new WorkflowError("Map each programme outcome once.");
  return transaction(async client => {
    if (!(await holds(client, scope, "faculty"))) throw unavailable();
    const { rows: [{ ok }] } = await client.query<{ ok: boolean }>(`SELECT ${teachesCourse("$3")} AS ok`, [scope.institution, scope.account, input.course]);
    if (!ok) throw new WorkflowError("You can propose outcomes only for a course you currently teach.");
    const { rowCount } = await client.query("SELECT 1 FROM programme_outcome WHERE institution_id=$1 AND id=ANY($2)", [scope.institution, input.mapping.map(m => m.outcome)]);
    if (rowCount !== input.mapping.length) throw new WorkflowError("Choose programme outcomes defined by the office.");
    try {
      const { rows: [row] } = await client.query<{ id: string }>("INSERT INTO course_outcome (institution_id,course_id,code,statement,proposed_by) VALUES ($1,$2,$3,$4,$5) RETURNING id",
        [scope.institution, input.course, input.code, input.statement, scope.account]);
      for (const m of input.mapping) await client.query("INSERT INTO outcome_mapping (institution_id,course_outcome_id,programme_outcome_id,level) VALUES ($1,$2,$3,$4)",
        [scope.institution, row.id, m.outcome, m.level]);
      await audit(client, scope, row.id, "outcome.course_proposed");
      return row.id;
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw new WorkflowError("This course already has an outcome with that code.");
      throw error;
    }
  });
}

/** DH-013: the head of the course's department approves or returns a proposal with a reason. */
export function decideCourseOutcome(scope: Scope, raw: unknown) {
  const input = z.object({ outcome: z.uuid(), decision: z.enum(["approved", "returned"]), reason: text(500) }).parse(raw);
  return transaction(async client => {
    if (!(await holds(client, scope, "hod"))) throw unavailable();
    const { rows: [o] } = await client.query<{ state: string; heads: boolean }>(`SELECT k.state,${headsCourse("k.course_id")} AS heads FROM course_outcome k
      WHERE k.institution_id=$1 AND k.id=$3 FOR UPDATE`, [scope.institution, scope.account, input.outcome]);
    if (!o || !o.heads) throw unavailable();
    if (o.state !== "proposed") throw new WorkflowError("This outcome is already decided.");
    await client.query("UPDATE course_outcome SET state=$3,decided_by=$4,reason=$5 WHERE institution_id=$1 AND id=$2",
      [scope.institution, input.outcome, input.decision, scope.account, input.reason]);
    await audit(client, scope, input.outcome, `outcome.course_${input.decision}`);
  });
}

/** FC-014: a current teacher of the assessment's offering tags it with approved outcomes of that course (or clears one). */
export function tagAssessment(scope: Scope, raw: unknown) {
  const input = z.object({ assignment: z.uuid(), outcome: z.uuid(), tagged: z.boolean() }).parse(raw);
  return transaction(async client => {
    if (!(await holds(client, scope, "faculty"))) throw unavailable();
    const { rowCount } = await client.query(`SELECT 1 FROM assignment a JOIN offering o ON (o.institution_id,o.id)=(a.institution_id,a.offering_id)
      JOIN roster r ON (r.institution_id,r.offering_id)=(o.institution_id,o.id) AND r.account_id=$2 AND r.role='faculty' AND r.ended_at IS NULL
      JOIN course_outcome k ON k.institution_id=o.institution_id AND k.course_id=o.course_id AND k.id=$4 AND k.state='approved'
      WHERE a.institution_id=$1 AND a.id=$3`, [scope.institution, scope.account, input.assignment, input.outcome]);
    if (!rowCount) throw new WorkflowError("Choose an approved outcome of this course for an assessment you teach.");
    if (input.tagged) await client.query("INSERT INTO assessment_outcome (institution_id,assignment_id,course_outcome_id,tagged_by) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING",
      [scope.institution, input.assignment, input.outcome, scope.account]);
    else await client.query("DELETE FROM assessment_outcome WHERE institution_id=$1 AND assignment_id=$2 AND course_outcome_id=$3", [scope.institution, input.assignment, input.outcome]);
    await audit(client, scope, input.assignment, input.tagged ? "outcome.assessment_tagged" : "outcome.assessment_untagged");
  });
}

export type CourseOutcome = { id: string; course_id: string; course: string; code: string; statement: string; state: string; reason: string | null;
  proposer: string; mapping: { code: string; level: number }[]; can_decide: boolean };
/** Outcomes of courses the reader teaches (faculty), heads (HOD), or all (admin, principal). */
export async function courseOutcomes(scope: Scope) {
  return (await db.query<CourseOutcome>(`SELECT k.id,k.course_id,c.name AS course,k.code,k.statement,k.state,k.reason,pu.name AS proposer,
      coalesce((SELECT json_agg(json_build_object('code',p.code,'level',m.level) ORDER BY p.code) FROM outcome_mapping m
        JOIN programme_outcome p ON (p.institution_id,p.id)=(m.institution_id,m.programme_outcome_id) WHERE (m.institution_id,m.course_outcome_id)=(k.institution_id,k.id)),'[]') AS mapping,
      ($3='hod' AND ${headsCourse("k.course_id")}) AS can_decide
    FROM course_outcome k JOIN course c ON (c.institution_id,c.id)=(k.institution_id,k.course_id) JOIN "user" pu ON pu.id=k.proposed_by
    WHERE k.institution_id=$1 AND EXISTS (SELECT 1 FROM membership me WHERE me.institution_id=$1 AND me.account_id=$2 AND me.role=$3 AND me.ended_at IS NULL)
      AND ($3 IN ('admin','principal') OR ($3='faculty' AND ${teachesCourse("k.course_id")}) OR ($3='hod' AND ${headsCourse("k.course_id")}))
    ORDER BY c.name,k.code,k.state`, [scope.institution, scope.account, scope.role])).rows;
}

export async function programmeOutcomes(scope: Scope) {
  return (await db.query<{ id: string; code: string; statement: string }>(`SELECT p.id,p.code,p.statement FROM programme_outcome p WHERE p.institution_id=$1
    AND EXISTS (SELECT 1 FROM membership me WHERE me.institution_id=$1 AND me.account_id=$2 AND me.role=$3 AND me.ended_at IS NULL) ORDER BY p.code`,
  [scope.institution, scope.account, scope.role])).rows;
}

// Per student and approved outcome in an offering: published marks over available marks on tagged assessments.
const evidence = (offering: string) => `SELECT o.id AS offering_id,k.id AS outcome_id,k.code,k.statement,s.student_id,
    sum(g.marks)::float8 AS marks,sum(a.max_marks)::float8 AS available
  FROM offering o JOIN course_outcome k ON k.institution_id=o.institution_id AND k.course_id=o.course_id AND k.state='approved'
  JOIN assessment_outcome t ON (t.institution_id,t.course_outcome_id)=(k.institution_id,k.id)
  JOIN assignment a ON (a.institution_id,a.id)=(t.institution_id,t.assignment_id) AND a.offering_id=o.id
  JOIN submission s ON (s.institution_id,s.assignment_id)=(a.institution_id,a.id)
  JOIN LATERAL (SELECT g.marks FROM grade g WHERE (g.institution_id,g.submission_id)=(s.institution_id,s.id) AND g.published_at IS NOT NULL ORDER BY g.revision DESC LIMIT 1) g ON true
  WHERE o.institution_id=$1 AND o.id=${offering}
  GROUP BY o.id,k.id,k.code,k.statement,s.student_id`;

export type Attainment = { outcome_id: string; code: string; statement: string; assessed: number; attained: number; percent: number; level: number };
/** FC-014 / DH-013: per approved outcome of an offering — for its current teachers, the course's HOD, and the principal. */
export async function offeringAttainment(scope: Scope, offering: string) {
  const id = z.uuid().parse(offering);
  const { rows: [{ ok }] } = await db.query<{ ok: boolean }>(`SELECT EXISTS (SELECT 1 FROM offering o
      JOIN membership me ON me.institution_id=o.institution_id AND me.account_id=$2 AND me.role=$3 AND me.ended_at IS NULL
      WHERE o.institution_id=$1 AND o.id=$4 AND ($3='principal'
        OR ($3='faculty' AND EXISTS (SELECT 1 FROM roster r WHERE (r.institution_id,r.offering_id)=(o.institution_id,o.id) AND r.account_id=$2 AND r.role='faculty' AND r.ended_at IS NULL))
        OR ($3='hod' AND ${headsCourse("o.course_id")}))) AS ok`, [scope.institution, scope.account, scope.role, id]);
  if (!ok) return null;
  return (await db.query<Attainment>(`WITH e AS (${evidence("$2")})
    SELECT outcome_id,code,statement,count(*)::int AS assessed,count(*) FILTER (WHERE marks >= available*${ATTAIN_PERCENT}/100.0)::int AS attained,
      round(100.0*count(*) FILTER (WHERE marks >= available*${ATTAIN_PERCENT}/100.0)/count(*))::int AS percent,
      CASE WHEN 100.0*count(*) FILTER (WHERE marks >= available*${ATTAIN_PERCENT}/100.0)/count(*) >= 70 THEN 3
           WHEN 100.0*count(*) FILTER (WHERE marks >= available*${ATTAIN_PERCENT}/100.0)/count(*) >= 60 THEN 2
           WHEN 100.0*count(*) FILTER (WHERE marks >= available*${ATTAIN_PERCENT}/100.0)/count(*) >= 50 THEN 1 ELSE 0 END AS level
    FROM e GROUP BY outcome_id,code,statement ORDER BY code`, [scope.institution, id])).rows;
}

/** DH-013: programme outcome levels for an offering, weighted by mapping level. */
export async function programmeAttainment(scope: Scope, offering: string) {
  const rows = await offeringAttainment(scope, offering);
  if (!rows) return null;
  if (!rows.length) return [];
  const { rows: maps } = await db.query<{ course_outcome_id: string; code: string; level: number }>(`SELECT m.course_outcome_id,p.code,m.level FROM outcome_mapping m
    JOIN programme_outcome p ON (p.institution_id,p.id)=(m.institution_id,m.programme_outcome_id) WHERE m.institution_id=$1 AND m.course_outcome_id=ANY($2)`,
  [scope.institution, rows.map(r => r.outcome_id)]);
  const totals = new Map<string, { weighted: number; weight: number }>();
  for (const m of maps) {
    const t = totals.get(m.code) ?? { weighted: 0, weight: 0 };
    t.weighted += m.level * rows.find(r => r.outcome_id === m.course_outcome_id)!.level;
    t.weight += m.level;
    totals.set(m.code, t);
  }
  return [...totals].map(([code, t]) => ({ code, level: Math.round((t.weighted / t.weight) * 100) / 100 })).sort((a, b) => a.code.localeCompare(b.code));
}

/** SA-019: a student's own evidence per outcome, across their current offerings. */
export async function myOutcomeEvidence(scope: Scope) {
  if (scope.role !== "student") return [];
  return (await db.query<{ course: string; code: string; statement: string; percent: number; attained: boolean }>(`SELECT c.name AS course,e.code,e.statement,
      round(100*e.marks/e.available)::int AS percent,(e.marks >= e.available*${ATTAIN_PERCENT}/100.0) AS attained
    FROM roster r JOIN offering o ON (o.institution_id,o.id)=(r.institution_id,r.offering_id) JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id)
    CROSS JOIN LATERAL (${evidence("r.offering_id")}) e
    WHERE r.institution_id=$1 AND r.account_id=$2 AND r.role='student' AND r.ended_at IS NULL AND e.student_id=$2
      AND EXISTS (SELECT 1 FROM membership m WHERE m.institution_id=$1 AND m.account_id=$2 AND m.role='student' AND m.ended_at IS NULL)
    ORDER BY c.name,e.code`, [scope.institution, scope.account])).rows;
}

/** Offerings the reader can see attainment for, and assessments a teacher can tag. */
export async function outcomeChoices(scope: Scope) {
  const offerings = (await db.query<{ id: string; label: string; course_id: string }>(`SELECT o.id,c.name||' · '||s.name AS label,o.course_id FROM offering o
    JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id) JOIN section s ON (s.institution_id,s.id)=(o.institution_id,o.section_id)
    WHERE o.institution_id=$1 AND EXISTS (SELECT 1 FROM membership me WHERE me.institution_id=$1 AND me.account_id=$2 AND me.role=$3 AND me.ended_at IS NULL)
      AND ($3='principal' OR ($3='faculty' AND EXISTS (SELECT 1 FROM roster r WHERE (r.institution_id,r.offering_id)=(o.institution_id,o.id) AND r.account_id=$2 AND r.role='faculty' AND r.ended_at IS NULL))
        OR ($3='hod' AND ${headsCourse("o.course_id")}))
    ORDER BY 2`, [scope.institution, scope.account, scope.role])).rows;
  const assessments = scope.role !== "faculty" ? [] : (await db.query<{ id: string; title: string; offering_id: string; course_id: string; tags: string[] }>(`SELECT a.id,a.title,a.offering_id,o.course_id,
      coalesce((SELECT array_agg(t.course_outcome_id::text) FROM assessment_outcome t WHERE (t.institution_id,t.assignment_id)=(a.institution_id,a.id)),'{}') AS tags
    FROM assignment a JOIN offering o ON (o.institution_id,o.id)=(a.institution_id,a.offering_id)
    JOIN roster r ON (r.institution_id,r.offering_id)=(o.institution_id,o.id) AND r.account_id=$2 AND r.role='faculty' AND r.ended_at IS NULL
    WHERE a.institution_id=$1 ORDER BY a.deadline DESC LIMIT 60`, [scope.institution, scope.account])).rows;
  return { offerings, assessments };
}
