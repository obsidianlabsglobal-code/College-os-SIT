// covers: LE-014, AD-028, CR-002, CR-007, CR-008, CR-009, CR-010, CR-013, CR-015, CR-016, CR-031, CR-032, CR-033, ID-004, ID-006
import "../scripts/environment";
import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { db } from "../lib/db";
import { WorkflowError } from "../lib/assignments";
import { changeOpportunity, opportunities } from "../lib/opportunities";
import { eligibility, myApplications, placementApplicants, placementOutcomes, recordOutcome, resumeDraft, saveApplication, trackListing, withdrawApplication } from "../lib/careers";
import { fixtures, demoEmail, personas } from "../scripts/fixtures";
import type { Scope } from "../lib/scope";

const owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const as = new Map<string, Scope>();
const i = fixtures.institution;
const tag = randomUUID().slice(0, 8);
const ids = { drive: randomUUID(), mech: randomUUID(), hack: randomUUID(), closed: randomUUID() };
const rejects = (run: () => Promise<unknown>, pattern?: RegExp) =>
  assert.rejects(async () => run(), (e: unknown) => (e instanceof WorkflowError || (e as Error).name === "ZodError") && (!pattern || pattern.test((e as Error).message)));
const inDays = (d: number) => new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(Date.now() + d * 86400000));
const listing = (id: string, kind: string, title: string, department?: string) => ({ operation: "publish", id, kind, title: `${title} ${tag}`, sponsor: "Fictional Labs",
  eligibility: "Fictional requirement", source: "https://example.org/listing", deadline: inDays(10), verified: "on", department });

before(async () => {
  for (const url of [process.env.MIGRATION_DATABASE_URL, process.env.DATABASE_URL]) assert.ok(url && ["127.0.0.1", "localhost"].includes(new URL(url).hostname));
  for (const [alias, [, , role]] of Object.entries(personas)) {
    const { rows: [row] } = await owner.query('SELECT id FROM "user" WHERE email=$1', [demoEmail(alias)]);
    as.set(alias, { account: row.id, role, institution: alias === "tenant" ? fixtures.otherInstitution : fixtures.institution });
  }
});
after(async () => {
  const listings = Object.values(ids);
  await owner.query("DELETE FROM opportunity_application WHERE institution_id=$1 AND listing_id=ANY($2)", [i, listings]);
  await owner.query("DELETE FROM opportunity_listing WHERE institution_id=$1 AND id=ANY($2)", [i, listings]);
  await Promise.all([db.end(), owner.end()]);
});

test("the office publishes new listing kinds, optionally limited to a department", async () => {
  const admin = as.get("admin")!;
  await changeOpportunity(admin, listing(ids.drive, "placement", "Campus drive", fixtures.department));
  await changeOpportunity(admin, listing(ids.mech, "job", "Design engineer", fixtures.otherDepartment));
  await changeOpportunity(admin, listing(ids.hack, "hackathon", "Civic hack", ""));
  await rejects(() => changeOpportunity(admin, listing(randomUUID(), "fellowship", "x", randomUUID())), /department exists/);
  await rejects(() => changeOpportunity(admin, listing(randomUUID(), "bounty", "x")));
  await owner.query(`INSERT INTO opportunity_listing (institution_id,id,kind,title,sponsor,eligibility,source_url,deadline,verified_by)
    VALUES ($1,$2,'research','Closed lab ${tag}','Fictional','x','https://example.org',current_date-1,$3)`, [i, ids.closed, admin.account]);
  const found = (await opportunities(as.get("student")!, { query: tag, page: 1 })).rows;
  assert.deepEqual(found.map(r => r.kind).sort(), ["hackathon", "job", "placement"], "students see open listings only");
  assert.equal(found.find(r => r.id === ids.drive)?.department, "Electronics and Communication Engineering");
});

