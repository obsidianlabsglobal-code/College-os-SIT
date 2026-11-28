import type { PoolClient } from "pg";
import { z } from "zod";
import { audit, WorkflowError } from "./assignments";
import { db, transaction } from "./db";
import type { Scope } from "./scope";

// SP-*: the office (admin) creates tournaments and teams, assigns coaches and match officials, and schedules fixtures.
// Coaches run trials, training and announcements for their own team. Officials record and revise results with a reason.
// Standings and achievements derive only from completed fixtures and verified participation.
const unavailable = () => new WorkflowError("This action is unavailable.");
const text = (max: number) => z.string().trim().min(1).max(max);

async function holds(client: PoolClient, scope: Scope, role: Scope["role"]) {
  if (scope.role !== role) return false;
  return !!(await client.query("SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role=$3 AND ended_at IS NULL FOR SHARE",
    [scope.institution, scope.account, role])).rowCount;
}
async function requireAdmin(client: PoolClient, scope: Scope) { if (!(await holds(client, scope, "admin"))) throw unavailable(); }
const isStaff = (client: PoolClient, scope: Scope, account: string) => client.query(
  "SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role IN ('faculty','hod','admin') AND ended_at IS NULL", [scope.institution, account]).then(r => !!r.rowCount);

/** SP-015: a current student is eligible for an internal team; a department team also needs a current course in that department. */
const eligibleSql = (team: string, student: string) => `(NOT ${team}.external
  AND EXISTS (SELECT 1 FROM membership em WHERE em.institution_id=${team}.institution_id AND em.account_id=${student} AND em.role='student' AND em.ended_at IS NULL)
  AND (${team}.department_id IS NULL OR EXISTS (SELECT 1 FROM roster er JOIN offering eo ON (eo.institution_id,eo.id)=(er.institution_id,er.offering_id)
    JOIN course ec ON (ec.institution_id,ec.id)=(eo.institution_id,eo.course_id)
    WHERE er.institution_id=${team}.institution_id AND er.account_id=${student} AND er.role='student' AND er.ended_at IS NULL AND ec.department_id=${team}.department_id)))`;

export type Team = { id: string; sport: string; name: string; department: string | null; external: boolean; coach: string | null; coach_id: string | null;
  trials_open: boolean; selected: number; my_state: string | null; my_reason: string | null; eligible: boolean;
  requests: { student_id: string; name: string; state: string }[]; announcements: { body: string; author: string; created_at: string }[];
  training: { id: string; venue: string; starts_at: string; ends_at: string }[] };
export type Fixture = { id: string; tournament_id: string; tournament: string; home: string; away: string; home_team_id: string; away_team_id: string; venue: string;
  official: string; official_id: string; starts_at: Date; ends_at: Date; state: string; home_score: number | null; away_score: number | null;
  result_reason: string | null; revision: number; participants: { id: string; name: string }[] };
export type Standing = { tournament_id: string; team: string; played: number; won: number; drawn: number; lost: number; scored: number; conceded: number; points: number };

