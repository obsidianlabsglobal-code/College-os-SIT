// covers: SL-002, AD-033, SP-001, SP-003, SP-004, SP-005, SP-006, SP-007, SP-008, SP-009, SP-010, SP-011, SP-015, SP-016, SP-017, SP-018, SP-019, SP-020, SP-021, SP-023, ID-004, ID-006
import "../scripts/environment";
import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { db } from "../lib/db";
import { WorkflowError } from "../lib/assignments";
import { addTraining, announce, assignCoach, createTeam, createTournament, decideTrial, enterTeam, recordResult, requestTrial, scheduleFixture, setTrials,
  sportsOverview, verifyParticipation } from "../lib/sports";
import { portfolioCandidates, setPortfolioItem } from "../lib/student-life";
import { notifications, runJobs } from "../lib/automation";
import { fixtures, demoEmail, personas } from "../scripts/fixtures";
import type { Scope } from "../lib/scope";

const owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const as = new Map<string, Scope>();
const i = fixtures.institution;
const tag = randomUUID().slice(0, 8);
const sport = `Football ${tag}`;
const ids = { ground: randomUUID(), court: randomUUID(), session: randomUUID() };
const rejects = (run: () => Promise<unknown>, pattern?: RegExp) =>
  assert.rejects(async () => run(), (e: unknown) => (e instanceof WorkflowError || (e as Error).name === "ZodError") && (!pattern || pattern.test((e as Error).message)));
const local = (hours: number) => new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Kolkata" })
  .format(new Date(Date.now() + hours * 3600000)).replace(" ", "T");
const team = { ece: "", mech: "", open: "", rival: "" };
let cup = "", league = "";

before(async () => {
  for (const url of [process.env.MIGRATION_DATABASE_URL, process.env.DATABASE_URL]) assert.ok(url && ["127.0.0.1", "localhost"].includes(new URL(url).hostname));
  for (const [alias, [, , role]] of Object.entries(personas)) {
    const { rows: [row] } = await owner.query('SELECT id FROM "user" WHERE email=$1', [demoEmail(alias)]);
    as.set(alias, { account: row.id, role, institution: alias === "tenant" ? fixtures.otherInstitution : fixtures.institution });
  }
  for (const [id, name] of [[ids.ground, `Ground ${tag}`], [ids.court, `Court ${tag}`]])
    await owner.query("INSERT INTO campus_resource (institution_id,id,name,kind,location) VALUES ($1,$2,$3,'room','Fictional')", [i, id, name]);
  // A published class for the student's offering, 50–52 hours from now, for the academic-clash check.
  await owner.query(`INSERT INTO class_session (institution_id,id,series_id,offering_id,section_id,faculty_id,room_id,slot,state,created_by,published_at)
    SELECT $1,$2,gen_random_uuid(),$3,o.section_id,$4,$5,tstzrange(now()+interval '50 hours',now()+interval '52 hours'),'published',$4,now()
    FROM offering o WHERE o.institution_id=$1 AND o.id=$3`, [i, ids.session, fixtures.offering, as.get("faculty")!.account, ids.court]);
});
after(async () => {
  const teamIds = (await owner.query("SELECT id FROM sport_team WHERE institution_id=$1 AND sport=$2", [i, sport])).rows.map(r => r.id);
  await owner.query("DELETE FROM notification WHERE institution_id=$1 AND entity_id=ANY($2)", [i, teamIds]);
  await owner.query("DELETE FROM job WHERE institution_id=$1 AND event_id IN (SELECT id FROM audit_event WHERE institution_id=$1 AND entity_id=ANY($2))", [i, teamIds]);
  const fixtureIds = (await owner.query("SELECT id FROM sport_fixture WHERE institution_id=$1 AND home_team_id=ANY($2)", [i, teamIds])).rows.map(r => r.id);
  await owner.query("DELETE FROM portfolio_item WHERE institution_id=$1 AND source='participation' AND source_id=ANY($2)", [i, fixtureIds]);
  await owner.query("DELETE FROM fixture_participant WHERE institution_id=$1 AND fixture_id=ANY($2)", [i, fixtureIds]);
  await owner.query("DELETE FROM sport_fixture WHERE institution_id=$1 AND id=ANY($2)", [i, fixtureIds]);
  for (const table of ["team_training", "team_announcement", "team_player", "tournament_entry"])
    await owner.query(`DELETE FROM ${table} WHERE institution_id=$1 AND team_id=ANY($2)`, [i, teamIds]);
  await owner.query("DELETE FROM sport_team WHERE institution_id=$1 AND id=ANY($2)", [i, teamIds]);
  await owner.query("DELETE FROM sport_tournament WHERE institution_id=$1 AND sport=$2", [i, sport]);
  await owner.query("DELETE FROM class_session WHERE institution_id=$1 AND id=$2", [i, ids.session]);
  await owner.query("DELETE FROM campus_resource WHERE institution_id=$1 AND id IN ($2,$3)", [i, ids.ground, ids.court]);
  await Promise.all([db.end(), owner.end()]);
});

