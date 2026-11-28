// covers: CL-047
import "../scripts/environment";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { changeClub } from "../lib/clubverse";
import { addClubTask, clubTasks, completeClubTask } from "../lib/club-tasks";
import { db } from "../lib/db";
import type { Scope } from "../lib/scope";
import { fixtures, demoEmail } from "../scripts/fixtures";

const owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const id = new Map<string, string>();
const as = (alias: string, role: Scope["role"], institution = fixtures.institution): Scope => ({ institution, account: id.get(alias)!, role });
const day = (offset: number) => new Date(Date.now() + offset * 86400000).toLocaleDateString("sv-SE", { timeZone: "Asia/Kolkata" });

before(async () => {
  for (const alias of ["student", "outsider", "faculty", "admin", "tenant"])
    id.set(alias, (await owner.query<{ id: string }>('SELECT id FROM "user" WHERE email=$1', [demoEmail(alias)])).rows[0].id);
});
after(async () => { await Promise.all([db.end(), owner.end()]); });

test("officers turn meeting decisions into tasks for active members; only the owner closes one; outsiders see nothing", async () => {
  const founder = as("faculty", "faculty"), admin = as("admin", "admin"), asha = as("student", "student"), neel = as("outsider", "student");
  const club = await changeClub(founder, { operation: "draft", name: `Quiz ${randomUUID()}`, purpose: "Quiz.", rules: "Weekly.", category: "technical", joining: "open", audience: "campus" });
  for (const [revision, next, who] of [[0, "submitted", founder], [1, "under_review", admin], [2, "approved", admin]] as const)
    await changeClub(who, { operation: "proposal", id: club, revision, next });
  await changeClub(asha, { operation: "join", club });
  const task = { club, decided: day(-1), decision: "Book the seminar hall for the finals", owner: asha.account, due: day(3) };

  await assert.rejects(addClubTask(asha, task), /unavailable/, "members who are not officers cannot assign");
  await assert.rejects(addClubTask(founder, { ...task, owner: neel.account }), /active club member/);
  await assert.rejects(addClubTask(founder, { ...task, due: day(-3) }), /before the meeting/);
  const late = await addClubTask(founder, { ...task, decision: "Print posters", due: day(-1) });
  const hall = await addClubTask(founder, task);

  const seen = await clubTasks(asha, club);
  assert.deepEqual(seen.map(t => [t.decision, t.overdue]), [["Print posters", true], ["Book the seminar hall for the finals", false]]);
  assert.deepEqual(await clubTasks(neel, club), [], "non-members see nothing");
  assert.deepEqual(await clubTasks(as("tenant", "student", fixtures.otherInstitution), club), []);

  await assert.rejects(completeClubTask(founder, { club, task: hall }), /owner/);
  await completeClubTask(asha, { club, task: hall });
  await assert.rejects(completeClubTask(asha, { club, task: hall }), /once/);
  assert.equal((await clubTasks(founder, club)).find(t => t.id === hall)?.done, true);
  assert.equal((await clubTasks(founder, club)).find(t => t.id === late)?.done, false);
  const actions = (await owner.query("SELECT action FROM audit_event WHERE entity_id=$1 ORDER BY occurred_at", [hall])).rows.map(r => r.action);
  assert.deepEqual(actions, ["club.task_assigned", "club.task_done"]);
});
