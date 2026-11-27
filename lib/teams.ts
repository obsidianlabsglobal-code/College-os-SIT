import type { PoolClient } from "pg";
import { z } from "zod";
import { audit, WorkflowError } from "./assignments";
import { db, transaction } from "./db";
import type { Scope } from "./scope";

// FC-017 / FC-018: project teams inside one offering. Its current teachers form teams from the active roster
// (one team per student per offering), set milestones and review evidence; team members submit evidence.
const unavailable = () => new WorkflowError("This action is unavailable.");

async function teaching(client: PoolClient, scope: Scope, offering: string) {
  if (scope.role !== "faculty") throw unavailable();
  const { rowCount } = await client.query(`SELECT 1 FROM roster r JOIN membership m USING (institution_id,account_id,role)
    WHERE r.institution_id=$1 AND r.offering_id=$2 AND r.account_id=$3 AND r.role='faculty' AND r.ended_at IS NULL AND m.ended_at IS NULL FOR SHARE OF r,m`,
  [scope.institution, offering, scope.account]);
  if (!rowCount) throw unavailable();
}

export type Team = { id: string; name: string; members: { id: string; name: string }[];
  evidence: { id: string; milestone_id: string; body: string; submitted_by: string; submitted_at: string; review: string; review_note: string | null }[] };
export type Milestone = { id: string; title: string; due_at: Date };

/** Teachers and the department head see every team; a student sees only their own team. */
export async function projectTeams(scope: Scope, offering: string) {
  const args = [scope.institution, scope.account, scope.role, offering];
  const access = `EXISTS (SELECT 1 FROM membership me WHERE me.institution_id=$1 AND me.account_id=$2 AND me.role=$3 AND me.ended_at IS NULL) AND (
    ($3='faculty' AND EXISTS (SELECT 1 FROM roster f WHERE f.institution_id=$1 AND f.offering_id=$4 AND f.account_id=$2 AND f.role='faculty' AND f.ended_at IS NULL))
    OR ($3='hod' AND EXISTS (SELECT 1 FROM offering o JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id)
      JOIN membership h ON h.institution_id=c.institution_id AND h.department_id=c.department_id AND h.account_id=$2 AND h.role='hod' AND h.ended_at IS NULL
      WHERE o.institution_id=$1 AND o.id=$4))
    OR ($3='student' AND EXISTS (SELECT 1 FROM team_member tm JOIN roster r ON (r.institution_id,r.offering_id,r.account_id)=(tm.institution_id,tm.offering_id,tm.student_id)
      AND r.role='student' AND r.ended_at IS NULL WHERE tm.institution_id=$1 AND tm.team_id=t.id AND tm.student_id=$2)))`;
  const [teams, milestones] = await Promise.all([
    db.query<Team>(`SELECT t.id,t.name,
        coalesce((SELECT json_agg(json_build_object('id',u.id,'name',u.name) ORDER BY u.name) FROM team_member tm JOIN "user" u ON u.id=tm.student_id
          WHERE (tm.institution_id,tm.team_id)=(t.institution_id,t.id)),'[]') AS members,
        coalesce((SELECT json_agg(json_build_object('id',e.id,'milestone_id',e.milestone_id,'body',e.body,'submitted_by',su.name,'submitted_at',e.submitted_at,
            'review',e.review,'review_note',e.review_note) ORDER BY e.submitted_at DESC)
          FROM milestone_evidence e JOIN "user" su ON su.id=e.submitted_by WHERE (e.institution_id,e.team_id)=(t.institution_id,t.id)),'[]') AS evidence
      FROM project_team t WHERE t.institution_id=$1 AND t.offering_id=$4 AND ${access} ORDER BY t.name`, args),
    db.query<Milestone>(`SELECT m.id,m.title,m.due_at FROM team_milestone m WHERE m.institution_id=$1 AND m.offering_id=$4
      AND EXISTS (SELECT 1 FROM roster r JOIN membership me ON me.institution_id=r.institution_id AND me.account_id=r.account_id AND me.role=r.role AND me.ended_at IS NULL
        WHERE r.institution_id=$1 AND r.offering_id=$4 AND r.account_id=$2 AND r.role=$3 AND r.ended_at IS NULL)
      ORDER BY m.due_at`, args)]);
  return { teams: teams.rows, milestones: milestones.rows };
}

const teamInput = z.object({ offering: z.uuid(), name: z.string().trim().min(1).max(80), students: z.array(z.string().min(1).max(100)).min(1).max(12) });
export function createTeam(scope: Scope, raw: unknown) {
  const input = teamInput.parse(raw);
  return transaction(async client => {
    await teaching(client, scope, input.offering);
    const { rows } = await client.query<{ account_id: string }>(`SELECT r.account_id FROM roster r JOIN membership m USING (institution_id,account_id,role)
      WHERE r.institution_id=$1 AND r.offering_id=$2 AND r.role='student' AND r.ended_at IS NULL AND m.ended_at IS NULL AND r.account_id=ANY($3)`,
    [scope.institution, input.offering, input.students]);
    if (rows.length !== new Set(input.students).size) throw new WorkflowError("Choose students currently enrolled in this course.");
    try {
      const { rows: [team] } = await client.query<{ id: string }>("INSERT INTO project_team (institution_id,offering_id,name,created_by) VALUES ($1,$2,$3,$4) RETURNING id",
        [scope.institution, input.offering, input.name, scope.account]);
      await client.query("INSERT INTO team_member (institution_id,team_id,offering_id,student_id) SELECT $1,$2,$3,unnest($4::text[])",
        [scope.institution, team.id, input.offering, [...new Set(input.students)]]);
      await audit(client, scope, team.id, "team.formed");
      return team.id;
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw new WorkflowError("A student is already in a team for this course, or the team name is taken.");
      throw error;
    }
  });
}