test("the office creates tournaments and teams; entries follow the tournament level", async () => {
  const admin = as.get("admin")!;
  for (const alias of ["student", "faculty", "hod", "principal"]) await rejects(() => createTournament(as.get(alias)!, { name: `x ${tag}`, sport, level: "intramural", starts_on: "2026-12-01", ends_on: "2026-12-31" }));
  await rejects(() => createTournament(admin, { name: `x ${tag}`, sport, level: "intramural", starts_on: "2026-12-31", ends_on: "2026-12-01" }));
  league = await createTournament(admin, { name: `Department league ${tag}`, sport, level: "interdepartmental", starts_on: "2026-11-01", ends_on: "2027-01-31" });
  cup = await createTournament(admin, { name: `Intercollege cup ${tag}`, sport, level: "intercollege", starts_on: "2026-11-01", ends_on: "2027-01-31" });
  team.ece = await createTeam(admin, { sport, name: `ECE ${tag}`, department: fixtures.department, external: false });
  team.mech = await createTeam(admin, { sport, name: `Other dept ${tag}`, department: fixtures.otherDepartment, external: false });
  team.open = await createTeam(admin, { sport, name: `College XI ${tag}`, external: false });
  team.rival = await createTeam(admin, { sport, name: `Rival College ${tag}`, external: true });
  await rejects(() => createTeam(admin, { sport, name: `ECE ${tag}`, external: false }), /already exists/);
  await rejects(() => createTeam(admin, { sport, name: `x ${tag}`, department: fixtures.department, external: true }), /no department/);
  await rejects(() => enterTeam(admin, { tournament: league, team: team.rival }), /intercollege/);
  await rejects(() => enterTeam(admin, { tournament: league, team: team.open }), /department teams/);
  await enterTeam(admin, { tournament: league, team: team.ece });
  await enterTeam(admin, { tournament: league, team: team.mech });
  await rejects(() => enterTeam(admin, { tournament: league, team: team.ece }), /already entered/);
  await enterTeam(admin, { tournament: cup, team: team.open });
  await enterTeam(admin, { tournament: cup, team: team.rival });
  assert.ok(!(await sportsOverview({ ...as.get("tenant")!, role: "admin" })).teams.some(t => t.id === team.ece), "other tenants see nothing");
});

test("a coach runs trials for an eligible student, then training and announcements only the squad reads", async () => {
  const admin = as.get("admin")!, coach = as.get("faculty")!, student = as.get("student")!;
  await rejects(() => assignCoach(admin, { team: team.ece, coach: student.account }), /current teacher/);
  await assignCoach(admin, { team: team.ece, coach: coach.account });
  await assignCoach(admin, { team: team.mech, coach: coach.account });
  await assignCoach(admin, { team: team.open, coach: coach.account });
  await rejects(() => setTrials(as.get("replacement")!, { team: team.ece, open: true }));
  await rejects(() => requestTrial(student, team.ece), /not open/);
  for (const t of [team.ece, team.mech, team.open]) await setTrials(coach, { team: t, open: true });
  await rejects(() => requestTrial(student, team.mech), /Only students currently taking/);
  assert.equal((await sportsOverview(student)).teams.find(t => t.id === team.mech)?.eligible, false);
  await requestTrial(student, team.ece);
  await requestTrial(student, team.open);
  await rejects(() => requestTrial(student, team.ece), /already asked/);
  await rejects(() => requestTrial(coach, team.ece));
  await rejects(() => decideTrial(admin, { team: team.ece, student: student.account, decision: "selected", reason: "x" }));
  await decideTrial(coach, { team: team.ece, student: student.account, decision: "selected", reason: "Strong first touch" });
  await decideTrial(coach, { team: team.open, student: student.account, decision: "selected", reason: "Squad depth" });
  await rejects(() => decideTrial(coach, { team: team.ece, student: student.account, decision: "declined", reason: "x" }), /already decided/);
  const mine = (await sportsOverview(student)).teams.find(t => t.id === team.ece)!;
  assert.equal(mine.my_state, "selected");
  assert.deepEqual(mine.requests, [], "students do not see other requests");
  await addTraining(coach, { team: team.ece, venue: ids.ground, start: local(30), minutes: 60 });
  await rejects(() => addTraining(coach, { team: team.open, venue: ids.ground, start: local(30), minutes: 60 }), /already has a training/);
  await announce(coach, { team: team.ece, body: `Kit check on Friday ${tag}` });
  await rejects(() => announce(as.get("student")!, { team: team.ece, body: "x" }));
  const read = (await sportsOverview(student)).teams.find(t => t.id === team.ece)!;
  assert.equal(read.training.length, 1);
  assert.ok(read.announcements.some(a => a.body.includes(tag)));
  const outsider = (await sportsOverview(as.get("outsider")!)).teams.find(t => t.id === team.ece)!;
  assert.deepEqual([outsider.training, outsider.announcements], [[], []], "non-members of the squad read neither");
  // SP-004: the selection reaches the student's inbox through the automation outbox.
  for (let n = 0; n < 50 && Object.values(await runJobs({ worker: "sports-test" })).some(Boolean); n++);
  const inbox = (await notifications(student)).filter(x => x.kind === "sport");
  assert.ok(inbox.some(x => x.entity_id === team.ece && x.title === `You were selected for ECE ${tag}`));
  assert.ok(!(await notifications(as.get("outsider")!)).some(x => x.entity_id === team.ece));
});

