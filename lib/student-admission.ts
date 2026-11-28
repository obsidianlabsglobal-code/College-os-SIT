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
    const result = await client.query<{ id: string; email: string; section_id: string; term_id: string }>(
      `UPDATE student_admission SET revoked_at=clock_timestamp()
       WHERE institution_id=$1 AND id=$2 AND revoked_at IS NULL RETURNING id,email,section_id,term_id`, [current.institution,parsed.data],
    );
    const entry = result.rows[0];
    if (!entry) throw new WorkflowError("No active approval found.");
    // Revoking ends the student's rosters for that section and term, and their student membership if nothing else remains.
    const { rows: [person] } = await client.query<{ id: string }>('SELECT id FROM "user" WHERE lower(email)=$1', [entry.email]);
    if (person) {
      await client.query(`UPDATE roster r SET ended_at=clock_timestamp() FROM offering o WHERE r.institution_id=$1 AND r.account_id=$2 AND r.role='student'
        AND r.ended_at IS NULL AND (o.institution_id,o.id)=(r.institution_id,r.offering_id) AND o.section_id=$3 AND o.term_id=$4`,
      [current.institution, person.id, entry.section_id, entry.term_id]);
      await client.query(`UPDATE membership SET ended_at=clock_timestamp() WHERE institution_id=$1 AND account_id=$2 AND role='student' AND ended_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM roster WHERE institution_id=$1 AND account_id=$2 AND role='student' AND ended_at IS NULL)`, [current.institution, person.id]);
    }
    await audit(client,current,entry.id,"onboarding.student_revoked",undefined,person?.id);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Pilot sign-up (cc/pilot-access). A person signs in with an email code, then asks to join a section in a switched-on
// department. A current teacher or the class mentor of that section approves (one or many) or rejects with a reason.
// Approval records a student_admission (the office keeps revoke) and creates the membership and section rosters.
// ---------------------------------------------------------------------------------------------------------------------
type Applicant = { id: string; email: string; emailVerified: boolean; name: string };

/** Sections open for sign-up in an institution: those with an offering in a course of a switched-on department. */
export async function joinOptions(institution: string) {
  const id = z.uuid().safeParse(institution);
  if (!id.success) return [];
  return (await db.query<{ section_id: string; term_id: string; label: string }>(`SELECT DISTINCT ON (s.id) s.id AS section_id,o.term_id,
      s.name||' · '||d.name||' · '||t.name AS label
    FROM section s JOIN offering o ON (o.institution_id,o.section_id)=(s.institution_id,s.id)
    JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id) JOIN department d ON (d.institution_id,d.id)=(c.institution_id,c.department_id) AND d.active
    JOIN academic_term t ON (t.institution_id,t.id)=(o.institution_id,o.term_id)
    WHERE s.institution_id=$1 ORDER BY s.id,o.term_id DESC`, [id.data])).rows.sort((a, b) => a.label.localeCompare(b.label));
}

export async function institutionName(institution: string) {
  const id = z.uuid().safeParse(institution);
  return id.success ? (await db.query<{ name: string }>("SELECT name FROM institution WHERE id=$1", [id.data])).rows[0]?.name ?? null : null;
}

const joinInput = z.object({ institution: z.uuid(), name: z.string().trim().min(2).max(120), usn: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6,16}$/),
  semester: z.coerce.number().int().min(1).max(10), section: z.uuid(), phone: z.string().trim().regex(/^\+?[0-9 ]{7,16}$/).optional() });

export type JoinRequest = { id: string; institution: string; section: string; state: string; reason: string | null; created_at: Date };
export async function myJoinRequests(user: { id: string }) {
  return (await db.query<JoinRequest>(`SELECT r.id,i.name AS institution,s.name AS section,r.state,r.reason,r.created_at FROM signup_request r
    JOIN institution i ON i.id=r.institution_id JOIN section s ON (s.institution_id,s.id)=(r.institution_id,r.section_id)
    WHERE r.account_id=$1 ORDER BY r.created_at DESC LIMIT 10`, [user.id])).rows;
}

