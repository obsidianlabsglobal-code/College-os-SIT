// covers: DH-007, DH-004, LE-004, FC-017, FC-018, ID-009, ID-004, ID-006
import "../scripts/environment";
import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { Pool } from "pg";
import { db } from "../lib/db";
import { WorkflowError } from "../lib/assignments";
import { allocationProposals, decideAllocation, departmentSchemes, offboard, proposeAllocation } from "../lib/allocation";
import { addMilestone, createTeam, projectTeams, reviewEvidence, submitEvidence, unteamedStudents } from "../lib/teams";
import { qualityIndicators } from "../lib/reporting";
import { fixtures, demoEmail, personas } from "../scripts/fixtures";
import type { Scope } from "../lib/scope";

const owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const as = new Map<string, Scope>();
const i = fixtures.institution, offering = fixtures.offering;
const rejects = (run: () => Promise<unknown>, pattern?: RegExp) =>
  assert.rejects(async () => run(), (e: unknown) => (e instanceof WorkflowError || (e as Error).name === "ZodError") && (!pattern || pattern.test((e as Error).message)));

before(async () => {
  for (const url of [process.env.MIGRATION_DATABASE_URL, process.env.DATABASE_URL]) assert.ok(url && ["127.0.0.1", "localhost"].includes(new URL(url).hostname));
  for (const [alias, [, , role]] of Object.entries(personas)) {
    const { rows: [row] } = await owner.query('SELECT id FROM "user" WHERE email=$1', [demoEmail(alias)]);
    as.set(alias, { account: row.id, role, institution: alias === "tenant" ? fixtures.otherInstitution : fixtures.institution });
  }
});
after(async () => {
  await owner.query("DELETE FROM milestone_evidence WHERE institution_id=$1 AND offering_id=$2", [i, offering]);
  await owner.query("DELETE FROM team_milestone WHERE institution_id=$1 AND offering_id=$2", [i, offering]);
  await owner.query("DELETE FROM team_member WHERE institution_id=$1 AND offering_id=$2", [i, offering]);
  await owner.query("DELETE FROM project_team WHERE institution_id=$1 AND offering_id=$2", [i, offering]);
  await owner.query("DELETE FROM allocation_proposal WHERE institution_id=$1 AND offering_id=$2", [i, offering]);
  await owner.query("DELETE FROM roster WHERE institution_id=$1 AND offering_id=$2 AND account_id=$3 AND role='faculty'", [i, offering, as.get("replacement")!.account]);
  await Promise.all([db.end(), owner.end()]);
});

test("a department head proposes a teacher and the office approves, which adds them to the course", async () => {
  const hod = as.get("hod")!, admin = as.get("admin")!, replacement = as.get("replacement")!.account;
  for (const alias of ["faculty", "admin", "principal"]) await rejects(() => proposeAllocation(as.get(alias)!, { offering, faculty: replacement, reason: "x" }));
  await rejects(() => proposeAllocation(hod, { offering: fixtures.otherDepartmentOffering, faculty: replacement, reason: "Other department" }));
  await rejects(() => proposeAllocation(hod, { offering, faculty: as.get("faculty")!.account, reason: "Already teaches" }), /already teaches/);
  await rejects(() => proposeAllocation(hod, { offering, faculty: as.get("student")!.account, reason: "Not faculty" }), /current faculty/);
  const rejected = await proposeAllocation(hod, { offering, faculty: replacement, reason: "Cover for leave" });
  await rejects(() => proposeAllocation(hod, { offering, faculty: replacement, reason: "Again" }), /awaiting/);
  await rejects(() => decideAllocation(hod, { proposal: rejected, decision: "approve", reason: "Self-approval" }));
  await decideAllocation(admin, { proposal: rejected, decision: "reject", reason: "Leave cancelled" });
  await rejects(() => decideAllocation(admin, { proposal: rejected, decision: "approve", reason: "Twice" }), /already been decided/);
  const roster = () => owner.query("SELECT 1 FROM roster WHERE institution_id=$1 AND offering_id=$2 AND account_id=$3 AND role='faculty' AND ended_at IS NULL", [i, offering, replacement]);
  assert.equal((await roster()).rowCount, 0, "a rejection changes no roster");
  const approved = await proposeAllocation(hod, { offering, faculty: replacement, reason: "Second section load" });
  await decideAllocation(admin, { proposal: approved, decision: "approve", reason: "Within workload limits" });
  assert.equal((await roster()).rowCount, 1);
  const seen = await allocationProposals(hod);
  assert.deepEqual(seen.filter(p => [rejected, approved].includes(p.id)).map(p => p.state).sort(), ["approved", "rejected"]);
  assert.deepEqual(await allocationProposals(as.get("faculty")!), []);
  assert.deepEqual(await allocationProposals({ ...as.get("tenant")!, role: "admin" }), []);
  await owner.query("DELETE FROM roster WHERE institution_id=$1 AND offering_id=$2 AND account_id=$3 AND role='faculty'", [i, offering, replacement]);
});

