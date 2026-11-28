// covers: AI-011, AI-017, ID-004, ID-006
import "../scripts/environment";
import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { db } from "../lib/db";
import { askAura } from "../lib/aura/ask";
import { fixtures, demoEmail, personas } from "../scripts/fixtures";
import type { Scope } from "../lib/scope";

const owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const as = new Map<string, Scope>();
const i = fixtures.institution;
const tag = randomUUID().slice(0, 8);
const ids = { assignment: randomUUID(), other: randomUUID(), letters: randomUUID(), staff: randomUUID(), room: randomUUID(), session: randomUUID() };

before(async () => {
  for (const url of [process.env.MIGRATION_DATABASE_URL, process.env.DATABASE_URL]) assert.ok(url && ["127.0.0.1", "localhost"].includes(new URL(url).hostname));
  for (const [alias, [, , role]] of Object.entries(personas)) {
    const { rows: [row] } = await owner.query('SELECT id FROM "user" WHERE email=$1', [demoEmail(alias)]);
    as.set(alias, { account: row.id, role, institution: alias === "tenant" ? fixtures.otherInstitution : fixtures.institution });
  }
  const admin = as.get("admin")!.account, principal = as.get("principal")!.account, faculty = as.get("faculty")!.account;
  // An assignment due in three days for Section A and another for Section B.
  for (const [id, offering, title] of [[ids.assignment, fixtures.offering, `Signals lab ${tag}`], [ids.other, fixtures.otherOffering, `Section B quiz ${tag}`]])
    await owner.query(`INSERT INTO assignment (institution_id,id,offering_id,title,description,deadline,max_marks,published_at)
      VALUES ($1,$2,$3,$4,'Fictional',now()+interval '3 days',10,now())`, [i, id, offering, title]);
  await owner.query("INSERT INTO campus_resource (institution_id,id,name,kind,location) VALUES ($1,$2,$3,'room','Fictional')", [i, ids.room, `Lab ${tag}`]);
  await owner.query(`INSERT INTO class_session (institution_id,id,series_id,offering_id,section_id,faculty_id,room_id,slot,state,created_by,published_at)
    SELECT $1,$2,gen_random_uuid(),$3,o.section_id,$4,$5,tstzrange(now()+interval '30 hours',now()+interval '31 hours'),'published',$4,now()
    FROM offering o WHERE o.institution_id=$1 AND o.id=$3`, [i, ids.session, fixtures.offering, faculty, ids.room]);
  // An approved student policy about letters, and a staff-only one that students must not see.
  for (const [id, title, audience, body] of [[ids.letters, `Letters and certificates ${tag}`, "students", "To get a bonafide letter, submit a service request with its purpose. The office replies within two working days. Collect it from the academic office."],
    [ids.staff, `Staff leave ${tag}`, "staff", "Staff apply for bonafide leave through the HOD. This line is staff only."]]) {
    await owner.query("INSERT INTO policy (institution_id,id,kind,title,audience,created_by) VALUES ($1,$2,'service',$3,$4,$5)", [i, id, title, audience, admin]);
    await owner.query(`INSERT INTO policy_version (institution_id,policy_id,version,body,state,drafted_by,decided_by,decided_at,decision_reason)
      VALUES ($1,$2,1,$3,'approved',$4,$5,now(),'Approved')`, [i, id, body, admin, principal]);
  }
});
after(async () => {
  await owner.query("DELETE FROM class_session WHERE institution_id=$1 AND id=$2", [i, ids.session]);
  await owner.query("DELETE FROM campus_resource WHERE institution_id=$1 AND id=$2", [i, ids.room]);
  await owner.query("DELETE FROM job WHERE institution_id=$1 AND event_id IN (SELECT id FROM audit_event WHERE institution_id=$1 AND entity_id IN ($2,$3))", [i, ids.assignment, ids.other]);
  await owner.query("DELETE FROM assignment WHERE institution_id=$1 AND id IN ($2,$3)", [i, ids.assignment, ids.other]);
  await owner.query("DELETE FROM policy_version WHERE institution_id=$1 AND policy_id IN ($2,$3)", [i, ids.letters, ids.staff]);
  await owner.query("DELETE FROM policy WHERE institution_id=$1 AND id IN ($2,$3)", [i, ids.letters, ids.staff]);
  await Promise.all([db.end(), owner.end()]);
});

test("one plain question returns the asker's own due work and next rooms, each with its source", async () => {
  const answers = await askAura(as.get("student")!, "What's due this week and where is my lab?");
  const due = answers.find(a => a.heading === "Due in the next seven days")!;
  assert.ok(due.lines.some(l => l.startsWith(`Signals lab ${tag}`)));
  assert.ok(!due.lines.some(l => l.includes(`Section B quiz ${tag}`)), "another section's work never appears");
  assert.equal(due.source, "Your published assignments");
  assert.ok(answers.find(a => a.heading === "Your next classes and rooms")!.lines.some(l => l.endsWith(`Lab ${tag}`)));
  const outsider = await askAura(as.get("outsider")!, "What's due this week and where is my lab?");
  const theirs = outsider.find(a => a.heading === "Due in the next seven days")!.lines;
  assert.ok(theirs.some(l => l.startsWith(`Section B quiz ${tag}`)) && !theirs.some(l => l.includes(`Signals lab ${tag}`)));
  assert.ok(!outsider.find(a => a.heading === "Your next classes and rooms")!.lines.some(l => l.includes(`Lab ${tag}`)));
});

test("process questions quote approved policy versions the asker may read, with a citation and next step", async () => {
  const answers = await askAura(as.get("student")!, "How do I get a bonafide letter?");
  const cited = answers.find(a => a.heading === `Letters and certificates ${tag}`)!;
  assert.ok(cited.lines[0].startsWith("To get a bonafide letter"));
  assert.match(cited.source, new RegExp(`^Letters and certificates ${tag}, version 1, approved `));
  assert.deepEqual(cited.action, { label: "Request a letter", path: "/requests" });
  assert.ok(!answers.some(a => a.heading === `Staff leave ${tag}`), "a staff-only policy is not quoted to a student");
  assert.ok((await askAura(as.get("faculty")!, "bonafide leave")).some(a => a.heading === `Staff leave ${tag}`));
  assert.ok(!(await askAura({ ...as.get("tenant")!, role: "student" }, "How do I get a bonafide letter?")).some(a => a.heading.endsWith(tag)));
});

test("unmatched questions get guidance, not an invented answer", async () => {
  const [answer] = await askAura(as.get("student")!, "zzqx frobnicate");
  assert.equal(answer.heading, "I could not match that");
  await assert.rejects(() => askAura(as.get("student")!, "x"), { name: "ZodError" });
});
