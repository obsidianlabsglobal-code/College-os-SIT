// covers: FC-030
import "../scripts/environment";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { db } from "../lib/db";
import { busDelayNotes } from "../lib/bus-delay";
import { openCase } from "../lib/cases";
import { changeTransportCatalog } from "../lib/transport/catalog";
import { changeTransportTrip } from "../lib/transport/trips";
import { fictionalTransportRoutes } from "../lib/transport/demo-fixtures";
import { fixtures as f, demoEmail } from "../scripts/fixtures";
import type { Scope } from "../lib/scope";
import { clearTransportFixture, grantFakeTransportOffice } from "./transport-fixture";

const owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const tag = randomUUID().slice(0, 8), code = `DELAY-${tag}`, title = `Fixture delay bus ${tag}`, day = "2027-03-03"; // a Wednesday
const ids = { room: randomUUID(), first: randomUUID(), second: randomUUID() };
let gate: Awaited<ReturnType<typeof grantFakeTransportOffice>>, office: Scope, student: Scope, faculty: Scope, other: Scope;
let trip = "", disruptionCase = "";
const saved = process.env.NEXUS_TRANSPORT_SIMULATION_ENABLED;

before(async () => {
  gate = await grantFakeTransportOffice(owner);
  office = { institution: f.institution, role: "transport", account: gate.account };
  const id = async (alias: string) => (await owner.query<{ id: string }>('SELECT id FROM "user" WHERE email=$1', [demoEmail(alias)])).rows[0].id;
  student = { institution: f.institution, role: "student", account: await id("student") };
  faculty = { institution: f.institution, role: "faculty", account: await id("faculty") };
  other = { institution: f.institution, role: "faculty", account: await id("hod") };
  process.env.NEXUS_TRANSPORT_SIMULATION_ENABLED = "true";
});
after(async () => {
  if (saved === undefined) delete process.env.NEXUS_TRANSPORT_SIMULATION_ENABLED; else process.env.NEXUS_TRANSPORT_SIMULATION_ENABLED = saved;
  try {
    if (trip) for (const table of ["transport_disruption", "transport_boarding", "transport_trip_rider"]) await owner.query(`DELETE FROM ${table} WHERE institution_id=$1 AND trip_id=$2`, [f.institution, trip]);
    if (disruptionCase) await owner.query("DELETE FROM case_record WHERE institution_id=$1 AND id=$2", [f.institution, disruptionCase]);
    if (trip) await owner.query("DELETE FROM transport_trip WHERE institution_id=$1 AND id=$2", [f.institution, trip]);
    await owner.query("DELETE FROM class_session WHERE institution_id=$1 AND id=ANY($2)", [f.institution, [ids.first, ids.second]]);
    await owner.query("DELETE FROM campus_resource WHERE institution_id=$1 AND id=$2", [f.institution, ids.room]);
    if (gate) await clearTransportFixture(owner, [code], [title], gate);
  } finally { await owner.end(); await db.end(); }
});

test("a teacher sees a bus-delay note for a boarded student's first class only; no mark changes and others see nothing", async () => {
  const route = await changeTransportCatalog(office, { operation: "create-route", code, title, direction: "inbound" });
  await changeTransportCatalog(office, { operation: "publish-stops", route, expected: 0, stops: fictionalTransportRoutes[0].stops });
  const vehicle = await changeTransportCatalog(office, { operation: "create-vehicle", title, seats: 36, capacity: 40 });
  const schedule = await changeTransportCatalog(office, { operation: "create-schedule", route, vehicle, weekday: 3, departure: "04:00" });
  trip = await changeTransportTrip(office, { operation: "create-trip", schedule, day, mode: "simulated" });

  await owner.query("INSERT INTO campus_resource (institution_id,id,name,kind,location) VALUES ($1,$2,$3,'room','Fictional')", [f.institution, ids.room, `Delay room ${tag}`]);
  for (const [sid, from, to] of [[ids.first, "05:00", "05:50"], [ids.second, "06:00", "06:50"]])
    await owner.query(`INSERT INTO class_session (institution_id,id,series_id,offering_id,section_id,faculty_id,room_id,slot,state,created_by,published_at)
      SELECT $1,$2,gen_random_uuid(),$3,o.section_id,$4,$5,tstzrange(($6::date+$7::time) AT TIME ZONE 'Asia/Kolkata',($6::date+$8::time) AT TIME ZONE 'Asia/Kolkata'),'published',$4,now()
      FROM offering o WHERE o.institution_id=$1 AND o.id=$3`, [f.institution, sid, f.offering, faculty.account, ids.room, day, from, to]);

  assert.deepEqual(await busDelayNotes(faculty, ids.first), [], "no boarding and no disruption yet");
  const { rows: [t] } = await owner.query("SELECT route_id,revision FROM transport_trip WHERE institution_id=$1 AND id=$2", [f.institution, trip]);
  const { rows: [stop] } = await owner.query("SELECT stop_id FROM transport_route_stop WHERE institution_id=$1 AND route_id=$2 AND revision=$3 ORDER BY 1 LIMIT 1", [f.institution, t.route_id, t.revision]);
  await owner.query("INSERT INTO transport_trip_rider (institution_id,trip_id,student_id,route_id,revision,stop_id,released_at) VALUES ($1,$2,$3,$4,$5,$6,now())",
    [f.institution, trip, student.account, t.route_id, t.revision, stop.stop_id]);
  disruptionCase = await openCase(student, { kind: "transport_incident", title: `Delay ${tag}`, body: "Fictional" });
  await owner.query(`INSERT INTO transport_disruption (institution_id,trip_id,route_id,revision,stop_id,case_id,kind,created_by)
    VALUES ($1,$2,$3,$4,$5,$6,'heavy_traffic',$7)`, [f.institution, trip, t.route_id, t.revision, stop.stop_id, disruptionCase, office.account]);
  assert.deepEqual(await busDelayNotes(faculty, ids.first), [], "a disrupted route alone is not evidence: boarding is required");

  await owner.query("INSERT INTO transport_boarding (institution_id,trip_id,student_id,method) VALUES ($1,$2,$3,'sticker')", [f.institution, trip, student.account]);
  const notes = await busDelayNotes(faculty, ids.first);
  assert.deepEqual(notes.map(n => n.student_id), [student.account]);
  assert.deepEqual(Object.keys(notes[0]).sort(), ["reported_at", "student_id"], "time only: no incident kind or location");
  assert.deepEqual(await busDelayNotes(faculty, ids.second), [], "only the student's first class that day");
  for (const who of [other, student, { ...faculty, institution: f.otherInstitution }]) assert.deepEqual(await busDelayNotes(who, ids.first), []);
  const { rows } = await owner.query("SELECT count(*)::int AS n FROM class_attendance_mark WHERE institution_id=$1 AND session_id=$2", [f.institution, ids.first]);
  assert.equal(rows[0].n, 0, "nothing is written to attendance");
});