test("eligibility explains what is met and what to correct", async () => {
  const student = as.get("student")!;
  assert.deepEqual(await eligibility(student, ids.drive), { eligible: true, explanation: "You currently take a Electronics and Communication Engineering course." });
  const other = await eligibility(student, ids.mech);
  assert.equal(other?.eligible, false);
  assert.match(other!.explanation, /ask the office to correct it/);
  assert.equal(await eligibility(student, randomUUID()), null);
});

test("a student tracks, drafts and submits; ineligible or closed listings cannot be submitted", async () => {
  const student = as.get("student")!;
  await rejects(() => trackListing(as.get("faculty")!, ids.drive));
  await rejects(() => trackListing(student, ids.closed), /closed/);
  await rejects(() => trackListing({ ...as.get("tenant")!, role: "student" }, ids.drive), /closed or unavailable/);
  await trackListing(student, ids.drive);
  await trackListing(student, ids.mech);
  await trackListing(student, ids.hack);
  await rejects(() => trackListing(student, ids.drive), /already track/);
  await saveApplication(student, { listing: ids.drive, statement: "Draft one", submit: false });
  await rejects(() => saveApplication(student, { listing: ids.drive, statement: "", submit: true }), /statement/);
  await rejects(() => saveApplication(student, { listing: ids.mech, statement: "Keen", submit: true }), /requirement/);
  await saveApplication(student, { listing: ids.drive, statement: "I built a fictional radio.", submit: true });
  await rejects(() => saveApplication(student, { listing: ids.drive, statement: "Edit after", submit: false }), /Only a saved/);
  await withdrawApplication(student, ids.hack);
  await rejects(() => withdrawApplication(student, ids.hack), /no longer/);
  const mine = await myApplications(student);
  assert.deepEqual(mine.map(a => [a.title.replace(` ${tag}`, ""), a.state]).filter(([t]) => ["Campus drive", "Design engineer", "Civic hack"].includes(t)).sort(),
    [["Campus drive", "submitted"], ["Civic hack", "withdrawn"], ["Design engineer", "saved"]]);
  assert.deepEqual(await myApplications(as.get("admin")!), []);
});

test("the office records placement outcomes in order; only offers count in the outcome summary", async () => {
  const admin = as.get("admin")!, student = as.get("student")!;
  const before = (await placementOutcomes(admin)).find(o => o.department === "Electronics and Communication Engineering")?.students_offered ?? 0;
  assert.ok((await placementApplicants(admin)).some(a => a.listing_id === ids.drive && a.student_id === student.account));
  assert.deepEqual(await placementApplicants(as.get("principal")!), []);
  await rejects(() => recordOutcome(admin, { listing: ids.drive, student: student.account, outcome: "offered", note: "Skipping" }), /already decided/);
  await rejects(() => recordOutcome(as.get("hod")!, { listing: ids.drive, student: student.account, outcome: "shortlisted", note: "x" }));
  await rejects(() => recordOutcome(admin, { listing: ids.hack, student: student.account, outcome: "shortlisted", note: "x" }), /unavailable/);
  await recordOutcome(admin, { listing: ids.drive, student: student.account, outcome: "shortlisted", note: "Interview on Monday" });
  assert.equal((await placementOutcomes(as.get("principal")!)).find(o => o.department === "Electronics and Communication Engineering")?.students_offered, before);
  await recordOutcome(admin, { listing: ids.drive, student: student.account, outcome: "offered", note: "Offer letter issued by the employer" });
  assert.equal((await placementOutcomes(admin)).find(o => o.department === "Electronics and Communication Engineering")?.students_offered, before + 1);
  assert.equal((await myApplications(student)).find(a => a.listing_id === ids.drive)?.outcome_note, "Offer letter issued by the employer");
  await rejects(() => withdrawApplication(student, ids.drive), /no longer/);
  assert.deepEqual(await placementOutcomes(student), []);
});

test("the résumé draft uses only the student's own profile and chosen verified records", async () => {
  const draft = await resumeDraft(as.get("student")!);
  assert.match(draft!, /^Asha Sen\n/);
  assert.match(draft!, /Verified record/);
  assert.equal(await resumeDraft(as.get("faculty")!), null);
});
