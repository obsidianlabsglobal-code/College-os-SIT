import { z } from "zod";
import { audit, WorkflowError } from "./assignments";
import { db, transaction } from "./db";
import type { Scope } from "./scope";

// FC-016: one current faculty mentor per student, assigned by an administrator. The mentor records goals and
// follow-ups; the student reads them and marks goals agreed. Ending either membership hides the relationship.
const unavailable = () => new WorkflowError("This action is unavailable.");
const active = (alias: string, account: string, role: string) =>
  `EXISTS (SELECT 1 FROM membership x WHERE x.institution_id=${alias}.institution_id AND x.account_id=${account} AND x.role='${role}' AND x.ended_at IS NULL)`;

export type MentoringRecord = { id: string; kind: "goal" | "followup"; body: string; created_at: Date; agreed_at: Date | null };
export type Mentorship = { id: string; mentor: string; student: string; student_id: string; started_at: Date; records: MentoringRecord[] };

const select = `SELECT a.id,mu.name AS mentor,su.name AS student,a.student_id,a.started_at,
    coalesce((SELECT json_agg(json_build_object('id',r.id,'kind',r.kind,'body',r.body,'created_at',r.created_at,'agreed_at',r.agreed_at) ORDER BY r.created_at DESC)
      FROM mentoring_record r WHERE (r.institution_id,r.assignment_id)=(a.institution_id,a.id)),'[]') AS records
  FROM mentor_assignment a JOIN "user" mu ON mu.id=a.mentor_id JOIN "user" su ON su.id=a.student_id
  WHERE a.institution_id=$1 AND a.ended_at IS NULL AND ${active("a", "a.mentor_id", "faculty")} AND ${active("a", "a.student_id", "student")}`;
const parse = (rows: (Omit<Mentorship, "records"> & { records: (Omit<MentoringRecord, "created_at" | "agreed_at"> & { created_at: string; agreed_at: string | null })[] })[]) =>
  rows.map(row => ({ ...row, records: row.records.map(r => ({ ...r, created_at: new Date(r.created_at), agreed_at: r.agreed_at ? new Date(r.agreed_at) : null })) }));

/** Faculty: their current mentees. Student: their current mentor. Others: nothing. */
export async function mentorships(scope: Scope): Promise<Mentorship[]> {
  if (scope.role === "faculty") return parse((await db.query(`${select} AND a.mentor_id=$2 ORDER BY su.name`, [scope.institution, scope.account])).rows);
  if (scope.role === "student") return parse((await db.query(`${select} AND a.student_id=$2`, [scope.institution, scope.account])).rows);
  return [];
}

/** Admin: people who can be paired, and every current pairing. */
export async function mentorOptions(scope: Scope) {
  if (scope.role !== "admin") return null;
  const people = (role: string) => db.query<{ id: string; name: string }>(`SELECT DISTINCT u.id,u.name FROM membership m JOIN "user" u ON u.id=m.account_id
    WHERE m.institution_id=$1 AND m.role=$2 AND m.ended_at IS NULL ORDER BY u.name,u.id`, [scope.institution, role]);
  const [students, faculty, pairs] = await Promise.all([people("student"), people("faculty"),
    db.query<{ id: string; mentor: string; student: string }>(`SELECT a.id,mu.name AS mentor,su.name AS student FROM mentor_assignment a
      JOIN "user" mu ON mu.id=a.mentor_id JOIN "user" su ON su.id=a.student_id
      WHERE a.institution_id=$1 AND a.ended_at IS NULL AND ${active("a", "$2", "admin")} ORDER BY su.name`, [scope.institution, scope.account])]);
  return { students: students.rows, faculty: faculty.rows, pairs: pairs.rows };
}

const assignInput = z.object({ student: z.string().min(1).max(100), mentor: z.string().min(1).max(100) });
/** Admin assigns (or replaces) a student's mentor. The previous pairing ends; its records are kept. */
export function assignMentor(scope: Scope, raw: unknown) {
  const input = assignInput.parse(raw);
  if (scope.role !== "admin") throw unavailable();
  return transaction(async client => {
    const { rows } = await client.query<{ account_id: string; role: string }>(`SELECT account_id,role FROM membership
      WHERE institution_id=$1 AND ended_at IS NULL AND ((account_id=$2 AND role='admin') OR (account_id=$3 AND role='student') OR (account_id=$4 AND role='faculty'))
      FOR SHARE`, [scope.institution, scope.account, input.student, input.mentor]);
    const has = (role: string) => rows.some(row => row.role === role);
    if (!has("admin")) throw unavailable();
    if (!has("student") || !has("faculty")) throw new WorkflowError("Choose a current student and a current faculty member.");
    const { rows: [current] } = await client.query<{ id: string; mentor_id: string }>(
      "SELECT id,mentor_id FROM mentor_assignment WHERE institution_id=$1 AND student_id=$2 AND ended_at IS NULL FOR UPDATE", [scope.institution, input.student]);
    if (current?.mentor_id === input.mentor) throw new WorkflowError("This faculty member is already the student’s mentor.");
    if (current) {
      await client.query("UPDATE mentor_assignment SET ended_at=clock_timestamp() WHERE institution_id=$1 AND id=$2", [scope.institution, current.id]);
      await audit(client, scope, current.id, "mentor.ended");
    }
    const { rows: [created] } = await client.query<{ id: string }>(`INSERT INTO mentor_assignment (institution_id,mentor_id,student_id,assigned_by)
      VALUES ($1,$2,$3,$4) RETURNING id`, [scope.institution, input.mentor, input.student, scope.account]);
    await audit(client, scope, created.id, "mentor.assigned");
    return created.id;
  });
}

const recordInput = z.object({ assignment: z.uuid(), kind: z.enum(["goal", "followup"]), body: z.string().trim().min(1).max(1000) });
export function addMentoringRecord(scope: Scope, raw: unknown) {
  const input = recordInput.parse(raw);
  if (scope.role !== "faculty") throw unavailable();
  return transaction(async client => {
    const { rowCount } = await client.query(`SELECT 1 FROM mentor_assignment a WHERE a.institution_id=$1 AND a.id=$2 AND a.mentor_id=$3 AND a.ended_at IS NULL
      AND ${active("a", "a.mentor_id", "faculty")} AND ${active("a", "a.student_id", "student")} FOR SHARE`, [scope.institution, input.assignment, scope.account]);
    if (!rowCount) throw unavailable();
    const { rows: [row] } = await client.query<{ id: string }>(`INSERT INTO mentoring_record (institution_id,assignment_id,kind,body,created_by)
      VALUES ($1,$2,$3,$4,$5) RETURNING id`, [scope.institution, input.assignment, input.kind, input.body, scope.account]);
    await audit(client, scope, row.id, `mentoring.${input.kind}_recorded`);
    return row.id;
  });
}

export function agreeGoal(scope: Scope, record: unknown) {
  const id = z.uuid().parse(record);
  if (scope.role !== "student") throw unavailable();
  return transaction(async client => {
    const { rowCount } = await client.query(`UPDATE mentoring_record r SET agreed_at=clock_timestamp() FROM mentor_assignment a
      WHERE r.institution_id=$1 AND r.id=$2 AND r.kind='goal' AND r.agreed_at IS NULL
        AND (a.institution_id,a.id)=(r.institution_id,r.assignment_id) AND a.student_id=$3 AND a.ended_at IS NULL
        AND ${active("a", "a.student_id", "student")}`, [scope.institution, id, scope.account]);
    if (!rowCount) throw unavailable();
    await audit(client, scope, id, "mentoring.goal_agreed");
  });
}
