import { z } from "zod";
import { audit, WorkflowError } from "./assignments";
import { db, transaction } from "./db";
import { portfolio } from "./student-life";
import type { Scope } from "./scope";

// CR-010 / CR-015 / CR-016 / CR-031 / CR-032 / CR-033: application tracking on verified listings, office-recorded placement
// outcomes, and an outcome summary that counts only office-recorded placement offers.
const unavailable = () => new WorkflowError("This action is unavailable.");

/** A current student, and for a department listing a current course in that department. */
const eligible = (listing: string, student: string) => `(EXISTS (SELECT 1 FROM membership em WHERE em.institution_id=${listing}.institution_id
    AND em.account_id=${student} AND em.role='student' AND em.ended_at IS NULL)
  AND (${listing}.department_id IS NULL OR EXISTS (SELECT 1 FROM roster er JOIN offering eo ON (eo.institution_id,eo.id)=(er.institution_id,er.offering_id)
    JOIN course ec ON (ec.institution_id,ec.id)=(eo.institution_id,eo.course_id)
    WHERE er.institution_id=${listing}.institution_id AND er.account_id=${student} AND er.role='student' AND er.ended_at IS NULL AND ec.department_id=${listing}.department_id)))`;
const open = `l.withdrawn_at IS NULL AND l.deadline >= (now() AT TIME ZONE i.timezone)::date`;

export type Application = { listing_id: string; title: string; kind: string; sponsor: string; deadline: string; state: string; statement: string;
  outcome_note: string | null; open: boolean; eligible: boolean; department: string | null };
export async function myApplications(scope: Scope) {
  if (scope.role !== "student") return [];
  return (await db.query<Application>(`SELECT a.listing_id,l.title,l.kind,l.sponsor,to_char(l.deadline,'YYYY-MM-DD') AS deadline,a.state,a.statement,a.outcome_note,
      (${open}) AS open,${eligible("l", "$2")} AS eligible,d.name AS department
    FROM opportunity_application a JOIN opportunity_listing l ON (l.institution_id,l.id)=(a.institution_id,a.listing_id)
    JOIN institution i ON i.id=l.institution_id LEFT JOIN department d ON (d.institution_id,d.id)=(l.institution_id,l.department_id)
    WHERE a.institution_id=$1 AND a.student_id=$2 AND EXISTS (SELECT 1 FROM membership m WHERE m.institution_id=$1 AND m.account_id=$2 AND m.role='student' AND m.ended_at IS NULL)
    ORDER BY l.deadline`, [scope.institution, scope.account])).rows;
}

/** CR-010: whether the student meets a listing's structured requirement, and what to correct if not. */
export async function eligibility(scope: Scope, listing: string) {
  const { rows: [row] } = await db.query<{ eligible: boolean; department: string | null }>(`SELECT ${eligible("l", "$2")} AS eligible,d.name AS department
    FROM opportunity_listing l LEFT JOIN department d ON (d.institution_id,d.id)=(l.institution_id,l.department_id) WHERE l.institution_id=$1 AND l.id=$3`,
  [scope.institution, scope.account, listing]);
  if (!row) return null;
  return { eligible: row.eligible, explanation: row.eligible ? (row.department ? `You currently take a ${row.department} course.` : "Open to all current students.")
    : `Requires a current ${row.department} course. If your enrolment is missing, ask the office to correct it.` };
}

export function trackListing(scope: Scope, id: unknown) {
  const listing = z.uuid().parse(id);
  if (scope.role !== "student") throw unavailable();
  return transaction(async client => {
    const { rows: [l] } = await client.query(`SELECT 1 FROM opportunity_listing l JOIN institution i ON i.id=l.institution_id
      WHERE l.institution_id=$1 AND l.id=$2 AND ${open} AND EXISTS (SELECT 1 FROM membership m WHERE m.institution_id=$1 AND m.account_id=$3 AND m.role='student' AND m.ended_at IS NULL)`,
    [scope.institution, listing, scope.account]);
    if (!l) throw new WorkflowError("This listing is closed or unavailable.");
    const added = await client.query("INSERT INTO opportunity_application (institution_id,listing_id,student_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
      [scope.institution, listing, scope.account]);
    if (!added.rowCount) throw new WorkflowError("You already track this listing.");
    await audit(client, scope, listing, "application.saved");
  });
}

