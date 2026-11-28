// covers: CL-044, CL-046
import "../scripts/environment";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { changeClub } from "../lib/clubverse";
import { eventExtras, giveFeedback, joinWaitlist, withdraw } from "../lib/club-events";
import { db } from "../lib/db";
import type { Scope } from "../lib/scope";
import { fixtures, demoEmail } from "../scripts/fixtures";

const owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const id = new Map<string, string>();
const as = (alias: string, role: Scope["role"], institution = fixtures.institution): Scope => ({ institution, account: id.get(alias)!, role });
const stamp = (offset: number) => new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Kolkata" })
  .format(new Date(Date.now() + offset)).replace(" ", "T");

before(async () => {
  for (const alias of ["student", "outsider", "faculty", "admin", "tenant"])
    id.set(alias, (await owner.query<{ id: string }>('SELECT id FROM "user" WHERE email=$1', [demoEmail(alias)])).rows[0].id);
});
after(async () => { await Promise.all([db.end(), owner.end()]); });

test("a full event keeps a waitlist; a withdrawal promotes the earliest; feedback after completion is anonymous to officers", async () => {
  const founder = as("faculty", "faculty"), admin = as("admin", "admin"), asha = as("student", "student"), neel = as("outsider", "student");
  const club = await changeClub(founder, { operation: "draft", name: `Robotics ${randomUUID()}`, purpose: "Build robots.", rules: "Weekly.", category: "technical", joining: "open", audience: "campus" });
  for (const [revision, next, who] of [[0, "submitted", founder], [1, "under_review", admin], [2, "approved", admin]] as const)
    await changeClub(who, { operation: "proposal", id: club, revision, next });
  const event = await changeClub(founder, { operation: "event-draft", club, title: "Line follower build", location: "Lab 2", requirements: "None",
    audience: "eligible", capacity: 1, starts: stamp(3600000), ends: stamp(7200000) });
  for (const [revision, next, who] of [[0, "pending_approval", founder], [1, "approved", admin], [2, "published", founder], [3, "registration_open", founder]] as const)
    await changeClub(who, { operation: "event-state", club, id: event, revision, next });
  const ref = { club, event };

  await assert.rejects(joinWaitlist(asha, ref), /Register instead/);
  await changeClub(asha, { operation: "register", club, id: event });
  await assert.rejects(joinWaitlist(asha, ref), /already registered/);
  await joinWaitlist(neel, ref);
  await assert.rejects(joinWaitlist(neel, ref), /already on the waitlist/);
  for (const who of [founder, as("tenant", "student", fixtures.otherInstitution)]) await assert.rejects(joinWaitlist(who, ref), /unavailable/);
  assert.equal((await eventExtras(neel, club, [event], false)).get(event)?.my_place, 1);

  assert.equal(await withdraw(asha, ref), neel.account, "Neel takes the seat");
  const { rows } = await owner.query("SELECT account_id FROM club_registration WHERE institution_id=$1 AND event_id=$2", [asha.institution, event]);
  assert.deepEqual(rows.map(r => r.account_id), [neel.account]);
  assert.equal((await eventExtras(neel, club, [event], false)).get(event)?.waiting, 0);
  await assert.rejects(withdraw(asha, ref), /not registered/);

  await owner.query("UPDATE club_event SET starts_at=now()-interval '1 minute' WHERE institution_id=$1 AND id=$2", [asha.institution, event]);
  await assert.rejects(withdraw(neel, ref), /before the event starts/);
  await assert.rejects(giveFeedback(neel, { ...ref, rating: 5 }), /when the event is completed/);
  await changeClub(founder, { operation: "event-state", club, id: event, revision: 4, next: "registration_closed" });
  await changeClub(founder, { operation: "event-state", club, id: event, revision: 5, next: "in_progress" });
  await changeClub(founder, { operation: "event-state", club, id: event, revision: 6, next: "completed" });
  await assert.rejects(giveFeedback(asha, { ...ref, rating: 4 }), /unavailable/, "only registered students");
  await giveFeedback(neel, { ...ref, rating: 4, comment: "More soldering time please." });
  await assert.rejects(giveFeedback(neel, { ...ref, rating: 1 }), /already given/);
  const summary = (await eventExtras(founder, club, [event], true)).get(event)!;
  assert.deepEqual([summary.responses, summary.average, summary.comments], [1, 4, ["More soldering time please."]]);
  assert.equal((await eventExtras(neel, club, [event], false)).get(event)?.responses, 0, "students see no summary");
  const actions = (await owner.query("SELECT action FROM audit_event WHERE entity_id=$1 ORDER BY occurred_at", [event])).rows.map(r => r.action);
  for (const a of ["club.event_waitlisted", "club.event_withdrawn", "club.event_waitlist_promoted", "club.event_feedback_given"]) assert.ok(actions.includes(a), a);
});
