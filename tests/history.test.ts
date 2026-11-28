// covers: SA-017, ID-004
import "../scripts/environment";
import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { db } from "../lib/db";
import { assessmentHistory } from "../lib/assignments";
import { fixtures, demoEmail, personas } from "../scripts/fixtures";
import type { Scope } from "../lib/scope";

const owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const as = new Map<string, Scope>();
const [closed, graded, open]: string[] = [randomUUID(), randomUUID(), randomUUID()];
before(async () => {
  for (const url of [process.env.MIGRATION_DATABASE_URL, process.env.DATABASE_URL]) assert.ok(url && ["127.0.0.1", "localhost"].includes(new URL(url).hostname));
  for (const [alias, [, , role]] of Object.entries(personas)) {
    const { rows: [row] } = await owner.query('SELECT id FROM "user" WHERE email=$1', [demoEmail(alias)]);
    as.set(alias, { account: row.id, role, institution: alias === "tenant" ? fixtures.otherInstitution : fixtures.institution });
  }
});
after(async () => {
  const ids = [closed, graded, open];
  await owner.query("DELETE FROM grade WHERE institution_id=$1 AND submission_id IN (SELECT id FROM submission WHERE assignment_id = ANY($2))", [fixtures.institution, ids]);
  await owner.query("DELETE FROM submission WHERE institution_id=$1 AND assignment_id = ANY($2)", [fixtures.institution, ids]);
  await owner.query("DELETE FROM assignment WHERE institution_id=$1 AND id = ANY($2)", [fixtures.institution, ids]);
  await Promise.all([db.end(), owner.end()]);
});

test("assessment history lists closed and submitted work newest first with only the latest published result", async () => {
  const i = fixtures.institution, student = as.get("student")!;
  const add = (id: string, title: string, deadline: string) => owner.query(`INSERT INTO assignment (institution_id,id,offering_id,title,description,deadline,max_marks,published_at)
    VALUES ($1,$2,$3,$4,'Fictional',now()+$5::interval,20,now()-interval '20 days')`, [i, id, fixtures.offering, title, deadline]);
  await add(closed, `Missed quiz ${closed}`, "-10 days");
  await add(graded, `Graded lab ${graded}`, "-2 days");
  await add(open, `Open essay ${open}`, "5 days");
  const { rows: [sub] } = await owner.query(`INSERT INTO submission (institution_id,assignment_id,student_id,body,submitted_at,request_id)
    VALUES ($1,$2,$3,'Fictional',now()-interval '3 days',gen_random_uuid()) RETURNING id`, [i, graded, student.account]);
  const grade = (revision: number, marks: number, published: boolean) => owner.query(
    "INSERT INTO grade (institution_id,submission_id,revision,marks,feedback,reason,published_at) VALUES ($1,$2,$3,$4,'Fictional',$5,$6)",
    [i, sub.id, revision, marks, revision > 1 ? "Recount" : null, published ? new Date() : null]);
  await grade(1, 12, false);
  let rows = (await assessmentHistory(student)).filter(r => [closed, graded, open].includes(r.id));
  assert.deepEqual(rows.map(r => [r.id, r.marks]), [[graded, null], [closed, null]], "drafts are hidden; open unsubmitted work is not history");
  await owner.query("UPDATE grade SET published_at=now() WHERE institution_id=$1 AND submission_id=$2 AND revision=1", [i, sub.id]);
  await grade(2, 15, true);
  rows = (await assessmentHistory(student)).filter(r => [closed, graded, open].includes(r.id));
  assert.deepEqual(rows.map(r => [r.id, r.marks, r.corrected]), [[graded, 15, true], [closed, null, false]]);
  assert.equal(rows[1].submitted_at, null);
  assert.ok(!(await assessmentHistory(as.get("outsider")!)).some(r => r.id === graded), "other sections never see this record");
  for (const alias of ["faculty", "hod", "admin", "principal"]) assert.deepEqual(await assessmentHistory(as.get(alias)!), []);
  assert.deepEqual(await assessmentHistory({ ...student, institution: fixtures.otherInstitution }), []);
});
