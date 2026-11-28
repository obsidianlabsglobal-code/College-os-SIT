// covers: FC-025, DH-016, DH-017, FC-021, LE-012, LE-015, LE-005, AD-008, ID-004, ID-006
import "../scripts/environment";
import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { db } from "../lib/db";
import { WorkflowError } from "../lib/assignments";
import { addDevelopmentRecord, addResearchMilestone, completeResearchMilestone, decideDevelopmentRecord, decideProject, developmentRecords,
  proposeProject, researchProjects } from "../lib/faculty-records";
import { campusOperations, resourcePlanning } from "../lib/reporting";
import { catalogHistory, renameCatalog } from "../lib/academics";
import { closeCase, assignCase, openCase, reopenCase } from "../lib/cases";
import { fixtures, demoEmail, personas } from "../scripts/fixtures";
import type { Scope } from "../lib/scope";

const owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const as = new Map<string, Scope>();
const i = fixtures.institution;
const tag = randomUUID().slice(0, 8);
const rejects = (run: () => Promise<unknown>, pattern?: RegExp) =>
  assert.rejects(async () => run(), (e: unknown) => (e instanceof WorkflowError || (e as Error).name === "ZodError") && (!pattern || pattern.test((e as Error).message)));
const today = () => new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date());

before(async () => {
  for (const url of [process.env.MIGRATION_DATABASE_URL, process.env.DATABASE_URL]) assert.ok(url && ["127.0.0.1", "localhost"].includes(new URL(url).hostname));
  for (const [alias, [, , role]] of Object.entries(personas)) {
    const { rows: [row] } = await owner.query('SELECT id FROM "user" WHERE email=$1', [demoEmail(alias)]);
    as.set(alias, { account: row.id, role, institution: alias === "tenant" ? fixtures.otherInstitution : fixtures.institution });
  }
});
after(async () => {
  await owner.query("DELETE FROM development_record WHERE institution_id=$1 AND title LIKE $2", [i, `% ${tag}`]);
  await owner.query("DELETE FROM research_milestone WHERE institution_id=$1 AND project_id IN (SELECT id FROM research_project WHERE institution_id=$1 AND title LIKE $2)", [i, `% ${tag}`]);
  await owner.query("DELETE FROM research_project WHERE institution_id=$1 AND title LIKE $2", [i, `% ${tag}`]);
  const caseIds = (await owner.query("SELECT id FROM case_record WHERE institution_id=$1 AND title LIKE $2", [i, `% ${tag}`])).rows.map(r => r.id);
  await owner.query("DELETE FROM notification WHERE institution_id=$1 AND entity_id=ANY($2)", [i, caseIds]);
  await owner.query("DELETE FROM job WHERE institution_id=$1 AND event_id IN (SELECT id FROM audit_event WHERE institution_id=$1 AND entity_id=ANY($2))", [i, caseIds]);
  await owner.query("DELETE FROM case_note WHERE institution_id=$1 AND case_id=ANY($2)", [i, caseIds]);
  await owner.query("DELETE FROM case_record WHERE institution_id=$1 AND id=ANY($2)", [i, caseIds]);
  await Promise.all([db.end(), owner.end()]);
});

test("development records are verified by an HOD of a department the teacher teaches in", async () => {
  const faculty = as.get("faculty")!, hod = as.get("hod")!;
  await rejects(() => addDevelopmentRecord(faculty, { department: fixtures.otherDepartment, title: `x ${tag}`, completed: today(), hours: 2, evidence: "x" }));
  await rejects(() => addDevelopmentRecord(faculty, { department: fixtures.department, title: `Future ${tag}`, completed: "2099-01-01", hours: 2, evidence: "x" }));
  await rejects(() => addDevelopmentRecord(hod, { department: fixtures.department, title: `x ${tag}`, completed: today(), hours: 2, evidence: "x" }));
  const id = await addDevelopmentRecord(faculty, { department: fixtures.department, title: `Workshop ${tag}`, completed: today(), hours: 6, evidence: "Fictional certificate 42" });
  await rejects(() => decideDevelopmentRecord(as.get("principal")!, { record: id, decision: "verify", reason: "No" }));
  await decideDevelopmentRecord(hod, { record: id, decision: "verify", reason: "Certificate checked" });
  await rejects(() => decideDevelopmentRecord(hod, { record: id, decision: "return", reason: "Twice" }), /not awaiting/);
  assert.equal((await developmentRecords(faculty)).find(r => r.id === id)?.state, "verified");
  assert.ok((await developmentRecords(hod)).some(r => r.id === id));
  for (const alias of ["replacement", "student", "admin", "principal"]) assert.ok(!(await developmentRecords(as.get(alias)!)).some(r => r.id === id));
});