export async function sportsOverview(scope: Scope) {
  const params = [scope.institution, scope.account, scope.role];
  const member = `EXISTS (SELECT 1 FROM membership me WHERE me.institution_id=$1 AND me.account_id=$2 AND me.role=$3 AND me.ended_at IS NULL)`;
  // Team members (selected players) and the coach read announcements and training; the office reads everything.
  const inner = `($3='admin' OR t.coach_id=$2 OR EXISTS (SELECT 1 FROM team_player ip WHERE (ip.institution_id,ip.team_id)=(t.institution_id,t.id) AND ip.student_id=$2 AND ip.state='selected'))`;
  const [teams, tournaments, fixtures, standings] = await Promise.all([
    db.query<Team>(`SELECT t.id,t.sport,t.name,d.name AS department,t.external,cu.name AS coach,t.coach_id,t.trials_open,
        (SELECT count(*)::int FROM team_player s WHERE (s.institution_id,s.team_id)=(t.institution_id,t.id) AND s.state='selected') AS selected,
        mp.state AS my_state,mp.reason AS my_reason,($3='student' AND ${eligibleSql("t", "$2")}) AS eligible,
        CASE WHEN $3='admin' OR t.coach_id=$2 THEN coalesce((SELECT json_agg(json_build_object('student_id',p.student_id,'name',pu.name,'state',p.state) ORDER BY p.state,pu.name)
          FROM team_player p JOIN "user" pu ON pu.id=p.student_id WHERE (p.institution_id,p.team_id)=(t.institution_id,t.id)),'[]') ELSE '[]' END AS requests,
        CASE WHEN ${inner} THEN coalesce((SELECT json_agg(json_build_object('body',a.body,'author',au.name,'created_at',a.created_at) ORDER BY a.created_at DESC)
          FROM team_announcement a JOIN "user" au ON au.id=a.author_id WHERE (a.institution_id,a.team_id)=(t.institution_id,t.id)),'[]') ELSE '[]' END AS announcements,
        CASE WHEN ${inner} THEN coalesce((SELECT json_agg(json_build_object('id',x.id,'venue',r.name,'starts_at',lower(x.slot),'ends_at',upper(x.slot)) ORDER BY lower(x.slot))
          FROM team_training x JOIN campus_resource r ON (r.institution_id,r.id)=(x.institution_id,x.venue_id)
          WHERE (x.institution_id,x.team_id)=(t.institution_id,t.id) AND upper(x.slot) > clock_timestamp()),'[]') ELSE '[]' END AS training
      FROM sport_team t LEFT JOIN department d ON (d.institution_id,d.id)=(t.institution_id,t.department_id) LEFT JOIN "user" cu ON cu.id=t.coach_id
      LEFT JOIN team_player mp ON (mp.institution_id,mp.team_id)=(t.institution_id,t.id) AND mp.student_id=$2
      WHERE t.institution_id=$1 AND ${member} ORDER BY t.external,t.sport,t.name`, params),
    db.query<{ id: string; name: string; sport: string; level: string; starts_on: string; ends_on: string; entries: { id: string; name: string }[] }>(`SELECT s.id,s.name,s.sport,s.level,
        to_char(s.starts_on,'YYYY-MM-DD') AS starts_on,to_char(s.ends_on,'YYYY-MM-DD') AS ends_on,
        coalesce((SELECT json_agg(json_build_object('id',t.id,'name',t.name) ORDER BY t.name) FROM tournament_entry e JOIN sport_team t ON (t.institution_id,t.id)=(e.institution_id,e.team_id)
          WHERE (e.institution_id,e.tournament_id)=(s.institution_id,s.id)),'[]') AS entries
      FROM sport_tournament s WHERE s.institution_id=$1 AND ${member} ORDER BY s.starts_on DESC`, params),
    db.query<Fixture>(`SELECT f.id,f.tournament_id,s.name AS tournament,h.name AS home,a.name AS away,f.home_team_id,f.away_team_id,r.name AS venue,ou.name AS official,f.official_id,
        lower(f.slot) AS starts_at,upper(f.slot) AS ends_at,f.state,f.home_score,f.away_score,f.result_reason,f.revision,
        coalesce((SELECT json_agg(json_build_object('id',p.student_id,'name',pu.name) ORDER BY pu.name) FROM fixture_participant p JOIN "user" pu ON pu.id=p.student_id
          WHERE (p.institution_id,p.fixture_id)=(f.institution_id,f.id)),'[]') AS participants
      FROM sport_fixture f JOIN sport_tournament s ON (s.institution_id,s.id)=(f.institution_id,f.tournament_id)
      JOIN sport_team h ON (h.institution_id,h.id)=(f.institution_id,f.home_team_id) JOIN sport_team a ON (a.institution_id,a.id)=(f.institution_id,f.away_team_id)
      JOIN campus_resource r ON (r.institution_id,r.id)=(f.institution_id,f.venue_id) JOIN "user" ou ON ou.id=f.official_id
      WHERE f.institution_id=$1 AND f.state<>'cancelled' AND ${member} ORDER BY lower(f.slot)`, params),
    standingsQuery(scope),
  ]);
  return { teams: teams.rows, tournaments: tournaments.rows, fixtures: fixtures.rows, standings };
}

