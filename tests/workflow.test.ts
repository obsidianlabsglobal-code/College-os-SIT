import "../scripts/environment";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { assignments, offerings, studentAssignmentSummaries, createAssignment, files, publishAssignment, submissions, submitAssignment, updateGrade } from "../lib/assignments";
import { changeCatalog } from "../lib/academics";
import { advanceRequest, createRequest, draftNotice, notices, publishNotice, requests } from "../lib/connected";
import { changeInstitution } from "../lib/institution";
import { departmentSummary, institutionSummary } from "../lib/reporting";
import { parseUpload } from "../lib/files";
import { db } from "../lib/db";
import type { Scope } from "../lib/scope";
import { fixtures as f, demoEmail } from "../scripts/fixtures";

const owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const people: Record<string,string> = {};
const viewer = (alias: string, role: Scope["role"], institution = f.institution): Scope => ({ account: people[alias], role, institution });
const future = () => new Intl.DateTimeFormat("sv-SE", { dateStyle:"short", timeStyle:"short", timeZone:"Asia/Kolkata" })
  .format(new Date(Date.now() + 86_400_000)).replace(" ","T");
const draft = () => ({ offering: f.offering, title: `Assignment ${randomUUID()}`, description: "Describe the algorithm.", deadline: future(), marks: 20, file: null });

before(async () => {
  for (const url of [process.env.DATABASE_URL,process.env.MIGRATION_DATABASE_URL]) {
    assert.ok(url && ["localhost","127.0.0.1"].includes(new URL(url).hostname),"Integration tests require local test databases.");
  }
  const { rows } = await owner.query<{ id: string; email: string }>('SELECT id,email FROM "user" WHERE email LIKE $1', ["%@nexus.example.invalid"]);
  for (const alias of ["student","faculty","hod","outsider","tenant","replacement","admin","principal"]) {
    const record = rows.find(row => row.email === demoEmail(alias));
    assert.ok(record,"Seed the fictional accounts before running integration tests.");
    people[alias] = record.id;
  }
});

after(async () => { await Promise.all([db.end(),owner.end()]); });

