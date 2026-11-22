import "../scripts/environment";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createAssignment, files, publishAssignment, submissionPreview, submissions, submitAssignment, updateGrade } from "../lib/assignments";
import { assignmentProgress, evaluationQueue, evaluationTotals, gradingAssignments, nextAwaitingEvaluation } from "../lib/faculty";
import { db } from "../lib/db";
import type { Scope } from "../lib/scope";
import { fixtures as f, demoEmail } from "../scripts/fixtures";

// Synthetic engineering data only. Each run creates its own section, offering and
// labelled synthetic students so assertions are isolated from other suites and earlier runs.

const owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const people: Record<string, string> = {};
const run = randomUUID().slice(0, 8);
let offering = "";
const students: Scope[] = [];
const viewer = (alias: string, role: Scope["role"], institution = f.institution): Scope => ({ account: people[alias], role, institution });
const future = () => new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Kolkata" })
  .format(new Date(Date.now() + 86_400_000)).replace(" ", "T");

async function publishedAssignment(title = `Queue ${run} ${randomUUID().slice(0, 6)}`) {
  const id = await createAssignment(viewer("faculty", "faculty"), { offering, title, description: "Synthetic task.", deadline: future(), marks: 20, file: null });
  await publishAssignment(viewer("faculty", "faculty"), id);
  return id;
}

async function submitAll(assignment: string, count: number) {
  const ids: string[] = [];
  for (const student of students.slice(0, count)) ids.push(await submitAssignment(student, assignment, randomUUID(), "Synthetic answer", null));
  return ids;
}

before(async () => {
  for (const url of [process.env.DATABASE_URL, process.env.MIGRATION_DATABASE_URL]) {
    assert.ok(url && ["localhost", "127.0.0.1"].includes(new URL(url).hostname), "Integration tests require local test databases.");
  }
  const { rows } = await owner.query<{ id: string; email: string }>('SELECT id,email FROM "user" WHERE email LIKE $1', ["%@nexus.example.invalid"]);
  for (const alias of ["faculty", "replacement", "student", "tenant", "admin"]) {
    const record = rows.find(row => row.email === demoEmail(alias));
    assert.ok(record, "Seed the fictional accounts before running integration tests.");
    people[alias] = record.id;
  }
  const { rows: [section] } = await owner.query<{ id: string }>(
    "INSERT INTO section (institution_id,name) VALUES ($1,$2) RETURNING id", [f.institution, `Synthetic queue section ${run}`]);
  const { rows: [created] } = await owner.query<{ id: string }>(
    "INSERT INTO offering (institution_id,course_id,section_id,term_id) VALUES ($1,$2,$3,$4) RETURNING id",
    [f.institution, f.course, section.id, f.term]);
  offering = created.id;
  await owner.query("INSERT INTO roster (institution_id,offering_id,account_id,role) VALUES ($1,$2,$3,'faculty')", [f.institution, offering, people.faculty]);
  for (const letter of ["E", "B", "D", "A", "C"]) {
    const id = `synthetic-${run}-${letter}`;
    await owner.query(`INSERT INTO "user" (id,name,email,"emailVerified") VALUES ($1,$2,$3,false)`,
      [id, `Synthetic Student ${run} ${letter}`, `synthetic-${run}-${letter.toLowerCase()}@nexus.example.invalid`]);
    await owner.query("INSERT INTO membership (institution_id,account_id,role) VALUES ($1,$2,'student')", [f.institution, id]);
    await owner.query("INSERT INTO roster (institution_id,offering_id,account_id,role) VALUES ($1,$2,$3,'student')", [f.institution, offering, id]);
    students.push({ institution: f.institution, account: id, role: "student" });
  }
});

after(async () => {
  // End the synthetic offering's roster so demo workspaces stay readable; records remain for audit.
  await owner.query("UPDATE roster SET ended_at=clock_timestamp() WHERE institution_id=$1 AND offering_id=$2 AND ended_at IS NULL", [f.institution, offering]);
  await Promise.all([db.end(), owner.end()]);
});

