// covers: DH-012, DH-013, FC-014, SA-019, ID-004, ID-006
import "../scripts/environment";
import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { db } from "../lib/db";
import { WorkflowError } from "../lib/assignments";
import { addProgrammeOutcome, courseOutcomes, decideCourseOutcome, myOutcomeEvidence, offeringAttainment, programmeAttainment, proposeCourseOutcome, tagAssessment } from "../lib/outcomes";
import { fixtures, demoEmail, personas } from "../scripts/fixtures";
import type { Scope } from "../lib/scope";

const owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const as = new Map<string, Scope>();
const i = fixtures.institution;
const ids = { strong: randomUUID(), weak: randomUUID(), draft: randomUUID() };
const rejects = (run: () => Promise<unknown>, pattern?: RegExp) =>
  assert.rejects(async () => run(), (e: unknown) => (e instanceof WorkflowError || (e as Error).name === "ZodError") && (!pattern || pattern.test((e as Error).message)));
const po = { a: "", b: "" }, co = { one: "", two: "", returned: "" };

before(async () => {
  for (const url of [process.env.MIGRATION_DATABASE_URL, process.env.DATABASE_URL]) assert.ok(url && ["127.0.0.1", "localhost"].includes(new URL(url).hostname));
  for (const [alias, [, , role]] of Object.entries(personas)) {
    const { rows: [row] } = await owner.query('SELECT id FROM "user" WHERE email=$1', [demoEmail(alias)]);
    as.set(alias, { account: row.id, role, institution: alias === "tenant" ? fixtures.otherInstitution : fixtures.institution });
  }
  // Two published assessments for the student: 8/10 on one, 3/10 on the other; a third with an unpublished grade.
  for (const [id, marks, published] of [[ids.strong, 8, true], [ids.weak, 3, true], [ids.draft, 10, false]] as const) {
    await owner.query(`INSERT INTO assignment (institution_id,id,offering_id,title,description,deadline,max_marks,published_at)
      VALUES ($1,$2,$3,$4,'Fictional',now()-interval '2 days',10,now()-interval '5 days')`, [i, id, fixtures.offering, `Outcome check ${id.slice(0, 6)}`]);
    const { rows: [s] } = await owner.query(`INSERT INTO submission (institution_id,assignment_id,student_id,body,submitted_at,request_id)
      VALUES ($1,$2,$3,'Fictional',now()-interval '3 days',gen_random_uuid()) RETURNING id`, [i, id, as.get("student")!.account]);
    await owner.query(`INSERT INTO grade (institution_id,submission_id,revision,marks,feedback,published_at) VALUES ($1,$2,1,$3,'Fictional',$4)`,
      [i, s.id, marks, published ? new Date() : null]);
  }
});
after(async () => {
  const assignments = Object.values(ids);
  await owner.query("DELETE FROM assessment_outcome WHERE institution_id=$1 AND assignment_id=ANY($2)", [i, assignments]);
  await owner.query("DELETE FROM grade WHERE institution_id=$1 AND submission_id IN (SELECT id FROM submission WHERE institution_id=$1 AND assignment_id=ANY($2))", [i, assignments]);
  await owner.query("DELETE FROM submission WHERE institution_id=$1 AND assignment_id=ANY($2)", [i, assignments]);
  await owner.query("DELETE FROM job WHERE institution_id=$1 AND event_id IN (SELECT id FROM audit_event WHERE institution_id=$1 AND entity_id=ANY($2))", [i, assignments]);
  await owner.query("DELETE FROM assignment WHERE institution_id=$1 AND id=ANY($2)", [i, assignments]);
  await owner.query("DELETE FROM outcome_mapping WHERE institution_id=$1 AND course_outcome_id IN (SELECT id FROM course_outcome WHERE institution_id=$1 AND code IN ('CO91','CO92'))", [i]);
  await owner.query("DELETE FROM course_outcome WHERE institution_id=$1 AND code IN ('CO91','CO92')", [i]);
  await owner.query("DELETE FROM programme_outcome WHERE institution_id=$1 AND code IN ('PO91','PO92')", [i]);
  await Promise.all([db.end(), owner.end()]);
});

