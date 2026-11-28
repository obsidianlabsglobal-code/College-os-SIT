import { z } from "zod";
import { audit, gradeIn, WorkflowError } from "./assignments";
import { db, transaction } from "./db";
import type { Scope } from "./scope";

// FC-010: a teacher of the offering sets rubric criteria whose points add up to the assignment's maximum marks, before any
// grade exists. Scoring a submission by criterion saves an ordinary grade draft whose marks are the criterion total, with
// the scores tied to that revision; publication, corrections and the student's view follow the existing grade flow.
const unavailable = () => new WorkflowError("This action is unavailable.");

/** A current teacher of the assignment's offering, or a current student of it once the assignment is published. */
const reads = `EXISTS (SELECT 1 FROM assignment a JOIN roster r ON (r.institution_id,r.offering_id)=(a.institution_id,a.offering_id)
    AND r.account_id=$2 AND r.role=$3 AND r.ended_at IS NULL
  JOIN membership m ON m.institution_id=r.institution_id AND m.account_id=r.account_id AND m.role=$3 AND m.ended_at IS NULL
  WHERE a.institution_id=$1 AND a.id=$4 AND ($3='faculty' OR a.published_at IS NOT NULL))`;

export type Criterion = { id: string; position: number; name: string; points: number; descriptor: string };
export async function rubric(scope: Scope, assignment: string) {
  if (scope.role !== "faculty" && scope.role !== "student") return [];
  return (await db.query<Criterion>(`SELECT c.id,c.position,c.name,c.points,c.descriptor FROM rubric_criterion c
    WHERE c.institution_id=$1 AND c.assignment_id=$4 AND ${reads} ORDER BY c.position`, [scope.institution, scope.account, scope.role, assignment])).rows;
}

const criteriaInput = z.object({ assignment: z.uuid(), criteria: z.array(z.object({ name: z.string().trim().min(1).max(120), points: z.number().int().min(1).max(1000),
  descriptor: z.string().trim().max(500).default("") })).max(20) });
/** Replace the criteria (an empty list removes the rubric). Only before any grade exists, and the points must add up. */
export function setRubric(scope: Scope, raw: unknown) {
  const input = criteriaInput.parse(raw);
  if (scope.role !== "faculty") throw unavailable();
  return transaction(async client => {
    const { rows: [a] } = await client.query<{ max_marks: number; graded: boolean }>(`SELECT a.max_marks,
        EXISTS (SELECT 1 FROM grade g JOIN submission s ON (s.institution_id,s.id)=(g.institution_id,g.submission_id) WHERE s.institution_id=a.institution_id AND s.assignment_id=a.id) AS graded
      FROM assignment a WHERE a.institution_id=$1 AND a.id=$4 AND ${reads} FOR UPDATE OF a`, [scope.institution, scope.account, scope.role, input.assignment]);
    if (!a) throw unavailable();
    if (a.graded) throw new WorkflowError("The rubric cannot change once marking has started.");
    const total = input.criteria.reduce((sum, c) => sum + c.points, 0);
    if (input.criteria.length && total !== a.max_marks) throw new WorkflowError(`The criteria add up to ${total}; they must add up to the maximum of ${a.max_marks}.`);
    await client.query("DELETE FROM rubric_criterion WHERE institution_id=$1 AND assignment_id=$2", [scope.institution, input.assignment]);
    for (const [index, c] of input.criteria.entries()) await client.query(`INSERT INTO rubric_criterion (institution_id,assignment_id,position,name,points,descriptor)
      VALUES ($1,$2,$3,$4,$5,$6)`, [scope.institution, input.assignment, index + 1, c.name, c.points, c.descriptor]);
    await audit(client, scope, input.assignment, input.criteria.length ? "rubric.set" : "rubric.removed");
  });
}

/** Parses "Criterion | points | what earns full points" lines from the teacher's form. */
export function parseCriteria(text: string) {
  return text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(line => {
    const [name = "", points = "", ...rest] = line.split("|").map(p => p.trim());
    return { name, points: Number(points), descriptor: rest.join(" | ") };
  });
}