test("evaluation states follow the existing grading engine from submission to correction", async () => {
  const teacher = viewer("faculty", "faculty");
  const before = await evaluationTotals(teacher);
  const assignment = await publishedAssignment();
  const [first, second, third] = await submitAll(assignment, 3);
  const queue = (status: string) => evaluationQueue(teacher, { status, assignment });

  assert.deepEqual((await queue("pending")).items.map(item => item.submission).sort(), [first, second, third].sort());
  assert.equal((await queue("awaiting")).total, 0);
  const totals = await evaluationTotals(teacher);
  assert.equal(totals.pending - before.pending, 3);

  const grade = { assignment, submission: first, expected: 0, expectedDraft: false, marks: 14, feedback: "Synthetic feedback.", publish: false };
  await updateGrade(teacher, grade);
  const [draft] = (await queue("awaiting")).items;
  assert.equal(draft.submission, first);
  assert.equal(draft.state, "draft");
  assert.equal(draft.draft_marks, 14);
  assert.equal(draft.published_marks, null);
  assert.equal((await queue("pending")).total, 2);
  assert.equal((await queue("published")).total, 0, "A draft grade is not a published result");

  await updateGrade(teacher, { ...grade, expected: 1, expectedDraft: true, publish: true });
  const [published] = (await queue("published")).items;
  assert.equal(published.state, "published");
  assert.equal(published.published_marks, 14);
  assert.ok(published.published_at);
  assert.equal((await queue("awaiting")).total, 0);

  await updateGrade(teacher, { ...grade, expected: 1, expectedDraft: false, marks: 16, reason: "Synthetic correction" });
  const [correction] = (await queue("awaiting")).items;
  assert.equal(correction.state, "correction");
  assert.equal(correction.draft_marks, 16);
  assert.equal(correction.published_marks, 14, "The published result stays visible until the correction is published");
  assert.equal((await queue("published")).total, 1, "A correction draft keeps its earlier published result");
  const [studentResult] = await submissions(students[0], assignment);
  assert.equal(studentResult.published?.marks, 14);
  assert.equal(studentResult.draft, null);
  await updateGrade(teacher, { ...grade, expected: 2, expectedDraft: true, publish: true });
  assert.equal((await submissions(students[0], assignment))[0].published?.marks, 16);
  await updateGrade(teacher, { ...grade, expected: 2, expectedDraft: false, marks: 17, reason: "Another correction" });

  const { rows: [progress] } = await assignmentProgress(teacher, { assignment });
  assert.deepEqual(
    { enrolled: progress.enrolled, submitted: progress.submitted_enrolled, withdrawn: progress.withdrawn, pending: progress.pending, awaiting: progress.awaiting, published: progress.published },
    { enrolled: 5, submitted: 3, withdrawn: 0, pending: 2, awaiting: 1, published: 1 },
  );
  assert.ok(progress.oldest_pending);
});

test("the queue paginates, sorts and bounds untrusted filters", async () => {
  const teacher = viewer("faculty", "faculty");
  const assignment = await publishedAssignment();
  await submitAll(assignment, 5);
  const pages = [];
  for (const page of [1, 2, 3]) pages.push(await evaluationQueue(teacher, { assignment, page, pageSize: 2 }));
  assert.deepEqual(pages.map(page => page.items.length), [2, 2, 1]);
  assert.ok(pages.every(page => page.total === 5));
  const ids = pages.flatMap(page => page.items.map(item => item.submission));
  assert.equal(new Set(ids).size, 5, "Pages do not overlap");
  const submitted = pages.flatMap(page => page.items.map(item => item.submitted_at.getTime()));
  assert.deepEqual(submitted, [...submitted].sort((a, b) => a - b), "Default order is oldest submission first");

  const beyond = await evaluationQueue(teacher, { assignment, page: 9, pageSize: 2 });
  assert.equal(beyond.items.length, 0);
  assert.equal(beyond.total, 5, "An out-of-range page still reports the total");

  const byName = await evaluationQueue(teacher, { assignment, sort: "student" });
  assert.deepEqual(byName.items.map(item => item.student.at(-1)), ["A", "B", "C", "D", "E"]);

  const hostile = await evaluationQueue(teacher, { status: "x' OR 1=1", sort: "1;DROP TABLE grade", page: -4, pageSize: 100000, assignment: "not-a-uuid" });
  assert.deepEqual([hostile.status, hostile.sort, hostile.page, hostile.pageSize, hostile.assignment], ["pending", "oldest", 0, 25, undefined]);
});

