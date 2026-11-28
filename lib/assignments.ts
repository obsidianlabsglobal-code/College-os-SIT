import type { PoolClient } from "pg";
import { db, transaction } from "./db";
import { saveFile, type Upload } from "./files";
import type { Scope } from "./scope";

export class WorkflowError extends Error {}

const activeRoster = `EXISTS (
 SELECT 1 FROM roster r JOIN membership m
 ON m.institution_id=r.institution_id AND m.account_id=r.account_id AND m.role=r.role
 WHERE r.institution_id=a.institution_id AND r.offering_id=a.offering_id
 AND r.account_id=$2 AND r.role=$3 AND r.ended_at IS NULL AND m.ended_at IS NULL)`;

async function requireRoster(client: PoolClient, scope: Scope, offering: string, role: "student" | "faculty") {
  if (scope.role !== role) throw new WorkflowError("This action is unavailable.");
  const result = await client.query(
    `SELECT 1 FROM membership m JOIN roster r USING (institution_id,account_id,role)
     WHERE m.institution_id=$1 AND m.account_id=$2 AND m.role=$3 AND r.offering_id=$4
     AND m.ended_at IS NULL AND r.ended_at IS NULL FOR SHARE OF m,r`,
    [scope.institution, scope.account, role, offering],
  );
  if (!result.rowCount) throw new WorkflowError("This action is unavailable.");
}

export async function audit(client: PoolClient, scope: Scope, entity: string, action: string, revision?: number, subject?: string) {
  await client.query(
    "INSERT INTO audit_event (institution_id,actor_id,entity_id,action,revision,subject_id) VALUES ($1,$2,$3,$4,$5,$6)",
    [scope.institution, scope.account, entity, action, revision, subject],
  );
}

type Assignment = { id: string; offering_id: string; title: string; description: string; deadline: Date; max_marks: number; rubric: string | null; published_at: Date | null; accepting: boolean; course: string; section: string; timezone: string };

export async function assignments(scope: Scope, id?: string, offering?: string) {
  if (scope.role !== "student" && scope.role !== "faculty") return [];
  const { rows } = await db.query<Assignment>(
    `SELECT a.*,a.deadline >= clock_timestamp() AS accepting,c.name AS course,s.name AS section,i.timezone FROM assignment a
     JOIN offering o ON (o.institution_id,o.id)=(a.institution_id,a.offering_id)
     JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id)
     JOIN section s ON (s.institution_id,s.id)=(o.institution_id,o.section_id)
     JOIN institution i ON i.id=a.institution_id
     WHERE a.institution_id=$1 AND ${activeRoster} AND ($3='faculty' OR a.published_at IS NOT NULL)
     AND ($4::uuid IS NULL OR a.id=$4) AND ($5::uuid IS NULL OR a.offering_id=$5) ORDER BY a.deadline,a.id`,
    [scope.institution, scope.account, scope.role, id ?? null, offering ?? null],
  );
  return rows;
}

export async function pendingStudentAssignments(scope:Scope,limit:number) {
  if (scope.role!=="student") return [];
  if (!Number.isInteger(limit) || limit<1 || limit>100) throw new WorkflowError("Invalid result limit.");
  return (await db.query<{id:string;title:string;course:string;deadline:Date;timezone:string}>(`
    SELECT a.id,a.title,c.name AS course,a.deadline,i.timezone FROM assignment a
    JOIN institution i ON i.id=a.institution_id
    JOIN offering o ON (o.institution_id,o.id)=(a.institution_id,a.offering_id)
    JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id)
    WHERE a.institution_id=$1 AND ${activeRoster} AND a.published_at IS NOT NULL AND a.deadline>=now()
      AND NOT EXISTS (SELECT 1 FROM submission s WHERE
        (s.institution_id,s.assignment_id,s.student_id)=(a.institution_id,a.id,$2))
    ORDER BY a.deadline,a.id LIMIT $4`,[scope.institution,scope.account,scope.role,limit])).rows;
}

export async function studentAssignmentSummaries(scope: Scope) {
  if (scope.role !== "student") return [];
  const { rows } = await db.query<{
    id: string; title: string; course: string; section: string; deadline: Date; accepting: boolean;
    submitted: boolean; result_published_at: Date | null;
  }>(
    `SELECT a.id,a.title,c.name AS course,sec.name AS section,a.deadline,
       a.deadline >= clock_timestamp() AS accepting,s.id IS NOT NULL AS submitted,
       (SELECT max(g.published_at) FROM grade g
        WHERE (g.institution_id,g.submission_id)=(s.institution_id,s.id)) AS result_published_at
     FROM assignment a
     JOIN offering o ON (o.institution_id,o.id)=(a.institution_id,a.offering_id)
     JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id)
     JOIN section sec ON (sec.institution_id,sec.id)=(o.institution_id,o.section_id)
     LEFT JOIN submission s ON (s.institution_id,s.assignment_id,s.student_id)=(a.institution_id,a.id,$2)
     WHERE a.institution_id=$1 AND ${activeRoster} AND a.published_at IS NOT NULL
     ORDER BY a.deadline,a.id`, [scope.institution,scope.account,scope.role],
  );
  return rows;
}