test("the office defines programme outcomes; a course teacher proposes mapped course outcomes; the HOD decides", async () => {
  const admin = as.get("admin")!, faculty = as.get("faculty")!, hod = as.get("hod")!;
  await rejects(() => addProgrammeOutcome(faculty, { code: "PO91", statement: "x" }));
  await rejects(() => addProgrammeOutcome(admin, { code: "P91", statement: "x" }));
  po.a = await addProgrammeOutcome(admin, { code: "PO91", statement: "Apply engineering knowledge (fictional)" });
  po.b = await addProgrammeOutcome(admin, { code: "PO92", statement: "Communicate effectively (fictional)" });
  await rejects(() => addProgrammeOutcome(admin, { code: "PO91", statement: "x" }), /already exists/);
  const proposal = (code: string, mapping = [{ outcome: po.a, level: 3 }, { outcome: po.b, level: 1 }]) => ({ course: fixtures.course, code, statement: `Fictional ${code}`, mapping });
  await rejects(() => proposeCourseOutcome(as.get("replacement")!, proposal("CO91")), /currently teach/);
  await rejects(() => proposeCourseOutcome(faculty, proposal("CO91", [{ outcome: randomUUID(), level: 2 }])), /defined by the office/);
  await rejects(() => proposeCourseOutcome(faculty, proposal("CO91", [{ outcome: po.a, level: 2 }, { outcome: po.a, level: 1 }])), /once/);
  co.one = await proposeCourseOutcome(faculty, proposal("CO91"));
  co.returned = await proposeCourseOutcome(faculty, proposal("CO92"));
  await rejects(() => proposeCourseOutcome(faculty, proposal("CO91")), /already has/);
  await rejects(() => decideCourseOutcome(faculty, { outcome: co.one, decision: "approved", reason: "x" }));
  await decideCourseOutcome(hod, { outcome: co.one, decision: "approved", reason: "Measurable and mapped" });
  await decideCourseOutcome(hod, { outcome: co.returned, decision: "returned", reason: "Too broad" });
  await rejects(() => decideCourseOutcome(hod, { outcome: co.one, decision: "returned", reason: "x" }), /already decided/);
  co.two = await proposeCourseOutcome(faculty, proposal("CO92", [{ outcome: po.b, level: 3 }]));
  await decideCourseOutcome(hod, { outcome: co.two, decision: "approved", reason: "Revised" });
  const seen = (await courseOutcomes(faculty)).filter(k => ["CO91", "CO92"].includes(k.code));
  assert.deepEqual(seen.map(k => [k.code, k.state]).sort(), [["CO91", "approved"], ["CO92", "approved"], ["CO92", "returned"]]);
  assert.deepEqual(seen.find(k => k.id === co.one)!.mapping, [{ code: "PO91", level: 3 }, { code: "PO92", level: 1 }]);
  assert.ok(!(await courseOutcomes(as.get("replacement")!)).some(k => k.id === co.one));
  assert.ok(!(await courseOutcomes({ ...as.get("tenant")!, role: "admin" })).some(k => k.id === co.one));
});

test("teachers tag assessments with approved outcomes; attainment uses published marks only", async () => {
  const faculty = as.get("faculty")!;
  await rejects(() => tagAssessment(faculty, { assignment: ids.strong, outcome: co.returned, tagged: true }), /approved outcome/);
  await rejects(() => tagAssessment(as.get("replacement")!, { assignment: ids.strong, outcome: co.one, tagged: true }), /approved outcome/);
  await tagAssessment(faculty, { assignment: ids.strong, outcome: co.one, tagged: true });
  await tagAssessment(faculty, { assignment: ids.weak, outcome: co.two, tagged: true });
  await tagAssessment(faculty, { assignment: ids.draft, outcome: co.two, tagged: true });
  const rows = (await offeringAttainment(faculty, fixtures.offering))!.filter(r => ["CO91", "CO92"].includes(r.code));
  assert.deepEqual(rows.map(r => [r.code, r.assessed, r.attained, r.percent, r.level]), [["CO91", 1, 1, 100, 3], ["CO92", 1, 0, 0, 0]],
    "the unpublished 10/10 does not lift CO92");
  const po = (await programmeAttainment(as.get("hod")!, fixtures.offering))!.filter(p => ["PO91", "PO92"].includes(p.code));
  assert.deepEqual(po, [{ code: "PO91", level: 3 }, { code: "PO92", level: 0.75 }], "PO92 = (1×3 + 3×0) / 4");
  assert.equal(await offeringAttainment(as.get("replacement")!, fixtures.offering), null);
  assert.equal(await offeringAttainment(as.get("student")!, fixtures.offering), null);
  assert.equal(await offeringAttainment(as.get("admin")!, fixtures.offering), null);
  assert.ok(await offeringAttainment(as.get("principal")!, fixtures.offering));
  await tagAssessment(faculty, { assignment: ids.draft, outcome: co.two, tagged: false });
});

test("a student sees only their own outcome evidence", async () => {
  const mine = (await myOutcomeEvidence(as.get("student")!)).filter(e => ["CO91", "CO92"].includes(e.code));
  assert.deepEqual(mine.map(e => [e.code, e.percent, e.attained]), [["CO91", 80, true], ["CO92", 30, false]]);
  assert.deepEqual((await myOutcomeEvidence(as.get("outsider")!)).filter(e => ["CO91", "CO92"].includes(e.code)), []);
  assert.deepEqual(await myOutcomeEvidence(as.get("faculty")!), []);
});