const scoreInput = z.object({ assignment: z.uuid(), submission: z.uuid(), expected: z.number().int().min(0), expectedDraft: z.boolean(),
  scores: z.array(z.object({ criterion: z.uuid(), points: z.number().int().min(0), comment: z.string().trim().max(1000).default("") })).min(1).max(20),
  feedback: z.string().trim().min(1).max(8000), reason: z.string().trim().max(1000).optional() });
/** Saves a grade draft whose marks are the criterion total, with each criterion's score on the same revision. */
export function scoreByRubric(scope: Scope, raw: unknown) {
  const input = scoreInput.parse(raw);
  if (scope.role !== "faculty") throw unavailable();
  return transaction(async client => {
    const { rows: criteria } = await client.query<{ id: string; points: number; name: string }>(
      "SELECT id,points,name FROM rubric_criterion WHERE institution_id=$1 AND assignment_id=$2", [scope.institution, input.assignment]);
    if (!criteria.length) throw new WorkflowError("This assignment has no rubric.");
    const given = new Map(input.scores.map(s => [s.criterion, s]));
    if (given.size !== input.scores.length || criteria.some(c => !given.has(c.id)) || given.size !== criteria.length) throw new WorkflowError("Score every criterion once.");
    for (const c of criteria) if (given.get(c.id)!.points > c.points) throw new WorkflowError(`${c.name} is out of ${c.points}.`);
    const marks = input.scores.reduce((sum, s) => sum + s.points, 0);
    const revision = await gradeIn(client, scope, { assignment: input.assignment, submission: input.submission, expected: input.expected,
      expectedDraft: input.expectedDraft, marks, feedback: input.feedback, reason: input.reason, publish: false });
    if (!revision) throw new WorkflowError("This grade changed. Refresh and try again.");
    for (const s of input.scores) await client.query(`INSERT INTO criterion_score (institution_id,submission_id,revision,criterion_id,points,comment)
      VALUES ($1,$2,$3,$4,$5,$6)`, [scope.institution, input.submission, revision, s.criterion, s.points, s.comment]);
    return marks;
  });
}

export type CriterionScore = { criterion_id: string; name: string; max: number; points: number; comment: string };
/** Scores on the latest revision for the teacher; for the student, only on the latest published revision of their own work. */
export async function rubricScores(scope: Scope, submission: string) {
  if (scope.role !== "faculty" && scope.role !== "student") return [];
  return (await db.query<CriterionScore>(`SELECT c.id AS criterion_id,c.name,c.points AS max,cs.points,cs.comment
    FROM submission s
    JOIN LATERAL (SELECT g.revision FROM grade g WHERE (g.institution_id,g.submission_id)=(s.institution_id,s.id)
      AND ($3='faculty' OR g.published_at IS NOT NULL) ORDER BY g.revision DESC LIMIT 1) g ON true
    JOIN criterion_score cs ON (cs.institution_id,cs.submission_id,cs.revision)=(s.institution_id,s.id,g.revision)
    JOIN rubric_criterion c ON (c.institution_id,c.id)=(cs.institution_id,cs.criterion_id)
    WHERE s.institution_id=$1 AND s.id=$4 AND ($3='faculty' OR s.student_id=$2)
      AND EXISTS (SELECT 1 FROM roster r JOIN membership m ON m.institution_id=r.institution_id AND m.account_id=r.account_id AND m.role=$3 AND m.ended_at IS NULL
        JOIN assignment a ON (a.institution_id,a.offering_id)=(r.institution_id,r.offering_id) AND a.id=s.assignment_id
        WHERE r.institution_id=$1 AND r.account_id=$2 AND r.role=$3 AND r.ended_at IS NULL)
    ORDER BY c.position`, [scope.institution, scope.account, scope.role, submission])).rows;
}