test("fixtures check entries, venue, team and class clashes; only the official records and revises results", async () => {
  const admin = as.get("admin")!, coach = as.get("faculty")!, student = as.get("student")!;
  const base = { tournament: league, home: team.ece, away: team.mech, venue: ids.ground, official: coach.account, minutes: 90 };
  await rejects(() => scheduleFixture(admin, { ...base, away: team.open, start: local(10) }), /entered/);
  await rejects(() => scheduleFixture(admin, { ...base, official: student.account, start: local(10) }), /staff member/);
  await rejects(() => scheduleFixture(admin, { ...base, start: local(50) }), /1 selected player has a class/);
  await rejects(() => scheduleFixture(coach, { ...base, start: local(-3) }));
  const played = await scheduleFixture(admin, { ...base, start: local(-3) });
  await rejects(() => scheduleFixture(admin, { ...base, start: local(-2.5) }), /already has a fixture/);
  await rejects(() => scheduleFixture(admin, { ...base, tournament: cup, home: team.open, away: team.rival, start: local(-2.5) }), /venue is already in use/);
  const future = await scheduleFixture(admin, { ...base, start: local(5) });
  await rejects(() => recordResult(coach, { fixture: future, home: 1, away: 0 }), /once the match has started/);
  await rejects(() => recordResult(admin, { fixture: played, home: 2, away: 1 }));
  await recordResult(coach, { fixture: played, home: 2, away: 1 });
  await rejects(() => recordResult(coach, { fixture: played, home: 2, away: 2 }), /reason/);
  await recordResult(coach, { fixture: played, home: 2, away: 2, reason: "Late equaliser confirmed on review" });
  const f = (await sportsOverview(student)).fixtures.find(x => x.id === played)!;
  assert.deepEqual([f.home_score, f.away_score, f.revision, f.result_reason], [2, 2, 2, "Late equaliser confirmed on review"]);
  const table = (await sportsOverview(student)).standings.filter(s => s.tournament_id === league);
  assert.deepEqual(table.map(s => [s.played, s.drawn, s.points]), [[1, 1, 1], [1, 1, 1]], "the future fixture does not count");
});

test("the official verifies who played; the student may add it to their portfolio", async () => {
  const coach = as.get("faculty")!, student = as.get("student")!;
  const played = (await sportsOverview(coach)).fixtures.find(f => f.home_team_id === team.ece && f.state === "completed")!;
  await rejects(() => verifyParticipation(coach, { fixture: played.id, students: [as.get("outsider")!.account] }), /selected players/);
  await rejects(() => verifyParticipation(as.get("admin")!, { fixture: played.id, students: [student.account] }));
  await verifyParticipation(coach, { fixture: played.id, students: [student.account] });
  assert.deepEqual((await sportsOverview(student)).fixtures.find(f => f.id === played.id)!.participants.map(p => p.name), ["Asha Sen"]);
  assert.ok((await portfolioCandidates(student)).some(e => e.source === "participation" && e.source_id === played.id));
  await setPortfolioItem(student, { source: "participation", id: played.id, include: true });
  await rejects(() => setPortfolioItem(as.get("outsider")!, { source: "participation", id: played.id, include: true }), /verified records/);
});
