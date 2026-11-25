import "../scripts/environment";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { db } from "../lib/db";
import { approvePreviewStudent, revokePreviewStudent, studentAdmissions } from "../lib/student-admission";
import { onboardingEntryKind } from "../lib/onboarding-preview";
import { demoEmail, fixtures as f } from "../scripts/fixtures";
import type { Scope } from "../lib/scope";

const owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const admin: Scope = { role:"admin", institution:f.institution, account:"" };
const student: Scope = { role:"student", institution:f.institution, account:"" };
const form = () => ({ email:demoEmail("admission-"+randomUUID()), section:f.section, term:f.term });

before(async () => {
  for (const url of [process.env.DATABASE_URL,process.env.MIGRATION_DATABASE_URL]) {
    assert.ok(url && ["localhost","127.0.0.1"].includes(new URL(url).hostname),"Integration tests require local test databases.");
  }
  for (const scope of [admin, student]) {
    const result = await owner.query<{ id:string }>('SELECT id FROM "user" WHERE email=$1',[demoEmail(scope.role)]);
    assert.equal(result.rowCount,1);
    scope.account = result.rows[0].id;
  }
});

after(async () => { await Promise.all([db.end(),owner.end()]); });

test("admin can approve and revoke a fictional student without creating credentials or roles", async () => {
  const input=form();
  const approvalId=await approvePreviewStudent(admin,{...input,email:" "+input.email.toUpperCase()+" "});
  const approved=(await studentAdmissions(admin)).find(row=>row.id===approvalId);
  assert.equal(approved?.email,input.email);
  assert.equal(approved?.revoked_at,null);
  assert.equal((await owner.query('SELECT id FROM "user" WHERE email=$1',[input.email])).rowCount,0);
  await revokePreviewStudent(admin,approvalId);
  assert.ok((await studentAdmissions(admin)).find(row=>row.id===approvalId)?.revoked_at);
  const result=await owner.query<{ action:string }>("SELECT action FROM audit_event WHERE institution_id=$1 AND entity_id=$2 ORDER BY id",[admin.institution,approvalId]);
  assert.deepEqual(result.rows.map(row=>row.action),["onboarding.student_approved","onboarding.student_revoked"]);
  assert.notEqual(await approvePreviewStudent(admin,input),approvalId);
});

test("role, tenant and test-data constraints are enforced in the admission service", async () => {
  const input=form();
  const approvalId=await approvePreviewStudent(admin,input);
  await assert.rejects(approvePreviewStudent(student,form()),/unavailable/);
  await assert.rejects(studentAdmissions(student),/unavailable/);
  await assert.rejects(revokePreviewStudent(student,approvalId),/unavailable/);
  const other={...admin,institution:f.otherInstitution};
  assert.deepEqual(await studentAdmissions(other),[]);
  await assert.rejects(revokePreviewStudent(other,approvalId),/unavailable/);
  await assert.rejects(approvePreviewStudent(admin,{...form(),term:randomUUID()}),/unavailable/);
  await assert.rejects(approvePreviewStudent(admin,{...form(),role:"faculty"}),/example email/);
  await assert.rejects(approvePreviewStudent(admin,{...form(),email:"not-for-preview@example.com"}),/example email/);
});

test("an email can have only one active approval per institution, even under concurrent saves", async () => {
  const input=form();
  const results=await Promise.allSettled([approvePreviewStudent(admin,input),approvePreviewStudent(admin,input)]);
  assert.equal(results.filter(result=>result.status==="fulfilled").length,1);
  assert.equal((await studentAdmissions(admin)).filter(row=>row.email===input.email&&!row.revoked_at).length,1);
});

test("QR entry types are informational and exclude leadership routes", () => {
  for (const entry of ["student","faculty","staff"]) assert.equal(onboardingEntryKind(entry),entry);
  for (const entry of ["hod","admin","principal","Student",null]) assert.equal(onboardingEntryKind(entry),null);
});
