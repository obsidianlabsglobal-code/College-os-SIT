// covers: FC-010, ID-004, ID-006
import "../scripts/environment";
import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { db } from "../lib/db";
import { updateGrade, WorkflowError } from "../lib/assignments";
import { rubric, rubricScores, scoreByRubric, setRubric } from "../lib/rubrics";
import { fixtures, demoEmail, personas } from "../scripts/fixtures";
import type { Scope } from "../lib/scope";

const owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const as = new Map<string, Scope>();
const i = fixtures.institution;
const ids = { assignment: randomUUID(), submission: randomUUID() };
const rejects = (run: () => Promise<unknown>, pattern?: RegExp) =>
  assert.rejects(async () => run(), (e: unknown) => (e instanceof WorkflowError || (e as Error).name === "ZodError") && (!pattern || pattern.test((e as Error).message)));

before(async () => {
  for (const url of [process.env.MIGRATION_DATABASE_URL, process.env.DATABASE_URL]) assert.ok(url && ["127.0.0.1", "localhost"].includes(new URL(url).hostname));
  for (const [alias, [, , role]] of Object.entries(personas)) {
    const { rows: [row] } = await owner.query('SELECT id FROM "user" WHERE email=$1', [demoEmail(alias)]);
    as.set(alias, { account: row.id, role, institution: alias === "tenant" ? fixtures.otherInstitution : fixtures.institution });
  }
  await owner.query(`INSERT INTO assignment (institution_id,id,offering_id,title,description,deadline,max_marks)
    VALUES ($1,$2,$3,'Rubric lab','Fictional',now()+interval '3 days',10)`, [i, ids.assignment, fixtures.offering]);
});
after(async () => {
  await owner.query("DELETE FROM criterion_score WHERE institution_id=$1 AND submission_id=$2", [i, ids.submission]);
  await owner.query("DELETE FROM grade WHERE institution_id=$1 AND submission_id=$2", [i, ids.submission]);
  await owner.query("DELETE FROM submission WHERE institution_id=$1 AND id=$2", [i, ids.submission]);
  await owner.query("DELETE FROM rubric_criterion WHERE institution_id=$1 AND assignment_id=$2", [i, ids.assignment]);
  await owner.query("DELETE FROM job WHERE institution_id=$1 AND event_id IN (SELECT id FROM audit_event WHERE institution_id=$1 AND entity_id IN ($2,$3))", [i, ids.assignment, ids.submission]);
  await owner.query("DELETE FROM assignment WHERE institution_id=$1 AND id=$2", [i, ids.assignment]);
  await Promise.all([db.end(), owner.end()]);
});

test("the course teacher sets criteria that add up to the maximum; students read them once the assignment is published", async () => {
  const faculty = as.get("faculty")!, student = as.get("student")!;
  const criteria = [{ name: "Correctness", points: 6, descriptor: "All tests pass" }, { name: "Explanation", points: 4 }];
  await rejects(() => setRubric(faculty, { assignment: ids.assignment, criteria: [{ name: "Only", points: 7 }] }), /add up to 7; they must add up to the maximum of 10/);
  await rejects(() => setRubric(as.get("replacement")!, { assignment: ids.assignment, criteria }));
  await rejects(() => setRubric(student, { assignment: ids.assignment, criteria }));
  await setRubric(faculty, { assignment: ids.assignment, criteria });
  assert.deepEqual((await rubric(faculty, ids.assignment)).map(c => [c.position, c.name, c.points]), [[1, "Correctness", 6], [2, "Explanation", 4]]);
  assert.deepEqual(await rubric(student, ids.assignment), [], "not visible while the assignment is a draft");
  await owner.query("UPDATE assignment SET published_at=now() WHERE institution_id=$1 AND id=$2", [i, ids.assignment]);
  assert.equal((await rubric(student, ids.assignment)).length, 2);
  assert.deepEqual(await rubric(as.get("outsider")!, ids.assignment), [], "another section's student cannot read it");
  assert.deepEqual(await rubric({ ...as.get("tenant")!, role: "faculty" }, ids.assignment), []);
});

test("scoring by criterion saves a grade draft with the total; the student sees the breakdown only once published", async () => {
  const faculty = as.get("faculty")!, student = as.get("student")!;
  await owner.query(`INSERT INTO submission (institution_id,id,assignment_id,student_id,body,submitted_at,request_id)
    VALUES ($1,$2,$3,$4,'Fictional',now(),gen_random_uuid())`, [i, ids.submission, ids.assignment, student.account]);
  const [correct, explain] = await rubric(faculty, ids.assignment);
  const base = { assignment: ids.assignment, submission: ids.submission, expected: 0, expectedDraft: false, feedback: "Good work; explain edge cases." };
  await rejects(() => scoreByRubric(faculty, { ...base, scores: [{ criterion: correct.id, points: 5 }] }), /every criterion/);
  await rejects(() => scoreByRubric(faculty, { ...base, scores: [{ criterion: correct.id, points: 7 }, { criterion: explain.id, points: 3 }] }), /Correctness is out of 6/);
  await rejects(() => scoreByRubric(student, { ...base, scores: [{ criterion: correct.id, points: 5 }, { criterion: explain.id, points: 3 }] }));
  assert.equal(await scoreByRubric(faculty, { ...base, scores: [{ criterion: correct.id, points: 5, comment: "One test fails" }, { criterion: explain.id, points: 3 }] }), 8);
  const { rows: [g] } = await owner.query("SELECT marks,published_at FROM grade WHERE institution_id=$1 AND submission_id=$2 AND revision=1", [i, ids.submission]);
  assert.deepEqual([g.marks, g.published_at], [8, null]);
  assert.deepEqual((await rubricScores(faculty, ids.submission)).map(s => [s.name, s.points, s.max, s.comment]), [["Correctness", 5, 6, "One test fails"], ["Explanation", 3, 4, ""]]);
  assert.deepEqual(await rubricScores(student, ids.submission), [], "nothing before publication");
  await rejects(() => setRubric(faculty, { assignment: ids.assignment, criteria: [{ name: "All", points: 10 }] }), /once marking has started/);
  await updateGrade(faculty, { assignment: ids.assignment, submission: ids.submission, expected: 1, expectedDraft: true, publish: true });
  assert.deepEqual((await rubricScores(student, ids.submission)).map(s => s.points), [5, 3]);
  assert.deepEqual(await rubricScores(as.get("outsider")!, ids.submission), [], "nobody else reads the breakdown");
  // A correction is a new revision with its own scores and a reason; the student keeps seeing the published one until it is published.
  await rejects(() => scoreByRubric(faculty, { ...base, expected: 1, scores: [{ criterion: correct.id, points: 6 }, { criterion: explain.id, points: 3 }] }), /reason/);
  await scoreByRubric(faculty, { ...base, expected: 1, reason: "Re-ran the failing test", scores: [{ criterion: correct.id, points: 6 }, { criterion: explain.id, points: 3 }] });
  assert.deepEqual((await rubricScores(student, ids.submission)).map(s => s.points), [5, 3]);
  assert.deepEqual((await rubricScores(faculty, ids.submission)).map(s => s.points), [6, 3]);
});