test("assignment persists with tenant, section, file and grade boundaries", async () => {
  const teacher = viewer("faculty","faculty");
  const student = viewer("student","student");
  const outsider = viewer("outsider","student");
  const tenant = viewer("tenant","student",f.otherInstitution);
  const upload = await parseUpload(new File(["Evidence"],"instructions.txt",{ type:"text/plain" }));
  assert.ok(upload);
  const id = await createAssignment(teacher,{ ...draft(), file: upload });
  await assert.rejects(publishAssignment(viewer("replacement","faculty"),id),/unavailable/);
  assert.equal((await assignments(student,id)).length,0);
  assert.ok(!(await studentAssignmentSummaries(student)).some(item=>item.id===id));
  await publishAssignment(teacher,id);
  const summary = async () => (await studentAssignmentSummaries(student)).find(item=>item.id===id);
  assert.deepEqual([(await summary())?.submitted,Boolean((await summary())?.result_published_at)],[false,false]);
  assert.deepEqual(await studentAssignmentSummaries(teacher),[]);
  const [attachment] = await files(student,id);
  assert.equal(attachment.filename,"instructions.txt");
  assert.equal((await files(student,id,attachment.id))[0].bytes?.toString(),"Evidence");
  for (const unrelated of [outsider,tenant]) {
    assert.equal((await assignments(unrelated,id)).length,0);
    assert.equal((await files(unrelated,id,attachment.id)).length,0);
    assert.ok(!(await studentAssignmentSummaries(unrelated)).some(item=>item.id===id));
    await assert.rejects(submitAssignment(unrelated,id,randomUUID(),"Work",null),/unavailable/);
  }
  await assert.rejects(submitAssignment(student,id,randomUUID(),"",null),/Enter a response/);
  const request = randomUUID();
  const work = await parseUpload(new File(["Student evidence"],"work.txt",{type:"text/plain"}));
  const [first,retry] = await Promise.all([
    submitAssignment(student,id,request,"Work",work),
    submitAssignment(student,id,request,"Work",work),
  ]);
  assert.equal(first,retry);
  const studentFiles = (await files(teacher,id)).filter(file => file.submission_id === first);
  assert.equal(studentFiles.length,1);
  assert.equal((await files(student,id,studentFiles[0].id))[0].bytes?.toString(),"Student evidence");
  await assert.rejects(submitAssignment(student,id,randomUUID(),"Duplicate",null),/already submitted/);
  const grade = { assignment: id, submission: first, expected: 0, expectedDraft: false, marks: 17, feedback: "Good.", publish: false };
  await assert.rejects(updateGrade(teacher,{ ...grade, marks: 21 }),/valid marks/);
  const writes = await Promise.allSettled([updateGrade(teacher,grade),updateGrade(teacher,grade)]);
  assert.equal(writes.filter(item => item.status === "fulfilled").length,1);
  assert.match(String((writes.find(item => item.status === "rejected") as PromiseRejectedResult).reason),/grade changed/);
  const [unpublished] = await submissions(student,id);
  assert.equal(unpublished.draft,null);
  assert.equal(unpublished.published,null);
  assert.deepEqual([(await summary())?.submitted,Boolean((await summary())?.result_published_at)],[true,false]);
  await updateGrade(teacher,{ ...grade, expected: 1, expectedDraft: true, publish: true });
  const firstPublication = (await summary())?.result_published_at;
  await assert.rejects(updateGrade(teacher,{ ...grade, expected: 1, expectedDraft: true, marks: 18, reason: "Stale draft" }),/grade changed/);
  await assert.rejects(updateGrade(teacher,{ ...grade, expected: 1, marks: 18 }),/reason/);
  await updateGrade(teacher,{ ...grade, expected: 1, marks: 18, reason: "Correction" });
  assert.equal((await submissions(student,id))[0].published?.marks,17);
  assert.deepEqual((await summary())?.result_published_at,firstPublication);
  assert.deepEqual([(await summary())?.submitted,Boolean((await summary())?.result_published_at)],[true,true]);
  await updateGrade(teacher,{ ...grade, expected: 2, expectedDraft: true, marks: 19, reason: "Correction" });
  await updateGrade(teacher,{ ...grade, expected: 3, expectedDraft: true, publish: true });
  assert.equal((await submissions(student,id))[0].published?.marks,19);

  const { rows } = await owner.query<{ revision: number }>(
    "SELECT revision FROM grade WHERE institution_id=$1 AND submission_id=$2 ORDER BY revision", [f.institution,first],
  );
  assert.deepEqual(rows.map(row => row.revision),[1,2,3]);
  const events = await owner.query<{ action: string }>("SELECT action FROM audit_event WHERE institution_id=$1 AND entity_id IN ($2,$3) ORDER BY id",[f.institution,id,first]);
  assert.deepEqual(events.rows.map(row => row.action),[
    "assignment.created","assignment.published","submission.received","grade.drafted","grade.published","grade.correction_drafted","grade.correction_drafted","grade.published",
  ]);
  const [department] = await departmentSummary(viewer("hod","hod"));
  assert.equal(department.name,"Electronics and Communication Engineering");
  assert.ok(department.results >= 1);
});

test("deadline, inactive membership and faculty handover take effect immediately", async () => {
  const teacher = viewer("faculty","faculty");
  const student = viewer("student","student");
  const replacement = viewer("replacement","faculty");
  const admin = viewer("admin","admin");
  const late = await createAssignment(teacher,draft());
  await publishAssignment(teacher,late);
  await owner.query("UPDATE assignment SET deadline=clock_timestamp()-interval '1 minute' WHERE institution_id=$1 AND id=$2",[f.institution,late]);
  await assert.rejects(submitAssignment(student,late,randomUUID(),"Late",null),/deadline has passed/);

  const id = await createAssignment(teacher,draft());
  await publishAssignment(teacher,id);
  const submitted = await submitAssignment(student,id,randomUUID(),"Work",null);
  const offering = f.offering;
  const grant = { operation: "add-roster" as const, offering, account: student.account, role: "student" as const };
  await changeCatalog(admin,{ ...grant,operation:"end-roster" });
  try {
    assert.equal((await offerings(student,offering)).length,0);
    assert.equal((await assignments(student,id)).length,0);
    assert.ok(!(await studentAssignmentSummaries(student)).some(item=>item.id===id));
    assert.equal((await submissions(student,id)).length,0);
  } finally {
    await changeCatalog(admin,grant);
  }

  const facultyGrant = { operation: "add-roster" as const, offering, account: teacher.account, role: "faculty" as const };
  await changeCatalog(admin,{ ...facultyGrant, operation:"end-roster" });
  try {
    const grading = { assignment: id, submission: submitted, expected: 0, expectedDraft: false, marks: 15, feedback: "Reviewed.", publish: false };
    await assert.rejects(updateGrade(teacher,grading),/unavailable/);
    await changeCatalog(admin,{ ...facultyGrant, account:replacement.account });
    try {
      await updateGrade(replacement,grading);
    } finally {
      await changeCatalog(admin,{ ...facultyGrant, operation:"end-roster",account:replacement.account });
    }
  } finally {
    await changeCatalog(admin,facultyGrant);
  }
});

