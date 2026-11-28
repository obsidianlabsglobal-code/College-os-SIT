import { z } from "zod";
import { audit, WorkflowError } from "./assignments";
import { db, transaction } from "./db";
import type { Scope } from "./scope";

// SL-014: opt-in study groups inside an offering, open to its current students. SL-009: a student's own profile
// fields with a visibility choice (private, teachers, classmates); teachers include the current mentor.
const unavailable = () => new WorkflowError("This action is unavailable.");
const enrolled = (offering: string) => `EXISTS (SELECT 1 FROM roster r JOIN membership m ON m.institution_id=r.institution_id AND m.account_id=r.account_id
  AND m.role='student' AND m.ended_at IS NULL WHERE r.institution_id=$1 AND r.offering_id=${offering} AND r.account_id=$2 AND r.role='student' AND r.ended_at IS NULL)`;

export type StudyGroup = { id: string; name: string; course: string; offering_id: string; capacity: number; members: { id: string | null; name: string }[]; joined: boolean };
export async function studyGroups(scope: Scope) {
  if (scope.role !== "student") return [];
  return (await db.query<StudyGroup>(`SELECT g.id,g.name,c.name||' · '||s.name AS course,g.offering_id,g.capacity,
      coalesce((SELECT json_agg(json_build_object('id',CASE WHEN v.shown THEN u.id END,'name',CASE WHEN v.shown THEN u.name ELSE 'A classmate' END) ORDER BY NOT v.shown,u.name)
        FROM study_group_member x JOIN "user" u ON u.id=x.student_id
        CROSS JOIN LATERAL (SELECT x.student_id=$2 OR coalesce((SELECT p.discoverable FROM account_preference p WHERE p.institution_id=x.institution_id AND p.account_id=x.student_id),true) AS shown) v
        WHERE (x.institution_id,x.group_id)=(g.institution_id,g.id)),'[]') AS members,
      EXISTS (SELECT 1 FROM study_group_member x WHERE (x.institution_id,x.group_id)=(g.institution_id,g.id) AND x.student_id=$2) AS joined
    FROM study_group g JOIN offering o ON (o.institution_id,o.id)=(g.institution_id,g.offering_id)
    JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id) JOIN section s ON (s.institution_id,s.id)=(o.institution_id,o.section_id)
    WHERE g.institution_id=$1 AND ${enrolled("g.offering_id")} ORDER BY c.name,g.name`, [scope.institution, scope.account])).rows;
}

const groupInput = z.object({ offering: z.uuid(), name: z.string().trim().min(1).max(80), capacity: z.coerce.number().int().min(2).max(30) });
export function createStudyGroup(scope: Scope, raw: unknown) {
  const input = groupInput.parse(raw);
  if (scope.role !== "student") throw unavailable();
  return transaction(async client => {
    try {
      const { rows: [row] } = await client.query<{ id: string }>(`INSERT INTO study_group (institution_id,offering_id,name,capacity,created_by)
        SELECT $1,$3,$4,$5,$2 WHERE ${enrolled("$3")} RETURNING id`, [scope.institution, scope.account, input.offering, input.name, input.capacity]);
      if (!row) throw new WorkflowError("Choose a course you are enrolled in.");
      await client.query("INSERT INTO study_group_member (institution_id,group_id,student_id) VALUES ($1,$2,$3)", [scope.institution, row.id, scope.account]);
      await audit(client, scope, row.id, "study_group.created");
      return row.id;
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw new WorkflowError("A group with this name already exists for the course.");
      throw error;
    }
  });
}

export function joinStudyGroup(scope: Scope, id: unknown) {
  const group = z.uuid().parse(id);
  if (scope.role !== "student") throw unavailable();
  return transaction(async client => {
    const { rows: [g] } = await client.query<{ offering_id: string; capacity: number }>(
      "SELECT offering_id,capacity FROM study_group WHERE institution_id=$1 AND id=$2 FOR UPDATE", [scope.institution, group]);
    if (!g || !(await client.query(`SELECT ${enrolled("$3")} AS ok`, [scope.institution, scope.account, g.offering_id])).rows[0].ok) throw unavailable();
    const { rows: [n] } = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM study_group_member WHERE institution_id=$1 AND group_id=$2", [scope.institution, group]);
    if (n.n >= g.capacity) throw new WorkflowError("This group is full.");
    const added = await client.query("INSERT INTO study_group_member (institution_id,group_id,student_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
      [scope.institution, group, scope.account]);
    if (!added.rowCount) throw new WorkflowError("You are already in this group.");
    await audit(client, scope, group, "study_group.joined");
  });
}

export function leaveStudyGroup(scope: Scope, id: unknown) {
  const group = z.uuid().parse(id);
  return transaction(async client => {
    const { rowCount } = await client.query("DELETE FROM study_group_member WHERE institution_id=$1 AND group_id=$2 AND student_id=$3", [scope.institution, group, scope.account]);
    if (!rowCount) throw unavailable();
    await audit(client, scope, group, "study_group.left");
  });
}

export type Profile = { student_id: string; name: string; bio: string; interests: string; visibility: "private" | "teachers" | "classmates" };
const shares = `EXISTS (SELECT 1 FROM roster a JOIN roster b ON (b.institution_id,b.offering_id)=(a.institution_id,a.offering_id)
  WHERE a.institution_id=p.institution_id AND a.account_id=p.student_id AND a.role='student' AND a.ended_at IS NULL
    AND b.account_id=$2 AND b.role=$3 AND b.ended_at IS NULL)`;
