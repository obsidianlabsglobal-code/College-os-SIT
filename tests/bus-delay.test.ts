// covers: FC-030
import "../scripts/environment";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Pool } from "pg";
import { db } from "../lib/db";
import { busDelayNotes } from "../lib/bus-delay";
import { fixtures as f, demoEmail } from "../scripts/fixtures";
import { busDelayFixture } from "./bus-delay-fixture";

const owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
let fx: Awaited<ReturnType<typeof busDelayFixture>>;
before(async () => { fx = await busDelayFixture(owner); });
after(async () => { try { await fx?.clear(); } finally { await owner.end(); await db.end(); } });

test("a teacher sees a bus-delay note for a boarded student's first class only; no mark changes and others see nothing", async () => {
  const { ids, student, faculty } = fx;
  assert.deepEqual(await busDelayNotes(faculty, ids.first), [], "no boarding and no disruption yet");
  await fx.disrupt();
  assert.deepEqual(await busDelayNotes(faculty, ids.first), [], "a disrupted route alone is not evidence: boarding is required");
  await fx.board();
  const notes = await busDelayNotes(faculty, ids.first);
  assert.deepEqual(notes.map(n => n.student_id), [student.account]);
  assert.deepEqual(Object.keys(notes[0]).sort(), ["reported_at", "student_id"], "time only: no incident kind or location");
  assert.deepEqual(await busDelayNotes(faculty, ids.second), [], "only the student's first class that day");
  const hod = (await owner.query<{ id: string }>('SELECT id FROM "user" WHERE email=$1', [demoEmail("hod")])).rows[0].id;
  for (const who of [{ ...faculty, account: hod }, student, { ...faculty, institution: f.otherInstitution }]) assert.deepEqual(await busDelayNotes(who, ids.first), []);
  const { rows } = await owner.query("SELECT count(*)::int AS n FROM class_attendance_mark WHERE institution_id=$1 AND session_id=$2", [f.institution, ids.first]);
  assert.equal(rows[0].n, 0, "nothing is written to attendance");
});