test("only current faculty on the offering can read its queue", async () => {
  const teacher = viewer("faculty", "faculty");
  const coInstructor = viewer("replacement", "faculty");
  const assignment = await publishedAssignment();
  const [submission] = await submitAll(assignment, 1);
  const visible = async (scope: Scope) => (await evaluationQueue(scope, { status: "all", assignment })).total;

  assert.equal(await visible(teacher), 1);
  assert.equal(await visible(coInstructor), 0, "Faculty without a roster on the offering see nothing");
  assert.equal((await assignmentProgress(coInstructor, { assignment })).rows.length, 0);
  assert.equal(await visible(viewer("faculty", "faculty", f.otherInstitution)), 0, "Another institution's workspace denies the record");
  assert.equal(await visible(viewer("faculty", "student")), 0, "A different role selection denies the queue");
  assert.equal(await visible({ ...students[0], role: "faculty" }), 0, "A student cannot forge a faculty scope");
  assert.equal(await visible(viewer("tenant", "faculty", f.otherInstitution)), 0);

  await owner.query("INSERT INTO roster (institution_id,offering_id,account_id,role) VALUES ($1,$2,$3,'faculty')", [f.institution, offering, coInstructor.account]);
  try {
    assert.equal(await visible(coInstructor), 1, "A co-instructor shares the queue");
    await updateGrade(teacher, { assignment, submission, expected: 0, expectedDraft: false, marks: 10, feedback: "Draft by the first instructor.", publish: false });
    const [shared] = (await evaluationQueue(coInstructor, { status: "awaiting", assignment })).items;
    assert.equal(shared.state, "draft", "Co-instructors see the same draft, not a private copy");

    await owner.query("UPDATE membership SET ended_at=clock_timestamp() WHERE institution_id=$1 AND account_id=$2 AND role='faculty'", [f.institution, coInstructor.account]);
    try {
      assert.equal(await visible(coInstructor), 0, "Ending the faculty membership revokes the queue immediately");
    } finally {
      await owner.query("UPDATE membership SET ended_at=NULL WHERE institution_id=$1 AND account_id=$2 AND role='faculty'", [f.institution, coInstructor.account]);
    }
    await owner.query("UPDATE roster SET ended_at=clock_timestamp() WHERE institution_id=$1 AND offering_id=$2 AND account_id=$3 AND role='faculty'", [f.institution, offering, coInstructor.account]);
    assert.equal(await visible(coInstructor), 0, "Ending the roster revokes the queue immediately");
    assert.equal((await evaluationTotals(coInstructor)).pending >= 0, true);
  } finally {
    await owner.query("DELETE FROM roster WHERE institution_id=$1 AND offering_id=$2 AND account_id=$3", [f.institution, offering, coInstructor.account]);
  }
});