/** Self; a current teacher of a shared course or the current mentor when shared with teachers or classmates;
 * a classmate in a shared course when shared with classmates. */
export async function readProfile(scope: Scope, student: string) {
  return (await db.query<Profile>(`SELECT p.student_id,u.name,p.bio,p.interests,p.visibility FROM student_profile p JOIN "user" u ON u.id=p.student_id
    JOIN membership me ON me.institution_id=p.institution_id AND me.account_id=$2 AND me.role=$3 AND me.ended_at IS NULL
    WHERE p.institution_id=$1 AND p.student_id=$4 AND (p.student_id=$2
      OR ($3='faculty' AND p.visibility IN ('teachers','classmates') AND (${shares} OR EXISTS (SELECT 1 FROM mentor_assignment ma
        WHERE ma.institution_id=p.institution_id AND ma.student_id=p.student_id AND ma.mentor_id=$2 AND ma.ended_at IS NULL)))
      OR ($3='student' AND p.visibility='classmates' AND ${shares}))`, [scope.institution, scope.account, scope.role, student])).rows[0] ?? null;
}

const profileInput = z.object({ bio: z.string().trim().max(1000), interests: z.string().trim().max(300), visibility: z.enum(["private", "teachers", "classmates"]) });
export function saveProfile(scope: Scope, raw: unknown) {
  const input = profileInput.parse(raw);
  if (scope.role !== "student") throw unavailable();
  return transaction(async client => {
    const { rowCount } = await client.query(`INSERT INTO student_profile (institution_id,student_id,bio,interests,visibility)
      SELECT $1,$2,$3,$4,$5 WHERE EXISTS (SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role='student' AND ended_at IS NULL)
      ON CONFLICT (institution_id,student_id) DO UPDATE SET bio=EXCLUDED.bio,interests=EXCLUDED.interests,visibility=EXCLUDED.visibility,updated_at=clock_timestamp()`,
    [scope.institution, scope.account, input.bio, input.interests, input.visibility]);
    if (!rowCount) throw unavailable();
    await audit(client, scope, scope.institution, "profile.updated", undefined, scope.account);
  });
}

// SL-013: portfolio entries are references to verified records the student owns — issued certificates, accepted team
// milestone evidence and published results. Readers follow the profile visibility (readProfile).
export type PortfolioEntry = { source: "certificate" | "milestone" | "result"; source_id: string; title: string; detail: string; included: boolean };
export async function portfolioCandidates(scope: Scope, student = scope.account) {
  const { rows } = await db.query<PortfolioEntry>(`WITH items AS (
      SELECT 'certificate'::text AS source,k.id AS source_id,'Certificate: '||k.kind AS title,'Issued '||to_char(k.issued_at,'DD Mon YYYY') AS detail
        FROM certificate k WHERE k.institution_id=$1 AND k.student_id=$2 AND k.state='issued'
      UNION ALL SELECT 'milestone',e.id,'Project milestone: '||m.title,'Accepted · '||t.name
        FROM milestone_evidence e JOIN team_milestone m ON (m.institution_id,m.id)=(e.institution_id,e.milestone_id)
        JOIN project_team t ON (t.institution_id,t.id)=(e.institution_id,e.team_id)
        JOIN team_member tm ON (tm.institution_id,tm.team_id)=(t.institution_id,t.id) AND tm.student_id=$2
        WHERE e.institution_id=$1 AND e.review='accepted'
      UNION ALL SELECT DISTINCT ON (s.id) 'result',s.id,'Result: '||a.title,g.marks||'/'||a.max_marks
        FROM submission s JOIN assignment a ON (a.institution_id,a.id)=(s.institution_id,s.assignment_id)
        JOIN grade g ON (g.institution_id,g.submission_id)=(s.institution_id,s.id) AND g.published_at IS NOT NULL
        WHERE s.institution_id=$1 AND s.student_id=$2)
    SELECT i.*,EXISTS (SELECT 1 FROM portfolio_item p WHERE p.institution_id=$1 AND p.student_id=$2 AND p.source=i.source AND p.source_id=i.source_id) AS included
    FROM items i ORDER BY i.source,i.title`, [scope.institution, student]);
  return rows;
}

/** The student's own curation, or another reader's view when the profile is visible to them. */
export async function portfolio(scope: Scope, student: string) {
  if (student !== scope.account && !(await readProfile(scope, student))) return null;
  if (scope.role !== "student" && student === scope.account) return null;
  return (await portfolioCandidates(scope, student)).filter(e => e.included);
}

export function setPortfolioItem(scope: Scope, raw: unknown) {
  const input = z.object({ source: z.enum(["certificate", "milestone", "result"]), id: z.uuid(), include: z.boolean() }).parse(raw);
  if (scope.role !== "student") throw unavailable();
  return transaction(async client => {
    const eligible = (await portfolioCandidates(scope)).some(e => e.source === input.source && e.source_id === input.id);
    if (!eligible) throw new WorkflowError("Only your own verified records can be added.");
    if (input.include) await client.query("INSERT INTO portfolio_item (institution_id,student_id,source,source_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING",
      [scope.institution, scope.account, input.source, input.id]);
    else await client.query("DELETE FROM portfolio_item WHERE institution_id=$1 AND student_id=$2 AND source=$3 AND source_id=$4", [scope.institution, scope.account, input.source, input.id]);
    await audit(client, scope, input.id, input.include ? "portfolio.added" : "portfolio.removed");
  });
}