test("invalid uploads fail and an audit-write failure rolls back assignment and attachment", async () => {
  assert.equal(await parseUpload(new File([], "undefined", { type:"application/octet-stream" })),null);
  await assert.rejects(parseUpload(new File([], "empty.txt", { type:"text/plain" })),/between 1 byte/);
  await assert.rejects(parseUpload(new File(["not a pdf"],"file.pdf",{ type:"application/pdf" })),/valid PDF/);
  await assert.rejects(parseUpload(new File([new Uint8Array([0xff])],"file.txt",{ type:"text/plain" })),/UTF-8/);
  await assert.rejects(parseUpload(new File([new Uint8Array(4194305)],"file.txt",{ type:"text/plain" })),/4 MiB/);
  const input = draft();
  const file = await parseUpload(new File(["Rollback"],"rollback.txt",{type:"text/plain"}));
  const failure = await owner.connect();
  try {
    await failure.query("BEGIN");
    await failure.query("LOCK TABLE audit_event IN ACCESS EXCLUSIVE MODE");
    await assert.rejects(createAssignment(viewer("faculty","faculty"),{ ...input,file }),/statement timeout/);
    await failure.query("ROLLBACK");
  } finally {
    await failure.query("ROLLBACK");
    failure.release();
  }
  assert.equal((await owner.query("SELECT 1 FROM assignment WHERE title=$1",[input.title])).rowCount,0);
  assert.equal((await owner.query("SELECT 1 FROM attachment WHERE filename='rollback.txt'")).rowCount,0);
});

test("notices, service transitions and leadership aggregates enforce scopes", async () => {
  const teacher = viewer("faculty","faculty");
  const student = viewer("student","student");
  const tenant = viewer("tenant","student",f.otherInstitution);
  const admin = viewer("admin","admin");
  const title = `Notice ${randomUUID()}`;
  await assert.rejects(draftNotice(teacher,title,"Bring notes.",f.otherOffering),/unavailable/);
  await draftNotice(teacher,title,"Bring notes.",f.offering);
  const record = (await notices(teacher,"draft")).find(row => row.title === title);
  assert.ok(record);
  assert.ok(!(await notices(student,"all")).some(row => row.id === record.id));
  await publishNotice(teacher,record.id);
  assert.ok((await notices(student,"published")).some(row => row.id === record.id));
  for (const denied of [tenant,viewer("outsider","student")]) {
    assert.ok(!(await notices(denied,"all")).some(row => row.id === record.id));
  }

  const description = `Enrollment proof ${randomUUID()}`;
  const principal = viewer("principal","principal");
  const before = (await institutionSummary(principal))[0].open_requests;
  await createRequest(student,description);
  const saved = (await requests(student)).find(row => row.description === description);
  assert.ok(saved);
  assert.equal((await institutionSummary(principal))[0].open_requests,before + 1);
  assert.ok(!(await requests(tenant)).some(row => row.id === saved.id));
  await assert.rejects(advanceRequest(student,saved.id,"in_progress"),/unavailable/);
  await assert.rejects(advanceRequest(admin,saved.id,"resolved","Ready."),/has already changed/);
  await advanceRequest(admin,saved.id,"in_progress");
  await advanceRequest(admin,saved.id,"resolved","Ready.");
  assert.equal((await requests(student)).find(row => row.id === saved.id)?.outcome,"Ready.");
  assert.equal((await institutionSummary(principal))[0].open_requests,before);
  assert.deepEqual(await institutionSummary({ ...principal, institution:f.otherInstitution }),[]);
  await assert.rejects(changeInstitution(admin,{ operation:"grant", account:tenant.account, role:"faculty" }),/No change/);
});

test("admin overview counts only current requests in the granted institution", async () => {
  const {adminRequestSummary} = await import("../lib/reporting");
  const admin=viewer("admin","admin");
  const before=await adminRequestSummary(admin);
  assert.ok(before);
  await createRequest(viewer("student","student"),"Fictional enrollment letter for the overview test");
  const after=await adminRequestSummary(admin);
  assert.equal(after?.submitted,before.submitted+1);
  assert.equal(after?.in_review,before.in_review);
  assert.equal(await adminRequestSummary({...admin,institution:f.otherInstitution}),null);
  assert.equal(await adminRequestSummary(viewer("student","student")),null);
});