/** SP-011: three points for a win, one for a draw, from completed fixtures only. */
async function standingsQuery(scope: Scope) {
  return (await db.query<Standing>(`WITH sides AS (
      SELECT f.institution_id,f.tournament_id,f.home_team_id AS team_id,f.home_score AS gf,f.away_score AS ga FROM sport_fixture f WHERE f.institution_id=$1 AND f.state='completed'
      UNION ALL SELECT f.institution_id,f.tournament_id,f.away_team_id,f.away_score,f.home_score FROM sport_fixture f WHERE f.institution_id=$1 AND f.state='completed')
    SELECT e.tournament_id,t.name AS team,count(s.team_id)::int AS played,count(*) FILTER (WHERE s.gf>s.ga)::int AS won,count(*) FILTER (WHERE s.gf=s.ga)::int AS drawn,
      count(*) FILTER (WHERE s.gf<s.ga)::int AS lost,coalesce(sum(s.gf),0)::int AS scored,coalesce(sum(s.ga),0)::int AS conceded,
      (3*count(*) FILTER (WHERE s.gf>s.ga)+count(*) FILTER (WHERE s.gf=s.ga))::int AS points
    FROM tournament_entry e JOIN sport_team t ON (t.institution_id,t.id)=(e.institution_id,e.team_id)
    LEFT JOIN sides s ON (s.institution_id,s.tournament_id,s.team_id)=(e.institution_id,e.tournament_id,e.team_id)
    WHERE e.institution_id=$1 AND EXISTS (SELECT 1 FROM membership me WHERE me.institution_id=$1 AND me.account_id=$2 AND me.role=$3 AND me.ended_at IS NULL)
    GROUP BY e.tournament_id,t.name ORDER BY e.tournament_id,points DESC,(coalesce(sum(s.gf),0)-coalesce(sum(s.ga),0)) DESC,t.name`,
  [scope.institution, scope.account, scope.role])).rows;
}

const tournamentInput = z.object({ name: text(160), sport: text(60), level: z.enum(["intramural", "interdepartmental", "intercollege"]),
  starts_on: z.iso.date(), ends_on: z.iso.date() }).refine(v => v.ends_on >= v.starts_on, { message: "The end date cannot be before the start date." });
