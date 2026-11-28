import { z } from "zod";
import { audit, WorkflowError } from "./assignments";
import { db, transaction } from "./db";
import type { Scope } from "./scope";

// SA-021: attendance correction requests. A student may challenge only their own latest "absent" mark on a recorded class;
// only the class's current teacher decides, with a reason. Acceptance writes a new attendance revision atomically.
const reason = z.string().trim().min(1, "Enter a reason.").max(500);
const requestInput = z.object({ session: z.uuid(), reason });
const decisionInput = z.object({ correction: z.uuid(), decision: z.enum(["accept", "decline"]), reason });
const unavailable = () => new WorkflowError("This correction is unavailable or has already been decided.");

const member = `SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role=$3 AND ended_at IS NULL FOR SHARE`;

export async function requestCorrection(scope: Scope, raw: unknown) {
  const input = requestInput.parse(raw);
  if (scope.role !== "student") throw unavailable();
  try {
    return await transaction(async client => {
      if (!(await client.query(member, [scope.institution, scope.account, scope.role])).rowCount) throw unavailable();
      const { rows: [mark] } = await client.query<{ revision: number }>(
        `SELECT m.revision FROM class_session s
         JOIN roster r ON (r.institution_id,r.offering_id)=(s.institution_id,s.offering_id) AND r.account_id=$2 AND r.role='student' AND r.ended_at IS NULL
         JOIN class_attendance_mark m ON (m.institution_id,m.session_id)=(s.institution_id,s.id) AND m.student_id=$2
         WHERE s.institution_id=$1 AND s.id=$3 AND s.state='conducted' AND m.status='absent'
           AND m.revision=(SELECT max(revision) FROM class_attendance_revision v WHERE (v.institution_id,v.session_id)=(s.institution_id,s.id))
         FOR SHARE OF s`, [scope.institution, scope.account, input.session]);
      if (!mark) throw new WorkflowError("You can request a correction only for a recorded class where you are marked absent.");
      const { rows: [saved] } = await client.query<{ id: string }>(
        `INSERT INTO attendance_correction (institution_id,session_id,student_id,challenged_revision,reason)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`, [scope.institution, input.session, scope.account, mark.revision, input.reason]);
      await audit(client, scope, saved.id, "attendance_correction.requested", mark.revision);
      return saved.id;
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new WorkflowError("You already have an open correction request for this class.");
    throw error;
  }
}

export async function decideCorrection(scope: Scope, raw: unknown) {
  const input = decisionInput.parse(raw);
  if (scope.role !== "faculty") throw unavailable();
  return transaction(async client => {
    if (!(await client.query(member, [scope.institution, scope.account, scope.role])).rowCount) throw unavailable();
    const { rows: [row] } = await client.query<{ session_id: string; student_id: string }>(
      `SELECT k.session_id,k.student_id FROM attendance_correction k
       JOIN class_session s ON (s.institution_id,s.id)=(k.institution_id,k.session_id)
       JOIN roster f ON (f.institution_id,f.offering_id)=(s.institution_id,s.offering_id) AND f.account_id=$2 AND f.role='faculty' AND f.ended_at IS NULL
       WHERE k.institution_id=$1 AND k.id=$3 AND k.status='submitted' AND s.faculty_id=$2
       FOR UPDATE OF k,s`, [scope.institution, scope.account, input.correction]);
    if (!row) throw unavailable();
    let revision: number | undefined;
    if (input.decision === "accept") {
      const { rows: [saved] } = await client.query<{ revision: number }>(
        `INSERT INTO class_attendance_revision (institution_id,session_id,revision,actor_id,reason)
         SELECT $1,$2,max(revision)+1,$3,$4 FROM class_attendance_revision WHERE institution_id=$1 AND session_id=$2 RETURNING revision`,
        [scope.institution, row.session_id, scope.account, `Correction request accepted: ${input.reason}`]);
      revision = saved.revision;
      const copied = await client.query(
        `INSERT INTO class_attendance_mark (institution_id,session_id,revision,student_id,status)
         SELECT institution_id,session_id,$3,student_id,CASE WHEN student_id=$4 THEN 'present' ELSE status END
         FROM class_attendance_mark WHERE institution_id=$1 AND session_id=$2 AND revision=$3-1`,
        [scope.institution, row.session_id, revision, row.student_id]);
      if (!copied.rowCount) throw unavailable();
      await client.query("UPDATE class_session SET revision=revision+1 WHERE institution_id=$1 AND id=$2", [scope.institution, row.session_id]);
      await audit(client, scope, row.session_id, "attendance.corrected", revision);
    }
    await client.query(
      `UPDATE attendance_correction SET status=$3,decided_by=$4,decided_at=clock_timestamp(),decision_reason=$5
       WHERE institution_id=$1 AND id=$2`,
      [scope.institution, input.correction, input.decision === "accept" ? "accepted" : "declined", scope.account, input.reason]);
    await audit(client, scope, input.correction, "attendance_correction.decided", revision);
    return input.correction;
  });
}

export type Correction = { id: string; session_id: string; course: string; section: string; start: Date; student: string;
  reason: string; status: "submitted" | "accepted" | "declined"; decision_reason: string | null; decided_at: Date | null; created_at: Date };

const correctionSelect = `SELECT k.id,k.session_id,c.name AS course,sec.name AS section,lower(s.slot) AS start,u.name AS student,
    k.reason,k.status,k.decision_reason,k.decided_at,k.created_at
  FROM attendance_correction k
  JOIN class_session s ON (s.institution_id,s.id)=(k.institution_id,k.session_id)
  JOIN offering o ON (o.institution_id,o.id)=(s.institution_id,s.offering_id)
  JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id)
  JOIN section sec ON (sec.institution_id,sec.id)=(s.institution_id,s.section_id)
  JOIN "user" u ON u.id=k.student_id
  JOIN membership m ON m.institution_id=k.institution_id AND m.account_id=$2 AND m.role=$3 AND m.ended_at IS NULL`;

/** Student: own requests while still enrolled. Faculty: open requests for classes they currently teach. */
export async function corrections(scope: Scope) {
  if (scope.role === "student") return (await db.query<Correction>(`${correctionSelect}
    JOIN roster r ON (r.institution_id,r.offering_id)=(s.institution_id,s.offering_id) AND r.account_id=$2 AND r.role='student' AND r.ended_at IS NULL
    WHERE k.institution_id=$1 AND k.student_id=$2 ORDER BY k.created_at DESC LIMIT 50`, [scope.institution, scope.account, scope.role])).rows;
  if (scope.role === "faculty") return (await db.query<Correction>(`${correctionSelect}
    JOIN roster r ON (r.institution_id,r.offering_id)=(s.institution_id,s.offering_id) AND r.account_id=$2 AND r.role='faculty' AND r.ended_at IS NULL
    WHERE k.institution_id=$1 AND s.faculty_id=$2 AND k.status='submitted' ORDER BY k.created_at LIMIT 50`, [scope.institution, scope.account, scope.role])).rows;
  return [];
}
