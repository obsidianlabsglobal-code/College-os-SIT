// covers: AD-005, ID-004, ID-006
import "../scripts/environment";
import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { db } from "../lib/db";
import { WorkflowError } from "../lib/assignments";
import { correctRecord, findStudents, studentRecord } from "../lib/student-records";
import { fixtures, demoEmail, personas } from "../scripts/fixtures";
import type { Scope } from "../lib/scope";

const owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const as = new Map<string, Scope>();
const i = fixtures.institution;
const usn = `4SI${randomUUID().slice(0, 6).toUpperCase()}`;
const rejects = (run: () => Promise<unknown>, pattern?: RegExp) =>
  assert.rejects(async () => run(), (e: unknown) => (e instanceof WorkflowError || (e as Error).name === "ZodError") && (!pattern || pattern.test((e as Error).message)));

before(async () => {
  for (const url of [process.env.MIGRATION_DATABASE_URL, process.env.DATABASE_URL]) assert.ok(url && ["127.0.0.1", "localhost"].includes(new URL(url).hostname));
  for (const [alias, [, , role]] of Object.entries(personas)) {
    const { rows: [row] } = await owner.query('SELECT id FROM "user" WHERE email=$1', [demoEmail(alias)]);
    as.set(alias, { account: row.id, role, institution: alias === "tenant" ? fixtures.otherInstitution : fixtures.institution });
  }
  await owner.query(`INSERT INTO person_detail (institution_id,account_id,usn,semester) VALUES ($1,$2,$3,3)
    ON CONFLICT (institution_id,account_id) DO UPDATE SET usn=EXCLUDED.usn,semester=3`, [i, as.get("outsider")!.account, `${usn}9`]);
});
after(async () => {
  await owner.query("DELETE FROM person_detail_change WHERE institution_id=$1 AND account_id IN ($2,$3)", [i, as.get("student")!.account, as.get("outsider")!.account]);
  await owner.query("DELETE FROM person_detail WHERE institution_id=$1 AND account_id IN ($2,$3)", [i, as.get("student")!.account, as.get("outsider")!.account]);
  await Promise.all([db.end(), owner.end()]);
});

test("the office finds students and corrects details with a reason and history; students read only their own record", async () => {
  const admin = as.get("admin")!, student = as.get("student")!;
  assert.ok((await findStudents(admin, "asha")).some(s => s.account_id === student.account && s.sections.includes("Section A")));
  assert.deepEqual(await findStudents(as.get("faculty")!, "asha"), []);
  assert.deepEqual(await findStudents({ ...as.get("tenant")!, role: "admin" }, "asha"), [], "another college finds nothing");
  await rejects(() => correctRecord(as.get("faculty")!, { account: student.account, field: "usn", value: usn, reason: "x" }));
  await rejects(() => correctRecord(admin, { account: student.account, field: "usn", value: "bad usn", reason: "x" }));
  await rejects(() => correctRecord(admin, { account: student.account, field: "usn", value: `${usn}9`, reason: "x" }), /another student/);
  await rejects(() => correctRecord(admin, { account: as.get("faculty")!.account, field: "phone", value: "+91 98450 00000", reason: "x" }), /unavailable/);
  await correctRecord(admin, { account: student.account, field: "usn", value: usn.toLowerCase(), reason: "Typed wrongly at sign-up" });
  await rejects(() => correctRecord(admin, { account: student.account, field: "usn", value: usn, reason: "Again" }), /already the recorded value/);
  await correctRecord(admin, { account: student.account, field: "semester", value: "4", reason: "Promoted" });
  const viewed = (await studentRecord(admin, student.account))!;
  assert.deepEqual([viewed.usn, viewed.semester], [usn, 4]);
  assert.deepEqual(viewed.history.map(h => [h.field, h.old_value, h.new_value, h.reason]), [["semester", null, "4", "Promoted"], ["usn", null, usn, "Typed wrongly at sign-up"]]);
  assert.equal((await studentRecord(student, student.account))?.usn, usn, "a student reads their own record");
  assert.equal(await studentRecord(student, as.get("outsider")!.account), null, "but not anyone else's");
  assert.equal(await studentRecord(as.get("faculty")!, student.account), null);
  assert.equal(await studentRecord({ ...as.get("tenant")!, role: "admin" }, student.account), null);
});
