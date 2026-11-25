import { z } from "zod";
import { db, transaction } from "./db";
import { audit, WorkflowError } from "./assignments";
import type { Scope } from "./scope";

const previewEmail = z.string().trim().toLowerCase().max(254).regex(/^[a-z0-9][a-z0-9._+-]{0,63}@nexus\.example\.invalid$/);
const approval = z.object({ email: previewEmail, section: z.uuid(), term: z.uuid() }).strict();
const id = z.uuid();
const unavailable = () => new WorkflowError("Student admission is unavailable.");

export async function studentAdmissions(current: Scope) {
  if (current.role !== "admin") throw unavailable();
  const { rows } = await db.query<{
    id: string; email: string; section: string; term: string; revoked_at: Date | null;
  }>(
    `SELECT a.id,a.email,s.name AS section,t.name AS term,a.revoked_at
     FROM student_admission a
     JOIN section s ON (s.institution_id,s.id)=(a.institution_id,a.section_id)
     JOIN academic_term t ON (t.institution_id,t.id)=(a.institution_id,a.term_id)
     WHERE a.institution_id=$1 AND EXISTS (
       SELECT 1 FROM membership m WHERE m.institution_id=$1 AND m.account_id=$2
       AND m.role='admin' AND m.ended_at IS NULL
     )
     ORDER BY (a.revoked_at IS NOT NULL), a.approved_at DESC, a.id LIMIT 500`,
    [current.institution,current.account],
  );
  return rows;
}

async function requireAdmin(client: Pick<import("pg").PoolClient, "query">, current: Scope) {
  const authority = await client.query(
    `SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2
     AND role='admin' AND ended_at IS NULL FOR SHARE`, [current.institution,current.account],
  );
  if (!authority.rowCount) throw unavailable();
}

export async function approvePreviewStudent(current: Scope, input: unknown) {
  if (current.role !== "admin") throw unavailable();
  const parsed = approval.safeParse(input);
  if (!parsed.success) throw new WorkflowError("Use an example email ending in @nexus.example.invalid and select a section and term.");
  const { email, section, term } = parsed.data;
  return transaction(async client => {
    await requireAdmin(client,current);
    const result = await client.query<{ id: string }>(
      `INSERT INTO student_admission (institution_id,email,section_id,term_id,approved_by)
       SELECT $1,$2,$3,$4,$5
       WHERE EXISTS (SELECT 1 FROM section WHERE institution_id=$1 AND id=$3)
         AND EXISTS (SELECT 1 FROM academic_term WHERE institution_id=$1 AND id=$4)
       ON CONFLICT (institution_id,email) WHERE revoked_at IS NULL DO NOTHING RETURNING id`,
      [current.institution,email,section,term,current.account],
    );
    const entry = result.rows[0];
    if (!entry) throw new WorkflowError("An active approval already exists or the selected section or term is unavailable.");
    await audit(client,current,entry.id,"onboarding.student_approved");
    return entry.id;
  });
}

export async function revokePreviewStudent(current: Scope, input: unknown) {
  if (current.role !== "admin") throw unavailable();
  const parsed = id.safeParse(input);
  if (!parsed.success) throw unavailable();
  return transaction(async client => {
    await requireAdmin(client,current);
    const result = await client.query<{ id: string }>(
      `UPDATE student_admission SET revoked_at=clock_timestamp()
       WHERE institution_id=$1 AND id=$2 AND revoked_at IS NULL RETURNING id`, [current.institution,parsed.data],
    );
    const entry = result.rows[0];
    if (!entry) throw new WorkflowError("No active approval found.");
    await audit(client,current,entry.id,"onboarding.student_revoked");
  });
}