test("mission control keeps unfinished work and exposes unpublishable drafts", async () => {
  const teacher = viewer("faculty", "faculty");
  const draftTitle = `Unpublished ${run}`;
  const unpublished = await createAssignment(teacher, { offering, title: draftTitle, description: "Synthetic.", deadline: future(), marks: 10, file: null });
  await owner.query("UPDATE assignment SET deadline=clock_timestamp()-interval '1 hour' WHERE institution_id=$1 AND id=$2", [f.institution, unpublished]);

  const finished = await publishedAssignment();
  const [only] = await submitAll(finished, 1);
  await updateGrade(teacher, { assignment: finished, submission: only, expected: 0, expectedDraft: false, marks: 9, feedback: "Done.", publish: false });
  await updateGrade(teacher, { assignment: finished, submission: only, expected: 1, expectedDraft: true, publish: true });
  await owner.query("UPDATE assignment SET deadline=clock_timestamp()-interval '1 hour' WHERE institution_id=$1 AND id=$2", [f.institution, finished]);

  const active = await assignmentProgress(teacher, { offering, view: "active" });
  const expired = active.rows.find(row => row.id === unpublished);
  assert.ok(expired, "An unpublished draft remains visible");
  assert.equal(expired.accepting, false);
  assert.equal(expired.published_at, null);
  assert.ok(!active.rows.some(row => row.id === finished), "Closed, fully published work leaves the active list");
  assert.ok((await assignmentProgress(teacher, { offering })).rows.some(row => row.id === finished));

  const limited = await assignmentProgress(teacher, { offering, limit: 1 });
  assert.equal(limited.rows.length, 1);
  assert.equal(limited.truncated, true, "Row limits are reported, not silently applied");
});

test("focused grading reads one authorized submission and finds the next one", async () => {
  const teacher = viewer("faculty", "faculty");
  const assignment = await publishedAssignment();
  const [first, second] = await submitAll(assignment, 2);
  const focused = await submissions(teacher, assignment, second);
  assert.deepEqual(focused.map(row => row.id), [second]);
  const preview = await submissionPreview(teacher, assignment, 1);
  assert.deepEqual(preview, [{ id: first, name: `Synthetic Student ${run} E`, draft: false, published: false }]);
  assert.deepEqual(await submissionPreview(viewer("replacement", "faculty"), assignment, 21), []);
  assert.deepEqual(await submissionPreview(viewer("faculty", "faculty", f.otherInstitution), assignment, 21), []);
  await owner.query(`INSERT INTO attachment (institution_id,assignment_id,submission_id,filename,mime,bytes)
    VALUES ($1,$2,NULL,'instructions.txt','text/plain','test'),($1,NULL,$3,'first.txt','text/plain','test'),
      ($1,NULL,$4,'second.txt','text/plain','test')`, [f.institution, assignment, first, second]);
  assert.deepEqual((await files(teacher, assignment, undefined, [])).map(file => file.filename), ["instructions.txt"]);
  assert.deepEqual((await files(teacher, assignment, undefined, [second])).map(file => file.filename).sort(), ["instructions.txt","second.txt"]);
  assert.deepEqual(await files(viewer("replacement", "faculty"), assignment, undefined, [second]), []);
  assert.equal((await submissions(students[0], assignment, second)).length, 0, "A student cannot open another student's submission");
  assert.equal((await nextAwaitingEvaluation(teacher, assignment, first))?.submission, second);
  await updateGrade(teacher, { assignment, submission: second, expected: 0, expectedDraft: false, marks: 5, feedback: "Draft.", publish: false });
  assert.equal(await nextAwaitingEvaluation(teacher, assignment, first), null, "Drafted work leaves the evaluation queue");
  assert.equal(await nextAwaitingEvaluation(viewer("replacement", "faculty"), assignment), null);
});