export async function offerings(scope: Scope, id?: string) {
  if (scope.role !== "faculty" && scope.role !== "student") return [];
  return (await db.query<{ id: string; label: string; course: string; section: string; term: string; scheme: string; timezone: string }>(
    `SELECT a.id,c.name || ' · ' || s.name || ' · ' || t.name AS label,c.name AS course,s.name AS section,t.name AS term,sc.name AS scheme,i.timezone
     FROM (SELECT id AS offering_id,id,institution_id,course_id,section_id,term_id FROM offering) a
     JOIN course c ON (c.institution_id,c.id)=(a.institution_id,a.course_id)
     JOIN section s ON (s.institution_id,s.id)=(a.institution_id,a.section_id)
     JOIN academic_term t ON (t.institution_id,t.id)=(a.institution_id,a.term_id)
     JOIN academic_scheme sc ON (sc.institution_id,sc.id)=(t.institution_id,t.scheme_id)
     JOIN institution i ON i.id=a.institution_id
     WHERE a.institution_id=$1 AND ${activeRoster} AND ($4::uuid IS NULL OR a.id=$4) ORDER BY label,a.id`,
    [scope.institution, scope.account, scope.role,id ?? null],
  )).rows;
}

export function createAssignment(scope: Scope, input: { offering: string; title: string; description: string; deadline: string; marks: number; rubric?: string; file: Upload | null }) {
  return transaction(async client => {
    await requireRoster(client, scope, input.offering, "faculty");
    const { rows: [created] } = await client.query<{ id: string }>(
      `INSERT INTO assignment (institution_id,offering_id,title,description,deadline,max_marks,rubric)
       SELECT id,$2,$3,$4,$5::timestamp AT TIME ZONE timezone,$6,$7 FROM institution
       WHERE id=$1 AND $5::timestamp AT TIME ZONE timezone > clock_timestamp() RETURNING id`,
      [scope.institution, input.offering, input.title, input.description, input.deadline, input.marks, input.rubric],
    );
    if (!created) throw new WorkflowError("Choose a deadline in the future.");
    if (input.file) await saveFile(client, scope.institution, { assignment: created.id }, input.file);
    await audit(client, scope, created.id, "assignment.created");
    return created.id;
  });
}

async function lockAssignment(client: PoolClient, scope: Scope, id: string, role: "student" | "faculty", lock: "SHARE" | "UPDATE") {
  const { rows: [assignment] } = await client.query<Assignment>(
    `SELECT * FROM assignment WHERE institution_id=$1 AND id=$2 FOR ${lock}`, [scope.institution, id],
  );
  if (!assignment) throw new WorkflowError("This action is unavailable.");
  await requireRoster(client, scope, assignment.offering_id, role);
  return assignment;
}

export function publishAssignment(scope: Scope, id: string) {
  return transaction(async client => {
    const assignment = await lockAssignment(client, scope, id, "faculty", "UPDATE");
    if (assignment.published_at) return;
    const updated = await client.query(
      "UPDATE assignment SET published_at=clock_timestamp() WHERE institution_id=$1 AND id=$2 AND deadline > clock_timestamp()",
      [scope.institution, id],
    );
    if (!updated.rowCount) throw new WorkflowError("The deadline has passed.");
    await audit(client, scope, id, "assignment.published");
  });
}

export async function submitAssignment(scope: Scope, id: string, request: string, body: string, file: Upload | null) {
  if (!body && !file) throw new WorkflowError("Enter a response or attach a file.");
  return transaction(async client => {
    const assignment = await lockAssignment(client, scope, id, "student", "SHARE");
    if (!assignment.published_at) throw new WorkflowError("This action is unavailable.");
    const values = [scope.institution, id, scope.account, request, body || null];
    const result = await client.query<{ id: string }>(
      `WITH received AS (SELECT clock_timestamp() AS at)
       INSERT INTO submission (institution_id,assignment_id,student_id,request_id,body,submitted_at)
       SELECT $1,$2,$3,$4,$5,at FROM received WHERE at <= $6
       ON CONFLICT (institution_id,assignment_id,student_id) DO NOTHING RETURNING id`, [...values, assignment.deadline],
    );
    const created = result.rows[0];
    if (!created) {
      const { rows: [existing] } = await client.query<{ id: string; request_id: string }>(
        "SELECT id,request_id FROM submission WHERE institution_id=$1 AND assignment_id=$2 AND student_id=$3", values.slice(0, 3),
      );
      if (existing?.request_id === request) return existing.id;
      throw new WorkflowError(existing ? "You already submitted this assignment." : "The deadline has passed.");
    }
    if (file) await saveFile(client, scope.institution, { submission: created.id }, file);
    await audit(client, scope, created.id, "submission.received");
    return created.id;
  });
}

