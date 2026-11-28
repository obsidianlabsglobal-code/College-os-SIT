// covers: CL-028
import "../scripts/environment";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { changeClub } from "../lib/clubverse";
import { clubNotices, postClubNotice, withdrawClubNotice } from "../lib/club-notices";
import { db } from "../lib/db";
import type { Scope } from "../lib/scope";
import { fixtures, demoEmail } from "../scripts/fixtures";

const owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const id = new Map<string, string>();
const as = (alias: string, role: Scope["role"], institution = fixtures.institution): Scope => ({ institution, account: id.get(alias)!, role });
const day = (offset: number) => new Date(Date.now() + offset * 86400000).toLocaleDateString("sv-SE", { timeZone: "Asia/Kolkata" });

before(async () => {
  for (const alias of ["student", "outsider", "faculty", "replacement", "admin", "tenant"])
    id.set(alias, (await owner.query<{ id: string }>('SELECT id FROM "user" WHERE email=$1', [demoEmail(alias)])).rows[0].id);
});
after(async () => { await Promise.all([db.end(), owner.end()]); });

test("officers post member-only and open notices that expire or are withdrawn; nobody else can post", async () => {
  const founder = as("faculty", "faculty"), admin = as("admin", "admin"), asha = as("student", "student"), neel = as("outsider", "student");
  const club = await changeClub(founder, { operation: "draft", name: `Music ${randomUUID()}`, purpose: "Play.", rules: "Weekly.", category: "technical", joining: "open", audience: "campus" });
  for (const [revision, next, who] of [[0, "submitted", founder], [1, "under_review", admin], [2, "approved", admin]] as const)
    await changeClub(who, { operation: "proposal", id: club, revision, next });
  await changeClub(asha, { operation: "join", club });
  const base = { club, body: "Bring your instrument.", expires: day(7) };

  const members = await postClubNotice(founder, { ...base, title: "Rehearsal moved", audience: "members" });
  await postClubNotice(founder, { ...base, title: "Open jam on Friday", audience: "eligible" });
  for (const who of [asha, admin, as("replacement", "faculty"), as("tenant", "faculty", fixtures.otherInstitution)])
    await assert.rejects(postClubNotice(who, { ...base, title: "x", audience: "eligible" }), /unavailable/);
  await assert.rejects(postClubNotice(founder, { ...base, title: "Too late", audience: "eligible", expires: day(-1) }), /expiry date/);
  await assert.rejects(postClubNotice(founder, { ...base, title: "Too far", audience: "eligible", expires: day(200) }), /expiry date/);

  assert.deepEqual((await clubNotices(asha, club)).map(n => n.title).sort(), ["Open jam on Friday", "Rehearsal moved"], "a member sees both");
  assert.deepEqual((await clubNotices(neel, club)).map(n => n.title), ["Open jam on Friday"], "a non-member sees the open one");
  assert.deepEqual(await clubNotices(as("tenant", "student", fixtures.otherInstitution), club), []);

  await assert.rejects(withdrawClubNotice(asha, { club, notice: members }), /unavailable/);
  await withdrawClubNotice(founder, { club, notice: members });
  await assert.rejects(withdrawClubNotice(founder, { club, notice: members }), /already withdrawn/);
  await owner.query("UPDATE club_notice SET expires_on=current_date-2 WHERE institution_id=$1 AND club_id=$2 AND title='Open jam on Friday'", [fixtures.institution, club]);
  assert.deepEqual(await clubNotices(asha, club), [], "withdrawn and expired notices disappear");
  const actions = (await owner.query("SELECT action FROM audit_event WHERE entity_id=$1", [members])).rows.map(r => r.action).sort();
  assert.deepEqual(actions, ["club.notice_published", "club.notice_withdrawn"]);
});
