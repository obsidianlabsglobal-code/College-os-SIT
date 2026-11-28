import { z } from "zod";
import { audit, WorkflowError } from "./assignments";
import { db, transaction } from "./db";
import type { Scope } from "./scope";

// AD-005: student records. The office finds a current or former student here and corrects USN, semester or phone with a
// reason; each change keeps its old and new value. A student reads their own record. Names come from the sign-in account,
// which is shared across colleges, so name changes go through the person's own account, not this page.
export type StudentRecord = { account_id: string; name: string; email: string; usn: string | null; semester: number | null; phone: string | null;
  sections: string[]; current: boolean; consented: boolean };

const record = (where: string) => `SELECT u.id AS account_id,u.name,u.email,p.usn,p.semester,p.phone,
    coalesce((SELECT array_agg(DISTINCT s.name ORDER BY s.name) FROM roster r JOIN offering o ON (o.institution_id,o.id)=(r.institution_id,r.offering_id)
      JOIN section s ON (s.institution_id,s.id)=(o.institution_id,o.section_id) WHERE r.institution_id=$1 AND r.account_id=u.id AND r.role='student' AND r.ended_at IS NULL),'{}') AS sections,
    EXISTS (SELECT 1 FROM membership m WHERE m.institution_id=$1 AND m.account_id=u.id AND m.role='student' AND m.ended_at IS NULL) AS current,
    EXISTS (SELECT 1 FROM consent_record c WHERE c.institution_id=$1 AND c.account_id=u.id) AS consented
  FROM "user" u LEFT JOIN person_detail p ON p.institution_id=$1 AND p.account_id=u.id
  WHERE EXISTS (SELECT 1 FROM membership sm WHERE sm.institution_id=$1 AND sm.account_id=u.id AND sm.role='student') AND ${where}`;
const office = `EXISTS (SELECT 1 FROM membership a WHERE a.institution_id=$1 AND a.account_id=$2 AND a.role='admin' AND a.ended_at IS NULL)`;

/** The office searches by name, email or USN (at least 2 characters). */
export async function findStudents(scope: Scope, raw: unknown) {
  const q = z.string().trim().min(2).max(80).parse(raw).toLowerCase();
  if (scope.role !== "admin") return [];
  return (await db.query<StudentRecord>(`${record(`${office} AND (lower(u.name) LIKE $3 OR lower(u.email) LIKE $3 OR lower(coalesce(p.usn,'')) LIKE $3)`)}
    ORDER BY u.name LIMIT 50`, [scope.institution, scope.account, `%${q.replace(/[%_\\]/g, "")}%`])).rows;
}

/** The office reads any student's record here; a student reads only their own. */
export async function studentRecord(scope: Scope, account: string) {
  const own = scope.role === "student" && account === scope.account;
  if (!own && scope.role !== "admin") return null;
  const access = own ? `u.id=$2 AND EXISTS (SELECT 1 FROM membership me WHERE me.institution_id=$1 AND me.account_id=$2 AND me.role='student' AND me.ended_at IS NULL)` : office;
  const { rows: [row] } = await db.query<StudentRecord>(`${record(`u.id=$3 AND ${access}`)}`, [scope.institution, scope.account, account]);
  if (!row) return null;
  const { rows: history } = await db.query<{ field: string; old_value: string | null; new_value: string | null; reason: string; changed_at: Date; by: string }>(
    `SELECT c.field,c.old_value,c.new_value,c.reason,c.changed_at,u.name AS by FROM person_detail_change c JOIN "user" u ON u.id=c.changed_by
     WHERE c.institution_id=$1 AND c.account_id=$2 ORDER BY c.changed_at DESC LIMIT 50`, [scope.institution, account]);
  return { ...row, history };
}

const fields = { usn: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6,16}$/), semester: z.coerce.number().int().min(1).max(10),
  phone: z.string().trim().regex(/^\+?[0-9 ]{7,16}$/) };
const correction = z.object({ account: z.string().min(1).max(100), field: z.enum(["usn", "semester", "phone"]), value: z.string().trim().max(20), reason: z.string().trim().min(1).max(300) });

export function correctRecord(scope: Scope, raw: unknown) {
  const input = correction.parse(raw);
  const value = fields[input.field].parse(input.value);
  return transaction(async client => {
    const { rowCount } = await client.query("SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role='admin' AND ended_at IS NULL FOR SHARE",
      [scope.institution, scope.account]);
    if (scope.role !== "admin" || !rowCount) throw new WorkflowError("This action is unavailable.");
    const { rows: [student] } = await client.query<{ old: string | null }>(`SELECT (SELECT p.${input.field}::text FROM person_detail p WHERE p.institution_id=$1 AND p.account_id=$2) AS old
      WHERE EXISTS (SELECT 1 FROM membership m WHERE m.institution_id=$1 AND m.account_id=$2 AND m.role='student')`, [scope.institution, input.account]);
    if (!student) throw new WorkflowError("This student is unavailable.");
    if (student.old === String(value)) throw new WorkflowError("That is already the recorded value.");
    if (input.field === "usn") {
      const { rowCount: taken } = await client.query("SELECT 1 FROM person_detail WHERE institution_id=$1 AND usn=$2 AND account_id<>$3", [scope.institution, value, input.account]);
      if (taken) throw new WorkflowError("This USN already belongs to another student.");
    }
    await client.query(`INSERT INTO person_detail (institution_id,account_id,${input.field}) VALUES ($1,$2,$3)
      ON CONFLICT (institution_id,account_id) DO UPDATE SET ${input.field}=EXCLUDED.${input.field},updated_at=clock_timestamp()`, [scope.institution, input.account, value]);
    const { rows: [change] } = await client.query<{ id: string }>(`INSERT INTO person_detail_change (institution_id,account_id,field,old_value,new_value,reason,changed_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [scope.institution, input.account, input.field, student.old, String(value), input.reason, scope.account]);
    await audit(client, scope, change.id, "student_record.corrected", undefined, input.account);
  });
}