test("project teams: formed from the roster, one team per student, with milestone evidence reviewed by the teacher", async () => {
  const faculty = as.get("faculty")!, student = as.get("student")!;
  assert.ok((await unteamedStudents(faculty, offering)).some(s => s.id === student.account));
  assert.deepEqual(await unteamedStudents(as.get("replacement")!, offering).then(r => r.length), 0, "only this course's teachers see the roster");
  await rejects(() => createTeam(faculty, { offering, name: "Outsiders", students: [as.get("outsider")!.account] }), /currently enrolled/);
  await rejects(() => createTeam(as.get("student")!, { offering, name: "Self-made", students: [student.account] }));
  const team = await createTeam(faculty, { offering, name: "Robotics", students: [student.account] });
  await rejects(() => createTeam(faculty, { offering, name: "Second team", students: [student.account] }), /already in a team/);
  const due = new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(Date.now() + 7 * 86400000)) + "T17:00";
  const milestone = await addMilestone(faculty, { offering, title: "Design review", due });
  await rejects(() => submitEvidence(as.get("outsider")!, { milestone, body: "Not my team" }));
  const first = await submitEvidence(student, { milestone, body: "Draft design document" });
  await rejects(() => reviewEvidence(as.get("replacement")!, { evidence: first, decision: "accepted", note: "Not my course" }));
  await reviewEvidence(faculty, { evidence: first, decision: "changes_requested", note: "Add a parts list" });
  await rejects(() => reviewEvidence(faculty, { evidence: first, decision: "accepted", note: "Twice" }), /already been reviewed/);
  const second = await submitEvidence(student, { milestone, body: "Design document with parts list" });
  await reviewEvidence(faculty, { evidence: second, decision: "accepted", note: "Approved for build" });
  const mine = await projectTeams(student, offering);
  assert.deepEqual([mine.teams.map(t => t.id), mine.teams[0].evidence[0].review, mine.milestones.length], [[team], "accepted", 1]);
  assert.ok((await projectTeams(as.get("hod")!, offering)).teams.some(t => t.id === team));
  for (const alias of ["outsider", "replacement", "admin", "principal"]) assert.deepEqual((await projectTeams(as.get(alias)!, offering)).teams.filter(t => t.id === team), []);
});

test("offboarding ends every post, roster and mentoring pairing in one step and reports work needing a new owner", async () => {
  const admin = as.get("admin")!, person = as.get("outsider")!.account;
  await rejects(() => offboard(as.get("principal")!, person));
  await rejects(() => offboard(admin, admin.account));
  const memberships = (await owner.query("SELECT id FROM membership WHERE institution_id=$1 AND account_id=$2 AND ended_at IS NULL", [i, person])).rows.map(r => r.id);
  const rosters = (await owner.query("SELECT offering_id,role FROM roster WHERE institution_id=$1 AND account_id=$2 AND ended_at IS NULL", [i, person])).rows;
  const { rows: [pair] } = await owner.query("INSERT INTO mentor_assignment (institution_id,mentor_id,student_id,assigned_by) VALUES ($1,$2,$3,$4) RETURNING id",
    [i, as.get("faculty")!.account, person, admin.account]);
  try {
    const effects = await offboard(admin, person);
    assert.deepEqual([effects.memberships, effects.rosters, effects.mentoring], [memberships.length, rosters.length, 1]);
    assert.equal((await owner.query("SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND ended_at IS NULL", [i, person])).rowCount, 0);
    await rejects(() => offboard(admin, person), /no current post/);
    assert.equal((await owner.query("SELECT 1 FROM audit_event WHERE institution_id=$1 AND action='account.offboarded' AND subject_id=$2", [i, person])).rowCount! >= 1, true);
  } finally {
    await owner.query("UPDATE membership SET ended_at=NULL WHERE id=ANY($1)", [memberships]);
    for (const r of rosters) await owner.query("UPDATE roster SET ended_at=NULL WHERE institution_id=$1 AND offering_id=$2 AND account_id=$3 AND role=$4", [i, r.offering_id, person, r.role]);
    await owner.query("DELETE FROM mentor_assignment WHERE institution_id=$1 AND id=$2", [i, pair.id]);
  }
});

test("department schemes and quality indicators are scoped and carry definitions", async () => {
  const schemes = await departmentSchemes(as.get("hod")!);
  assert.ok(schemes.some(r => r.course === "Introduction to Programming" && r.sections.includes("Section A")));
  assert.ok(!schemes.some(r => r.course === "Engineering Mechanics"), "another department's courses are excluded");
  for (const alias of ["faculty", "admin", "principal", "student"]) assert.deepEqual(await departmentSchemes(as.get(alias)!), []);
  const quality = await qualityIndicators(as.get("principal")!);
  assert.equal(quality.length, 7);
  assert.ok(quality.every(q => q.value && q.definition && q.limitation));
  assert.ok((await qualityIndicators(as.get("admin")!)).length === 7);
  for (const alias of ["faculty", "hod", "student"]) assert.deepEqual(await qualityIndicators(as.get(alias)!), []);
  assert.deepEqual(await qualityIndicators({ ...as.get("tenant")!, role: "principal" }), []);
});