export function createTournament(scope: Scope, raw: unknown) {
  const input = tournamentInput.parse(raw);
  return transaction(async client => {
    await requireAdmin(client, scope);
    try {
      const { rows: [row] } = await client.query<{ id: string }>(`INSERT INTO sport_tournament (institution_id,name,sport,level,starts_on,ends_on,created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [scope.institution, input.name, input.sport, input.level, input.starts_on, input.ends_on, scope.account]);
      await audit(client, scope, row.id, "sport.tournament_created");
      return row.id;
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw new WorkflowError("A tournament with this name already exists.");
      throw error;
    }
  });
}

const teamInput = z.object({ sport: text(60), name: text(120), department: z.uuid().optional(), external: z.boolean() });
export function createTeam(scope: Scope, raw: unknown) {
  const input = teamInput.parse(raw);
  if (input.external && input.department) throw new WorkflowError("An external opponent has no department.");
  return transaction(async client => {
    await requireAdmin(client, scope);
    try {
      const { rows: [row] } = await client.query<{ id: string }>(`INSERT INTO sport_team (institution_id,sport,name,department_id,external,created_by)
        SELECT $1,$2,$3,$4::uuid,$5,$6 WHERE $4::uuid IS NULL OR EXISTS (SELECT 1 FROM department WHERE institution_id=$1 AND id=$4::uuid) RETURNING id`,
      [scope.institution, input.sport, input.name, input.department ?? null, input.external, scope.account]);
      if (!row) throw new WorkflowError("Choose a department of this institution.");
      await audit(client, scope, row.id, input.external ? "sport.opponent_added" : "sport.team_created");
      return row.id;
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw new WorkflowError("A team with this name already exists for the sport.");
      throw error;
    }
  });
}

async function lockTeam(client: PoolClient, scope: Scope, id: string) {
  const { rows: [team] } = await client.query<{ external: boolean; coach_id: string | null; department_id: string | null }>(
    "SELECT external,coach_id,department_id FROM sport_team WHERE institution_id=$1 AND id=$2 FOR UPDATE", [scope.institution, id]);
  if (!team) throw unavailable();
  return team;
}

/** SP-005: the office assigns a current teacher as coach. */
export function assignCoach(scope: Scope, raw: unknown) {
  const input = z.object({ team: z.uuid(), coach: z.string().min(1).max(100) }).parse(raw);
  return transaction(async client => {
    await requireAdmin(client, scope);
    const team = await lockTeam(client, scope, input.team);
    if (team.external) throw new WorkflowError("External opponents have no coach here.");
    const { rowCount } = await client.query("SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role IN ('faculty','hod') AND ended_at IS NULL",
      [scope.institution, input.coach]);
    if (!rowCount) throw new WorkflowError("Choose a current teacher as coach.");
    await client.query("UPDATE sport_team SET coach_id=$3 WHERE institution_id=$1 AND id=$2", [scope.institution, input.team, input.coach]);
    await audit(client, scope, input.team, "sport.coach_assigned", undefined, input.coach);
  });
}

async function requireCoach(client: PoolClient, scope: Scope, teamId: string) {
  const team = await lockTeam(client, scope, teamId);
  const coachRole = scope.role === "faculty" || scope.role === "hod";
  if (!coachRole || team.coach_id !== scope.account || !(await holds(client, scope, scope.role))) throw unavailable();
  return team;
}

/** SP-004: the coach opens or closes trials for their team. */
export function setTrials(scope: Scope, raw: unknown) {
  const input = z.object({ team: z.uuid(), open: z.boolean() }).parse(raw);
  return transaction(async client => {
    await requireCoach(client, scope, input.team);
    await client.query("UPDATE sport_team SET trials_open=$3 WHERE institution_id=$1 AND id=$2", [scope.institution, input.team, input.open]);
    await audit(client, scope, input.team, input.open ? "sport.trials_opened" : "sport.trials_closed");
  });
}

/** SP-004 / SP-015: an eligible student requests a trial while trials are open; the refusal says what to correct. */
export function requestTrial(scope: Scope, id: unknown) {
  const teamId = z.uuid().parse(id);
  return transaction(async client => {
    if (!(await holds(client, scope, "student"))) throw unavailable();
    const { rows: [team] } = await client.query<{ trials_open: boolean; eligible: boolean; department: string | null }>(
      `SELECT t.trials_open,${eligibleSql("t", "$3")} AS eligible,d.name AS department FROM sport_team t
       LEFT JOIN department d ON (d.institution_id,d.id)=(t.institution_id,t.department_id) WHERE t.institution_id=$1 AND t.id=$2 FOR SHARE OF t`,
      [scope.institution, teamId, scope.account]);
    if (!team || !team.trials_open) throw new WorkflowError("Trials are not open for this team.");
    if (!team.eligible) throw new WorkflowError(`Only students currently taking a ${team.department ?? "listed"} course can try out. Ask the office if your enrolment is missing.`);
    const added = await client.query("INSERT INTO team_player (institution_id,team_id,student_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [scope.institution, teamId, scope.account]);
    if (!added.rowCount) throw new WorkflowError("You already asked for a trial with this team.");
    await audit(client, scope, teamId, "sport.trial_requested");
  });
}

/** SP-003 / SP-004: the coach selects or declines a requested player, with a reason; a still-eligible player only. */
export function decideTrial(scope: Scope, raw: unknown) {
  const input = z.object({ team: z.uuid(), student: z.string().min(1).max(100), decision: z.enum(["selected", "declined"]), reason: text(500) }).parse(raw);
  return transaction(async client => {
    await requireCoach(client, scope, input.team);
    const { rows: [row] } = await client.query<{ eligible: boolean }>(`SELECT ${eligibleSql("t", "p.student_id")} AS eligible FROM team_player p
      JOIN sport_team t ON (t.institution_id,t.id)=(p.institution_id,p.team_id)
      WHERE p.institution_id=$1 AND p.team_id=$2 AND p.student_id=$3 AND p.state='requested' FOR UPDATE OF p`, [scope.institution, input.team, input.student]);
    if (!row) throw new WorkflowError("This request is unavailable or already decided.");
    if (input.decision === "selected" && !row.eligible) throw new WorkflowError("This student is no longer eligible for the team.");
    await client.query(`UPDATE team_player SET state=$4,reason=$5,decided_by=$6,decided_at=clock_timestamp()
      WHERE institution_id=$1 AND team_id=$2 AND student_id=$3`, [scope.institution, input.team, input.student, input.decision, input.reason, scope.account]);
    await audit(client, scope, input.team, `sport.player_${input.decision}`, undefined, input.student);
  });
}

/** SP-008 / SP-020 / SP-021: entries follow the tournament level. */
export function enterTeam(scope: Scope, raw: unknown) {
  const input = z.object({ tournament: z.uuid(), team: z.uuid() }).parse(raw);
  return transaction(async client => {
    await requireAdmin(client, scope);
    const { rows: [t] } = await client.query<{ level: string; sport: string }>("SELECT level,sport FROM sport_tournament WHERE institution_id=$1 AND id=$2",
      [scope.institution, input.tournament]);
    const team = await lockTeam(client, scope, input.team);
    const { rows: [{ sport }] } = await client.query("SELECT sport FROM sport_team WHERE institution_id=$1 AND id=$2", [scope.institution, input.team]);
    if (!t) throw unavailable();
    if (sport !== t.sport) throw new WorkflowError("The team plays a different sport.");
    if (team.external && t.level !== "intercollege") throw new WorkflowError("External opponents can only enter intercollege tournaments.");
    if (t.level === "interdepartmental" && !team.department_id) throw new WorkflowError("Interdepartmental tournaments take department teams only.");
    const added = await client.query("INSERT INTO tournament_entry (institution_id,tournament_id,team_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
      [scope.institution, input.tournament, input.team]);
    if (!added.rowCount) throw new WorkflowError("The team is already entered.");
    await audit(client, scope, input.team, "sport.team_entered");
  });
}

const slotInput = { start: z.iso.datetime({ local: true }), minutes: z.coerce.number().int().min(15).max(480) };
const range = (start: string, minutes: number) => `[${start}+05:30,${new Date(new Date(`${start}+05:30`).getTime() + minutes * 60000).toISOString()})`;

/** Selected players of the given teams who have a published class during the slot (SP-009 academic conflicts). */
async function classClashes(client: PoolClient, scope: Scope, teams: string[], slot: string) {
  const { rows: [row] } = await client.query<{ n: number }>(`SELECT count(DISTINCT p.student_id)::int AS n FROM team_player p
    JOIN roster r ON r.institution_id=p.institution_id AND r.account_id=p.student_id AND r.role='student' AND r.ended_at IS NULL
    JOIN class_session s ON (s.institution_id,s.offering_id)=(r.institution_id,r.offering_id) AND s.state IN ('published','conducted') AND s.slot && $3::tstzrange
    WHERE p.institution_id=$1 AND p.team_id=ANY($2) AND p.state='selected'`, [scope.institution, teams, slot]);
  return row.n;
}

/** SP-007 / SP-009 / SP-023: the office schedules a fixture between two entries with a venue and a current staff official. */
export function scheduleFixture(scope: Scope, raw: unknown) {
  const input = z.object({ tournament: z.uuid(), home: z.uuid(), away: z.uuid(), venue: z.uuid(), official: z.string().min(1).max(100), ...slotInput }).parse(raw);
  if (input.home === input.away) throw new WorkflowError("Choose two different teams.");
  const slot = range(input.start, input.minutes);
  return transaction(async client => {
    await requireAdmin(client, scope);
    const { rows: entries } = await client.query("SELECT team_id FROM tournament_entry WHERE institution_id=$1 AND tournament_id=$2 AND team_id IN ($3,$4)",
      [scope.institution, input.tournament, input.home, input.away]);
    if (entries.length !== 2) throw new WorkflowError("Both teams must be entered in the tournament.");
    if (!(await isStaff(client, scope, input.official))) throw new WorkflowError("Choose a current staff member as official.");
    const { rowCount: venue } = await client.query("SELECT 1 FROM campus_resource WHERE institution_id=$1 AND id=$2 AND kind='room'", [scope.institution, input.venue]);
    if (!venue) throw new WorkflowError("Choose a venue.");
    const { rowCount: busy } = await client.query(`SELECT 1 FROM sport_fixture WHERE institution_id=$1 AND state<>'cancelled' AND slot && $2::tstzrange
      AND (home_team_id IN ($3,$4) OR away_team_id IN ($3,$4))`, [scope.institution, slot, input.home, input.away]);
    if (busy) throw new WorkflowError("One of the teams already has a fixture at that time.");
    const clashes = await classClashes(client, scope, [input.home, input.away], slot);
    if (clashes) throw new WorkflowError(`${clashes} selected ${clashes === 1 ? "player has" : "players have"} a class at that time. Choose another slot.`);
    try {
      const { rows: [row] } = await client.query<{ id: string }>(`INSERT INTO sport_fixture (institution_id,tournament_id,home_team_id,away_team_id,venue_id,official_id,slot,created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7::tstzrange,$8) RETURNING id`, [scope.institution, input.tournament, input.home, input.away, input.venue, input.official, slot, scope.account]);
      await audit(client, scope, row.id, "sport.fixture_scheduled");
      return row.id;
    } catch (error) {
      if ((error as { code?: string }).code === "23P01") throw new WorkflowError("The venue is already in use at that time.");
      throw error;
    }
  });
}

/** SP-010 / SP-023: only the assigned official records a result after the start; any revision needs a reason. */
export function recordResult(scope: Scope, raw: unknown) {
  const input = z.object({ fixture: z.uuid(), home: z.coerce.number().int().min(0).max(999), away: z.coerce.number().int().min(0).max(999),
    reason: z.string().trim().max(500).optional() }).parse(raw);
  return transaction(async client => {
    const { rows: [f] } = await client.query<{ state: string; official_id: string; started: boolean; revision: number }>(
      "SELECT state,official_id,lower(slot) <= clock_timestamp() AS started,revision FROM sport_fixture WHERE institution_id=$1 AND id=$2 FOR UPDATE",
      [scope.institution, input.fixture]);
    if (!f || f.official_id !== scope.account || f.state === "cancelled" || !(await holds(client, scope, scope.role))) throw unavailable();
    if (!f.started) throw new WorkflowError("Results can be recorded once the match has started.");
    const revising = f.state === "completed";
    if (revising && !input.reason) throw new WorkflowError("Give a reason to revise a recorded result.");
    await client.query(`UPDATE sport_fixture SET state='completed',home_score=$3,away_score=$4,result_reason=$5,result_by=$6,result_at=clock_timestamp(),revision=revision+$7
      WHERE institution_id=$1 AND id=$2`, [scope.institution, input.fixture, input.home, input.away, revising ? input.reason : null, scope.account, revising ? 1 : 0]);
    await audit(client, scope, input.fixture, revising ? "sport.result_revised" : "sport.result_recorded", f.revision + (revising ? 1 : 0));
  });
}

/** SP-016: the official verifies who actually played, from the two teams' selected players, after the result. */
export function verifyParticipation(scope: Scope, raw: unknown) {
  const input = z.object({ fixture: z.uuid(), students: z.array(z.string().min(1).max(100)).min(1).max(60) }).parse(raw);
  return transaction(async client => {
    const { rows: [f] } = await client.query<{ state: string; official_id: string; home_team_id: string; away_team_id: string }>(
      "SELECT state,official_id,home_team_id,away_team_id FROM sport_fixture WHERE institution_id=$1 AND id=$2 FOR UPDATE", [scope.institution, input.fixture]);
    if (!f || f.official_id !== scope.account || !(await holds(client, scope, scope.role))) throw unavailable();
    if (f.state !== "completed") throw new WorkflowError("Record the result first.");
    const { rows } = await client.query<{ student_id: string }>(`SELECT student_id FROM team_player WHERE institution_id=$1 AND team_id IN ($2,$3)
      AND state='selected' AND student_id=ANY($4)`, [scope.institution, f.home_team_id, f.away_team_id, input.students]);
    if (rows.length !== new Set(input.students).size) throw new WorkflowError("Only selected players of the two teams can be verified.");
    for (const { student_id } of rows) await client.query(`INSERT INTO fixture_participant (institution_id,fixture_id,student_id,verified_by) VALUES ($1,$2,$3,$4)
      ON CONFLICT DO NOTHING`, [scope.institution, input.fixture, student_id, scope.account]);
    await audit(client, scope, input.fixture, "sport.participation_verified");
  });
}

/** SP-006: the coach publishes a training session at a free venue; team members see it. */
export function addTraining(scope: Scope, raw: unknown) {
  const input = z.object({ team: z.uuid(), venue: z.uuid(), ...slotInput }).parse(raw);
  const slot = range(input.start, input.minutes);
  return transaction(async client => {
    await requireCoach(client, scope, input.team);
    const { rowCount } = await client.query("SELECT 1 FROM campus_resource WHERE institution_id=$1 AND id=$2 AND kind='room'", [scope.institution, input.venue]);
    if (!rowCount) throw new WorkflowError("Choose a venue.");
    try {
      const { rows: [row] } = await client.query<{ id: string }>(`INSERT INTO team_training (institution_id,team_id,venue_id,slot,created_by)
        VALUES ($1,$2,$3,$4::tstzrange,$5) RETURNING id`, [scope.institution, input.team, input.venue, slot, scope.account]);
      await audit(client, scope, row.id, "sport.training_added");
      return row.id;
    } catch (error) {
      if ((error as { code?: string }).code === "23P01") throw new WorkflowError("The venue already has a training session at that time.");
      throw error;
    }
  });
}

/** SP-019: the coach posts an update that only selected players, the coach and the office read. */
export function announce(scope: Scope, raw: unknown) {
  const input = z.object({ team: z.uuid(), body: text(1000) }).parse(raw);
  return transaction(async client => {
    await requireCoach(client, scope, input.team);
    const { rows: [row] } = await client.query<{ id: string }>("INSERT INTO team_announcement (institution_id,team_id,author_id,body) VALUES ($1,$2,$3,$4) RETURNING id",
      [scope.institution, input.team, scope.account, input.body]);
    await audit(client, scope, row.id, "sport.announcement_posted");
  });
}

/** Choices for the office's forms. */
export async function sportsChoices(scope: Scope) {
  if (scope.role !== "admin") return { venues: [], staff: [], teachers: [], departments: [] };
  const [venues, staff, departments] = await Promise.all([
    db.query<{ id: string; name: string }>("SELECT id,name FROM campus_resource WHERE institution_id=$1 AND kind='room' ORDER BY name", [scope.institution]),
    db.query<{ id: string; name: string; role: string }>(`SELECT DISTINCT ON (u.id) u.id,u.name,m.role FROM membership m JOIN "user" u ON u.id=m.account_id
      WHERE m.institution_id=$1 AND m.role IN ('faculty','hod','admin') AND m.ended_at IS NULL ORDER BY u.id,m.role`, [scope.institution]),
    db.query<{ id: string; name: string }>("SELECT id,name FROM department WHERE institution_id=$1 ORDER BY name", [scope.institution]),
  ]);
  return { venues: venues.rows, staff: staff.rows, teachers: staff.rows.filter(s => s.role !== "admin"), departments: departments.rows };
}

export async function venues(scope: Scope) {
  return (await db.query<{ id: string; name: string }>("SELECT id,name FROM campus_resource WHERE institution_id=$1 AND kind='room' ORDER BY name", [scope.institution])).rows;
}