test("research projects: HOD approval, disclosure to the institution, milestones with evidence, completion", async () => {
  const faculty = as.get("faculty")!, hod = as.get("hod")!, principal = as.get("principal")!;
  await rejects(() => proposeProject(faculty, { department: fixtures.otherDepartment, title: `x ${tag}`, summary: "x" }));
  const internal = await proposeProject(faculty, { department: fixtures.department, title: `Edge sensing ${tag}`, summary: "Fictional low-cost sensors" });
  const shared = await proposeProject(faculty, { department: fixtures.department, title: `Campus energy ${tag}`, summary: "Fictional metering study" });
  await rejects(() => addResearchMilestone(faculty, { project: internal, title: "Too early", due: today() }));
  await decideProject(hod, { project: internal, decision: "approve", reason: "In scope", disclosure: "department" });
  await decideProject(hod, { project: shared, decision: "approve", reason: "In scope", disclosure: "institution" });
  const seen = (await researchProjects(principal)).map(p => p.id);
  assert.ok(seen.includes(shared) && !seen.includes(internal), "only institution-disclosed projects reach the principal");
  await rejects(() => addResearchMilestone(as.get("replacement")!, { project: shared, title: "Not lead", due: today() }));
  await addResearchMilestone(faculty, { project: shared, title: "Sensor survey", due: today() });
  const milestone = (await researchProjects(faculty)).find(p => p.id === shared)!.milestones[0];
  await completeResearchMilestone(faculty, { milestone: milestone.id, evidence: "Fictional survey report" });
  assert.equal((await researchProjects(principal)).find(p => p.id === shared)?.state, "completed");
  assert.deepEqual(await researchProjects(as.get("student")!), []);
});

test("campus operations show open and reopened repairs; room planning reports scheduled hours", async () => {
  const admin = as.get("admin")!, faculty = as.get("faculty")!, principal = as.get("principal")!;
  const before = (await campusOperations(principal))!;
  const id = await openCase(faculty, { kind: "facility", title: `Leaking tap ${tag}`, body: "Fictional" });
  await assignCase(admin, { case: id, assignee: admin.account });
  await closeCase(admin, { case: id, outcome: "resolved", reason: "Washer replaced" });
  await reopenCase(faculty, { case: id, reason: "Leaks again" });
  const after = (await campusOperations(principal))!;
  assert.deepEqual([after.open - before.open, after.reopened_open - before.reopened_open], [1, 1]);
  assert.ok(after.critical.some(c => c.id === id && c.reopened === 1));
  for (const alias of ["faculty", "hod", "student"]) assert.equal(await campusOperations(as.get(alias)!), null);
  const planning = (await resourcePlanning(principal))!;
  assert.ok(Array.isArray(planning.rooms) && planning.rooms.every(r => r.hours >= 0));
  assert.equal(await resourcePlanning(as.get("hod")!), null);
  assert.equal(await resourcePlanning({ ...as.get("tenant")!, role: "principal" }), null);
});

test("course and section name corrections keep the previous name and reason", async () => {
  const admin = as.get("admin")!;
  const { rows: [course] } = await owner.query("SELECT id,name FROM course WHERE institution_id=$1 AND id=$2", [i, fixtures.course]);
  await rejects(() => renameCatalog(as.get("hod")!, { entity: "course", id: fixtures.course, name: "x", reason: "x" }));
  await rejects(() => renameCatalog(admin, { entity: "course", id: fixtures.course, name: course.name, reason: "Same" }), /No change/);
  await rejects(() => renameCatalog(admin, { entity: "course", id: "not-a-uuid", name: "x", reason: "x" }));
  try {
    await renameCatalog(admin, { entity: "course", id: fixtures.course, name: `${course.name} (corrected ${tag})`, reason: "Typo in the scheme document" });
    const history = await catalogHistory(admin);
    assert.deepEqual([history[0].old_name, history[0].reason], [course.name, "Typo in the scheme document"]);
    assert.deepEqual(await catalogHistory(as.get("principal")!), []);
  } finally {
    await owner.query("UPDATE course SET name=$3 WHERE institution_id=$1 AND id=$2", [i, fixtures.course, course.name]);
    await owner.query("DELETE FROM catalog_name_change WHERE institution_id=$1 AND new_name LIKE $2", [i, `% ${tag})`]);
  }
});