const milestoneInput = z.object({ offering: z.uuid(), title: z.string().trim().min(1).max(160),
  due: z.iso.datetime({ local: true, precision: -1 }).refine(v => !v.endsWith("Z")) });
export function addMilestone(scope: Scope, raw: unknown) {
  const input = milestoneInput.parse(raw);
  return transaction(async client => {
    await teaching(client, scope, input.offering);
    const { rows: [row] } = await client.query<{ id: string }>(`INSERT INTO team_milestone (institution_id,offering_id,title,due_at,created_by)
      SELECT $1,$2,$3,$4::timestamp AT TIME ZONE timezone,$5 FROM institution WHERE id=$1 RETURNING id`,
    [scope.institution, input.offering, input.title, input.due, scope.account]);
    await audit(client, scope, row.id, "team.milestone_set");
    return row.id;
  });
}

const evidenceInput = z.object({ milestone: z.uuid(), body: z.string().trim().min(1).max(4000) });
export function submitEvidence(scope: Scope, raw: unknown) {
  const input = evidenceInput.parse(raw);
  if (scope.role !== "student") throw unavailable();
  return transaction(async client => {
    const { rows: [team] } = await client.query<{ team_id: string; offering_id: string }>(`SELECT tm.team_id,tm.offering_id FROM team_milestone ms
      JOIN team_member tm ON (tm.institution_id,tm.offering_id)=(ms.institution_id,ms.offering_id) AND tm.student_id=$3
      JOIN roster r ON (r.institution_id,r.offering_id,r.account_id)=(tm.institution_id,tm.offering_id,tm.student_id) AND r.role='student' AND r.ended_at IS NULL
      JOIN membership m ON m.institution_id=r.institution_id AND m.account_id=r.account_id AND m.role='student' AND m.ended_at IS NULL
      WHERE ms.institution_id=$1 AND ms.id=$2`, [scope.institution, input.milestone, scope.account]);
    if (!team) throw unavailable();
    const { rows: [row] } = await client.query<{ id: string }>(`INSERT INTO milestone_evidence (institution_id,milestone_id,team_id,offering_id,submitted_by,body)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [scope.institution, input.milestone, team.team_id, team.offering_id, scope.account, input.body]);
    await audit(client, scope, row.id, "team.evidence_submitted");
    return row.id;
  });
}

const reviewInput = z.object({ evidence: z.uuid(), decision: z.enum(["accepted", "changes_requested"]), note: z.string().trim().min(1).max(1000) });
export function reviewEvidence(scope: Scope, raw: unknown) {
  const input = reviewInput.parse(raw);
  return transaction(async client => {
    const { rows: [row] } = await client.query<{ offering_id: string; review: string }>(
      "SELECT offering_id,review FROM milestone_evidence WHERE institution_id=$1 AND id=$2 FOR UPDATE", [scope.institution, input.evidence]);
    if (!row) throw unavailable();
    await teaching(client, scope, row.offering_id);
    if (row.review !== "pending") throw new WorkflowError("This evidence has already been reviewed. The team can submit again.");
    await client.query(`UPDATE milestone_evidence SET review=$3,reviewed_by=$4,reviewed_at=clock_timestamp(),review_note=$5 WHERE institution_id=$1 AND id=$2`,
      [scope.institution, input.evidence, input.decision, scope.account, input.note]);
    await audit(client, scope, input.evidence, "team.evidence_reviewed");
  });
}

/** Enrolled students in this offering who are not yet on a team, for its current teachers only. */
export async function unteamedStudents(scope: Scope, offering: string) {
  if (scope.role !== "faculty") return [];
  return (await db.query<{ id: string; name: string }>(`SELECT u.id,u.name FROM roster r JOIN "user" u ON u.id=r.account_id
    WHERE r.institution_id=$1 AND r.offering_id=$2 AND r.role='student' AND r.ended_at IS NULL
      AND EXISTS (SELECT 1 FROM roster f JOIN membership m ON m.institution_id=f.institution_id AND m.account_id=f.account_id AND m.role='faculty' AND m.ended_at IS NULL
        WHERE f.institution_id=$1 AND f.offering_id=$2 AND f.account_id=$3 AND f.role='faculty' AND f.ended_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM team_member tm WHERE (tm.institution_id,tm.offering_id,tm.student_id)=(r.institution_id,r.offering_id,r.account_id))
    ORDER BY u.name`, [scope.institution, offering, scope.account])).rows;
}