/** The signed-in applicant asks to join; they see nothing of the institution until approved. */
export function requestToJoin(user: Applicant, raw: unknown) {
  const input = joinInput.parse(raw);
  if (!user.emailVerified) throw new WorkflowError("Confirm your email first by signing in with an emailed code.");
  return transaction(async client => {
    const option = (await joinOptions(input.institution)).find(o => o.section_id === input.section);
    if (!option) throw new WorkflowError("Choose a section that is open for sign-up.");
    const { rowCount: member } = await client.query("SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role='student' AND ended_at IS NULL",
      [input.institution, user.id]);
    if (member) throw new WorkflowError("You are already a student here.");
    const { rowCount: usnTaken } = await client.query("SELECT 1 FROM person_detail WHERE institution_id=$1 AND usn=$2 AND account_id<>$3", [input.institution, input.usn, user.id]);
    if (usnTaken) throw new WorkflowError("This USN is already registered. Ask your class mentor if this is wrong.");
    try {
      const { rows: [row] } = await client.query<{ id: string }>(`INSERT INTO signup_request (institution_id,account_id,name,usn,semester,section_id,term_id,phone)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [input.institution, user.id, input.name, input.usn, input.semester, input.section, option.term_id,
        input.phone ?? null]);
      await audit(client, { institution: input.institution, account: user.id, role: "student" }, row.id, "signup.requested");
      return row.id;
    } catch (error) {
      if ((error as { constraint?: string }).constraint === "signup_request_open_usn") throw new WorkflowError("This USN already has a request. Ask your class mentor if this is wrong.");
      if ((error as { constraint?: string }).constraint === "signup_request_open_account") throw new WorkflowError("You already have a request waiting for a decision.");
      throw error;
    }
  });
}

/** A current teacher of any offering of the section, or its current class mentor who is a current teacher. */
const approves = (section: string) => `EXISTS (SELECT 1 FROM membership am WHERE am.institution_id=$1 AND am.account_id=$2 AND am.role='faculty' AND am.ended_at IS NULL)
  AND (EXISTS (SELECT 1 FROM roster ar JOIN offering ao ON (ao.institution_id,ao.id)=(ar.institution_id,ar.offering_id)
      WHERE ar.institution_id=$1 AND ar.account_id=$2 AND ar.role='faculty' AND ar.ended_at IS NULL AND ao.section_id=${section})
    OR EXISTS (SELECT 1 FROM section_mentor sm WHERE sm.institution_id=$1 AND sm.section_id=${section} AND sm.account_id=$2 AND sm.ended_at IS NULL))`;

export type PendingStudent = { id: string; name: string; email: string; usn: string; semester: number; section: string; phone: string | null;
  state: string; reason: string | null; created_at: Date };
/** Requests in the approver's own sections: pending first, then the last 30 days of decisions. */
export async function sectionRequests(scope: Scope) {
  if (scope.role !== "faculty") return [];
  return (await db.query<PendingStudent>(`SELECT r.id,r.name,u.email,r.usn,r.semester,s.name AS section,r.phone,r.state,r.reason,r.created_at
    FROM signup_request r JOIN "user" u ON u.id=r.account_id JOIN section s ON (s.institution_id,s.id)=(r.institution_id,r.section_id)
    WHERE r.institution_id=$1 AND ${approves("r.section_id")} AND (r.state='pending' OR r.decided_at > clock_timestamp()-interval '30 days')
    ORDER BY (r.state='pending') DESC,s.name,r.name LIMIT 300`, [scope.institution, scope.account])).rows;
}

const decision = z.object({ requests: z.array(z.uuid()).min(1).max(100), decision: z.enum(["approved", "rejected"]), reason: z.string().trim().max(300).optional() });
/** Approve or reject one or many requests the approver may decide; all succeed or none do. */
export function decideJoinRequests(scope: Scope, raw: unknown) {
  const input = decision.parse(raw);
  if (input.decision === "rejected" && !input.reason) throw new WorkflowError("Give a reason the student will see.");
  if (scope.role !== "faculty") throw unavailable();
  return transaction(async client => {
    const { rowCount: active } = await client.query("SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role='faculty' AND ended_at IS NULL FOR SHARE",
      [scope.institution, scope.account]);
    if (!active) throw unavailable();
    for (const requestId of [...new Set(input.requests)]) {
      const { rows: [r] } = await client.query<{ state: string; account_id: string; section_id: string; term_id: string; usn: string; semester: number;
        phone: string | null; email: string; allowed: boolean; open: boolean }>(`SELECT r.state,r.account_id,r.section_id,r.term_id,r.usn,r.semester,r.phone,
          lower(u.email) AS email,${approves("r.section_id")} AS allowed,
          EXISTS (SELECT 1 FROM offering o JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id)
            JOIN department d ON (d.institution_id,d.id)=(c.institution_id,c.department_id) AND d.active
            WHERE o.institution_id=$1 AND o.section_id=r.section_id AND o.term_id=r.term_id) AS open
        FROM signup_request r JOIN "user" u ON u.id=r.account_id WHERE r.institution_id=$1 AND r.id=$3 FOR UPDATE OF r`, [scope.institution, scope.account, requestId]);
      if (!r || !r.allowed) throw new WorkflowError("You can decide requests only for sections you teach or mentor.");
      if (r.state !== "pending") throw new WorkflowError("One of these requests was already decided. Refresh and try again.");
      if (input.decision === "rejected") {
        await client.query("UPDATE signup_request SET state='rejected',reason=$3,decided_by=$4,decided_at=clock_timestamp() WHERE institution_id=$1 AND id=$2",
          [scope.institution, requestId, input.reason, scope.account]);
        await audit(client, scope, requestId, "signup.rejected", undefined, r.account_id);
        continue;
      }
      if (!r.open) throw new WorkflowError("This section's department is not switched on.");
      const { rowCount: usnTaken } = await client.query("SELECT 1 FROM person_detail WHERE institution_id=$1 AND usn=$2 AND account_id<>$3", [scope.institution, r.usn, r.account_id]);
      if (usnTaken) throw new WorkflowError(`USN ${r.usn} already belongs to another student.`);
      const admission = await admitStudent(client, { institution: scope.institution, account: r.account_id, email: r.email, section: r.section_id, term: r.term_id,
        approvedBy: scope.account, usn: r.usn, semester: r.semester, phone: r.phone });
      await client.query("UPDATE signup_request SET state='approved',decided_by=$3,decided_at=clock_timestamp(),admission_id=$4 WHERE institution_id=$1 AND id=$2",
        [scope.institution, requestId, scope.account, admission.id]);
      await audit(client, scope, requestId, "signup.approved", undefined, r.account_id);
    }
    return input.requests.length;
  });
}

/** True for two weeks after a teacher approved the member's sign-up here, so their first screens show the next step. */
export async function recentlyApproved(scope: Scope) {
  if (scope.role !== "student") return false;
  return !!(await db.query(`SELECT 1 FROM signup_request WHERE institution_id=$1 AND account_id=$2 AND state='approved'
    AND decided_at > clock_timestamp()-interval '14 days'`, [scope.institution, scope.account])).rowCount;
}

/** Grants a student access to a section and term: the admission record (the office can revoke it), the student membership,
 * rosters for the section's switched-on offerings, and their details. Shared by teacher approval and the office import. */
export async function admitStudent(client: import("pg").PoolClient, a: { institution: string; account: string; email: string; section: string; term: string;
  approvedBy: string; usn: string; semester: number; phone: string | null }) {
  const { rows: [admission] } = await client.query<{ id: string }>(`INSERT INTO student_admission (institution_id,email,section_id,term_id,approved_by)
    VALUES ($1,$2,$3,$4,$5) ON CONFLICT (institution_id,email) WHERE revoked_at IS NULL DO NOTHING RETURNING id`,
  [a.institution, a.email, a.section, a.term, a.approvedBy]);
  if (!admission) throw new WorkflowError(`${a.email} already has an active admission.`);
  await client.query(`INSERT INTO membership (institution_id,account_id,role) VALUES ($1,$2,'student')
    ON CONFLICT (institution_id,account_id,role,department_id) DO UPDATE SET ended_at=NULL`, [a.institution, a.account]);
  await client.query(`INSERT INTO roster (institution_id,offering_id,account_id,role)
    SELECT o.institution_id,o.id,$3,'student' FROM offering o JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id)
      JOIN department d ON (d.institution_id,d.id)=(c.institution_id,c.department_id) AND d.active
    WHERE o.institution_id=$1 AND o.section_id=$2 AND o.term_id=$4
    ON CONFLICT (institution_id,offering_id,account_id,role) DO UPDATE SET ended_at=NULL`, [a.institution, a.section, a.account, a.term]);
  await client.query(`INSERT INTO person_detail (institution_id,account_id,phone,usn,semester) VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (institution_id,account_id) DO UPDATE SET phone=EXCLUDED.phone,usn=EXCLUDED.usn,semester=EXCLUDED.semester,updated_at=clock_timestamp()`,
  [a.institution, a.account, a.phone, a.usn, a.semester]);
  return admission;
}