test("progress separates withdrawn students and totals follow filters without row limits", async () => {
  const teacher = viewer("faculty", "faculty");
  const assignment = await publishedAssignment();
  await submitAll(assignment, 3);
  const leaving = students[0].account;
  await owner.query("UPDATE roster SET ended_at=clock_timestamp() WHERE institution_id=$1 AND offering_id=$2 AND account_id=$3", [f.institution, offering, leaving]);
  try {
    const { rows: [row] } = await assignmentProgress(teacher, { assignment });
    assert.deepEqual({ enrolled: row.enrolled, submitted: row.submitted_enrolled, withdrawn: row.withdrawn, all: row.submitted },
      { enrolled: 4, submitted: 2, withdrawn: 1, all: 3 }, "Submitted never exceeds enrolled; withdrawn work is reported separately");
    assert.equal((await evaluationQueue(teacher, { assignment })).total, 3, "Withdrawn students' work still needs evaluation");
  } finally {
    await owner.query("UPDATE roster SET ended_at=NULL WHERE institution_id=$1 AND offering_id=$2 AND account_id=$3", [f.institution, offering, leaving]);
  }

  const filtered = await evaluationTotals(teacher, { assignment });
  assert.equal(filtered.pending, 3);
  assert.equal(filtered.byOffering.get(offering)?.pending, 3);
  const course = await evaluationTotals(teacher, { offering });
  assert.equal(course.pending, (await evaluationQueue(teacher, { offering, pageSize: 1 })).total, "Tab counts and the filtered list agree");
  assert.equal((await evaluationTotals(viewer("replacement", "faculty"), { assignment })).pending, 0);

  const first = await createAssignment(teacher, { offering, title: `Unpublished A ${run}`, description: "Synthetic.", deadline: future(), marks: 5, file: null });
  await createAssignment(teacher, { offering, title: `Unpublished B ${run}`, description: "Synthetic.", deadline: future(), marks: 5, file: null });
  const limited = await assignmentProgress(teacher, { offering, view: "unpublished", limit: 1 });
  assert.equal(limited.rows.length, 1);
  assert.ok(limited.total >= 2 && limited.truncated, "The unpublished count is not reduced by the display limit");
  assert.ok((await assignmentProgress(teacher, { offering, view: "open" })).rows.every(row => row.published_at && row.accepting));
  assert.ok(!(await assignmentProgress(teacher, { offering, view: "open" })).rows.some(row => row.id === first));
  const largePage = await evaluationQueue(teacher, { page: 5000, assignment });
  assert.equal(largePage.page, 5000);
  assert.equal(largePage.total, 3);
  assert.deepEqual(largePage.items, []);
});


test("assignment choices ignore unsubmitted drafts before paging and search across all matches", async () => {
  const teacher = viewer("faculty", "faculty");
  const title = `Z submitted ${run}`;
  const assignment = await publishedAssignment(title);
  const [submission] = await submitAll(assignment, 1);
  await updateGrade(teacher, { assignment, submission, expected: 0, expectedDraft: false, marks: 12, feedback: "Complete", publish: false });
  await updateGrade(teacher, { assignment, submission, expected: 1, expectedDraft: true, publish: true });
  await owner.query(`INSERT INTO assignment (institution_id,offering_id,title,description,deadline,max_marks)
    SELECT $1,$2,'A draft '||n,'Synthetic',now()+interval '2 hours',20 FROM generate_series(1,205) n`, [f.institution,offering]);
  const legacy = await assignmentProgress(teacher, { offering, limit: 200 });
  assert.ok(legacy.truncated);
  assert.ok(!legacy.rows.some(row => row.id === assignment), "The old capped progress list drops the published assignment");

  assert.ok((await gradingAssignments(teacher, { offering })).some(row => row.id === assignment));
  const { rows } = await owner.query<{ id: string }>(`INSERT INTO assignment (institution_id,offering_id,title,description,deadline,max_marks,published_at)
    SELECT $1,$2,$3,'Synthetic',now()+interval '2 hours',20,now() FROM generate_series(1,27) RETURNING id`, [f.institution,offering,title]);
  await owner.query(`INSERT INTO submission (institution_id,assignment_id,student_id,body,submitted_at,request_id)
    SELECT $1,id,$3,'Synthetic',now(),gen_random_uuid() FROM unnest($2::uuid[]) id`, [f.institution, rows.map(row => row.id), students[0].account]);
  const options = { offering, search: title.toUpperCase() };
  const first = await gradingAssignments(teacher, options);
  const second = await gradingAssignments(teacher, { ...options, page: 2 });
  assert.equal(first.length, 26, "The extra row signals a next page");
  assert.equal(second.length, 3);
  assert.deepEqual(new Set([...first.slice(0,25), ...second].map(row => row.id)), new Set([assignment,...rows.map(row => row.id)]));
  assert.deepEqual((await gradingAssignments(teacher, { assignment })).map(row => row.id), [assignment]);
  assert.deepEqual(await gradingAssignments(viewer("replacement", "faculty"), options), []);
  assert.deepEqual(await gradingAssignments(viewer("faculty", "faculty", f.otherInstitution), options), []);
});