const draftInput = z.object({ listing: z.uuid(), statement: z.string().trim().max(3000), submit: z.boolean() });
/** CR-015 / CR-016: save the draft statement; submitting needs eligibility, an open listing and a statement. */
export function saveApplication(scope: Scope, raw: unknown) {
  const input = draftInput.parse(raw);
  if (scope.role !== "student") throw unavailable();
  return transaction(async client => {
    const { rows: [a] } = await client.query<{ state: string; open: boolean; eligible: boolean }>(`SELECT a.state,(${open}) AS open,${eligible("l", "$3")} AS eligible
      FROM opportunity_application a JOIN opportunity_listing l ON (l.institution_id,l.id)=(a.institution_id,a.listing_id) JOIN institution i ON i.id=l.institution_id
      WHERE a.institution_id=$1 AND a.listing_id=$2 AND a.student_id=$3 FOR UPDATE OF a`, [scope.institution, input.listing, scope.account]);
    if (!a || a.state !== "saved") throw new WorkflowError("Only a saved application can be edited.");
    if (input.submit) {
      if (!a.open) throw new WorkflowError("The deadline has passed or the listing was withdrawn.");
      if (!a.eligible) throw new WorkflowError("You do not meet this listing's requirement.");
      if (!input.statement) throw new WorkflowError("Write a statement before submitting.");
    }
    await client.query(`UPDATE opportunity_application SET statement=$4,state=$5,submitted_at=CASE WHEN $5='submitted' THEN clock_timestamp() END,updated_at=clock_timestamp()
      WHERE institution_id=$1 AND listing_id=$2 AND student_id=$3`, [scope.institution, input.listing, scope.account, input.statement, input.submit ? "submitted" : "saved"]);
    await audit(client, scope, input.listing, input.submit ? "application.submitted" : "application.drafted");
  });
}

export function withdrawApplication(scope: Scope, id: unknown) {
  const listing = z.uuid().parse(id);
  if (scope.role !== "student") throw unavailable();
  return transaction(async client => {
    const { rowCount } = await client.query(`UPDATE opportunity_application SET state='withdrawn',updated_at=clock_timestamp()
      WHERE institution_id=$1 AND listing_id=$2 AND student_id=$3 AND state IN ('saved','submitted','shortlisted')`, [scope.institution, listing, scope.account]);
    if (!rowCount) throw new WorkflowError("This application can no longer be withdrawn.");
    await audit(client, scope, listing, "application.withdrawn");
  });
}

export type Applicant = { listing_id: string; title: string; student_id: string; name: string; state: string; statement: string; outcome_note: string | null };
/** CR-032: the office sees submitted applicants for placement drives only. */
export async function placementApplicants(scope: Scope) {
  if (scope.role !== "admin") return [];
  return (await db.query<Applicant>(`SELECT a.listing_id,l.title,a.student_id,u.name,a.state,a.statement,a.outcome_note
    FROM opportunity_application a JOIN opportunity_listing l ON (l.institution_id,l.id)=(a.institution_id,a.listing_id) AND l.kind='placement'
    JOIN "user" u ON u.id=a.student_id
    WHERE a.institution_id=$1 AND a.state IN ('submitted','shortlisted','offered','rejected')
      AND EXISTS (SELECT 1 FROM membership m WHERE m.institution_id=$1 AND m.account_id=$2 AND m.role='admin' AND m.ended_at IS NULL)
    ORDER BY l.deadline,l.title,u.name`, [scope.institution, scope.account])).rows;
}