type Grade = { revision: number; marks: number; feedback: string; reason: string | null; published_at: Date | null };
type Submission = { id: string; name: string; body: string | null; submitted_at: Date; draft: Grade | null; published: Grade | null };

export async function submissionPreview(scope: Scope, assignment: string, limit: number) {
  if (scope.role !== "faculty") return [];
  return (await db.query<{ id: string; name: string; draft: boolean; published: boolean }>(
    `SELECT s.id,u.name,
      EXISTS (SELECT 1 FROM grade g WHERE (g.institution_id,g.submission_id)=(s.institution_id,s.id)
        AND g.published_at IS NULL AND g.superseded_at IS NULL) AS draft,
      EXISTS (SELECT 1 FROM grade g WHERE (g.institution_id,g.submission_id)=(s.institution_id,s.id)
        AND g.published_at IS NOT NULL) AS published
     FROM submission s JOIN "user" u ON u.id=s.student_id
     JOIN assignment a ON (a.institution_id,a.id)=(s.institution_id,s.assignment_id)
     WHERE a.institution_id=$1 AND a.id=$4 AND ${activeRoster}
     ORDER BY s.submitted_at,s.id LIMIT $5`,
    [scope.institution, scope.account, scope.role, assignment, limit],
  )).rows;
}

export async function submissions(scope: Scope, assignment: string, only?: string | readonly string[]) {
  if (scope.role !== "student" && scope.role !== "faculty") return [];
  return (await db.query<Submission>(
    `SELECT s.id,u.name,s.body,s.submitted_at,
       CASE WHEN $3='faculty' THEN (SELECT to_jsonb(g) FROM grade g WHERE
         (g.institution_id,g.submission_id)=(s.institution_id,s.id) AND g.published_at IS NULL AND g.superseded_at IS NULL) END AS draft,
       (SELECT to_jsonb(g) FROM grade g WHERE (g.institution_id,g.submission_id)=(s.institution_id,s.id)
         AND g.published_at IS NOT NULL ORDER BY g.revision DESC LIMIT 1) AS published
     FROM submission s JOIN "user" u ON u.id=s.student_id
     JOIN assignment a ON (a.institution_id,a.id)=(s.institution_id,s.assignment_id)
     WHERE a.institution_id=$1 AND a.id=$4 AND ${activeRoster}
       AND ($3='faculty' OR (s.student_id=$2 AND a.published_at IS NOT NULL))
       AND ($5::uuid[] IS NULL OR s.id=ANY($5))
     ORDER BY s.submitted_at,s.id`, [scope.institution, scope.account, scope.role, assignment, typeof only === "string" ? [only] : only ?? null],
  )).rows;
}

export type GradeInput = { assignment: string; submission: string; expected: number; expectedDraft: boolean; marks?: number; feedback?: string; reason?: string; publish: boolean };
export function updateGrade(scope: Scope, input: GradeInput) {
  return transaction(client => gradeIn(client, scope, input));
}