const outcomeInput = z.object({ listing: z.uuid(), student: z.string().min(1).max(100), outcome: z.enum(["shortlisted", "offered", "rejected"]), note: z.string().trim().min(1).max(500) });
const next: Record<string, string[]> = { submitted: ["shortlisted", "rejected"], shortlisted: ["offered", "rejected"] };
export function recordOutcome(scope: Scope, raw: unknown) {
  const input = outcomeInput.parse(raw);
  return transaction(async client => {
    const { rowCount: admin } = await client.query("SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role='admin' AND ended_at IS NULL FOR SHARE",
      [scope.institution, scope.account]);
    if (scope.role !== "admin" || !admin) throw unavailable();
    const { rows: [a] } = await client.query<{ state: string }>(`SELECT a.state FROM opportunity_application a
      JOIN opportunity_listing l ON (l.institution_id,l.id)=(a.institution_id,a.listing_id) AND l.kind='placement'
      WHERE a.institution_id=$1 AND a.listing_id=$2 AND a.student_id=$3 FOR UPDATE OF a`, [scope.institution, input.listing, input.student]);
    if (!a || !(next[a.state] ?? []).includes(input.outcome)) throw new WorkflowError("This applicant is unavailable or already decided.");
    await client.query(`UPDATE opportunity_application SET state=$4,outcome_note=$5,decided_by=$6,updated_at=clock_timestamp()
      WHERE institution_id=$1 AND listing_id=$2 AND student_id=$3`, [scope.institution, input.listing, input.student, input.outcome, input.note, scope.account]);
    await audit(client, scope, input.listing, `application.${input.outcome}`, undefined, input.student);
  });
}

/** CR-033: office-recorded placement offers per department (by the student's current courses), for the office and principal. */
export async function placementOutcomes(scope: Scope) {
  if (scope.role !== "admin" && scope.role !== "principal") return [];
  return (await db.query<{ department: string; students_offered: number; applicants: number }>(`SELECT d.name AS department,
      count(DISTINCT a.student_id) FILTER (WHERE a.state='offered')::int AS students_offered,count(DISTINCT a.student_id)::int AS applicants
    FROM opportunity_application a JOIN opportunity_listing l ON (l.institution_id,l.id)=(a.institution_id,a.listing_id) AND l.kind='placement'
    JOIN roster r ON r.institution_id=a.institution_id AND r.account_id=a.student_id AND r.role='student' AND r.ended_at IS NULL
    JOIN offering o ON (o.institution_id,o.id)=(r.institution_id,r.offering_id) JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id)
    JOIN department d ON (d.institution_id,d.id)=(c.institution_id,c.department_id)
    WHERE a.institution_id=$1 AND a.state<>'saved' AND a.state<>'withdrawn'
      AND EXISTS (SELECT 1 FROM membership m WHERE m.institution_id=$1 AND m.account_id=$2 AND m.role=$3 AND m.ended_at IS NULL)
    GROUP BY d.name ORDER BY d.name`, [scope.institution, scope.account, scope.role])).rows;
}

/** CR-013: a plain-text résumé draft from the profile and the student's own portfolio selection; nothing is sent. */
export async function resumeDraft(scope: Scope) {
  if (scope.role !== "student") return null;
  const { rows: [me] } = await db.query<{ name: string; interests: string | null }>(`SELECT u.name,p.interests FROM "user" u
    LEFT JOIN student_profile p ON p.institution_id=$1 AND p.student_id=u.id WHERE u.id=$2`, [scope.institution, scope.account]);
  const entries = (await portfolio(scope, scope.account)) ?? [];
  const lines = [me.name, "", "Interests", me.interests || "—", "", "Verified record"];
  lines.push(...(entries.length ? entries.map(e => `• ${e.title} — ${e.detail}`) : ["• Add verified records to your portfolio on My profile."]));
  return lines.join("\n");
}