/** The grade write inside an open transaction, so rubric scores can join the same revision (lib/rubrics.ts). */
export async function gradeIn(client: PoolClient, scope: Scope, input: GradeInput) {
  {
    const assignment = await lockAssignment(client, scope, input.assignment, "faculty", "SHARE");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`grade:${scope.institution}:${input.submission}`]);
    const submission = await client.query(
      "SELECT id FROM submission WHERE institution_id=$1 AND id=$2 AND assignment_id=$3",
      [scope.institution, input.submission, input.assignment],
    );
    if (!submission.rowCount) throw new WorkflowError("This action is unavailable.");
    const key = [scope.institution, input.submission];
    const { rows: [latest] } = await client.query<Grade>(
      "SELECT * FROM grade WHERE institution_id=$1 AND submission_id=$2 ORDER BY revision DESC LIMIT 1", key,
    );
    const isDraft = Boolean(latest && !latest.published_at);
    if ((latest?.revision ?? 0) !== input.expected || isDraft !== input.expectedDraft) {
      if (input.publish && latest?.revision === input.expected && latest.published_at) return;
      throw new WorkflowError("This grade changed. Refresh and try again.");
    }
    if (input.publish) {
      if (!latest) throw new WorkflowError("Save a draft before publishing.");
      if (latest.published_at) return;
      await client.query(
        "UPDATE grade SET published_at=clock_timestamp() WHERE institution_id=$1 AND submission_id=$2 AND revision=$3",
        [...key, latest.revision],
      );
      await audit(client, scope, input.submission, "grade.published", latest.revision);
      return;
    }
    if (input.marks === undefined || input.marks < 0 || input.marks > assignment.max_marks || !input.feedback?.trim()) {
      throw new WorkflowError("Enter valid marks and feedback.");
    }
    const revision = input.expected + 1;
    if ((latest?.published_at || latest?.reason) && !input.reason?.trim()) {
      throw new WorkflowError("Enter a reason for this correction.");
    }
    if (latest && !latest.published_at) {
      await client.query("UPDATE grade SET superseded_at=clock_timestamp() WHERE institution_id=$1 AND submission_id=$2 AND revision=$3", [...key, latest.revision]);
    }
    await client.query(
      "INSERT INTO grade (institution_id,submission_id,revision,marks,feedback,reason) VALUES ($1,$2,$3,$4,$5,$6)",
      [...key, revision, input.marks, input.feedback, latest?.published_at || latest?.reason ? input.reason?.trim() : null],
    );
    await audit(client, scope, input.submission, latest?.published_at || latest?.reason ? "grade.correction_drafted" : "grade.drafted", revision);
    return revision;
  }
}

export async function files(scope: Scope, assignment: string, id?: string, submissionIds?: readonly string[]) {
  if (scope.role !== "student" && scope.role !== "faculty") return [];
  return (await db.query<{ id: string; submission_id: string | null; filename: string; mime: string; bytes: Buffer | null }>(
    `SELECT f.id,f.submission_id,f.filename,f.mime,CASE WHEN $5::uuid IS NOT NULL THEN f.bytes END AS bytes
     FROM attachment f LEFT JOIN submission s ON (s.institution_id,s.id)=(f.institution_id,f.submission_id)
     JOIN assignment a ON a.institution_id=f.institution_id AND a.id=COALESCE(f.assignment_id,s.assignment_id)
     WHERE a.institution_id=$1 AND a.id=$4 AND ${activeRoster}
     AND ($3='faculty' OR (a.published_at IS NOT NULL AND (s.id IS NULL OR s.student_id=$2)))
     AND ($5::uuid IS NULL OR f.id=$5)
     AND ($6::uuid[] IS NULL OR f.assignment_id=a.id OR f.submission_id=ANY($6))`,
    [scope.institution, scope.account, scope.role, assignment, id ?? null, submissionIds ?? null],
  )).rows;
}

export type AssessmentRecord = { id: string; title: string; course: string; term: string; scheme: string; deadline: Date; max_marks: number; submitted_at: Date | null;
  marks: number | null; published_at: Date | null; corrected: boolean };

/** SA-017: the student's chronological cross-course record. Only published results appear; drafts stay private to faculty. */
export async function assessmentHistory(scope: Scope) {
  if (scope.role !== "student") return [];
  return (await db.query<AssessmentRecord>(
    `SELECT a.id,a.title,c.name AS course,t.name AS term,sc.name AS scheme,a.deadline,a.max_marks,s.submitted_at,p.marks,p.published_at,coalesce(p.revision>1,false) AS corrected
     FROM assignment a
     JOIN offering o ON (o.institution_id,o.id)=(a.institution_id,a.offering_id)
     JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id)
     JOIN academic_term t ON (t.institution_id,t.id)=(o.institution_id,o.term_id)
     JOIN academic_scheme sc ON (sc.institution_id,sc.id)=(t.institution_id,t.scheme_id)
     LEFT JOIN submission s ON (s.institution_id,s.assignment_id,s.student_id)=(a.institution_id,a.id,$2)
     LEFT JOIN LATERAL (SELECT g.marks,g.published_at,g.revision FROM grade g WHERE (g.institution_id,g.submission_id)=(s.institution_id,s.id)
       AND g.published_at IS NOT NULL ORDER BY g.revision DESC LIMIT 1) p ON true
     WHERE a.institution_id=$1 AND ${activeRoster} AND a.published_at IS NOT NULL AND (s.id IS NOT NULL OR a.deadline < clock_timestamp())
     ORDER BY coalesce(s.submitted_at,a.deadline) DESC,a.id`, [scope.institution, scope.account, scope.role])).rows;
}
