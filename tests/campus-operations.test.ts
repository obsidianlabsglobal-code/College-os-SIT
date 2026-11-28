// covers: DH-018, DH-019, AD-025, AD-026, OP-002, OP-003, OP-004, OP-005, OP-009, OP-014, ID-004, ID-006
import "../scripts/environment";
import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { db } from "../lib/db";
import { WorkflowError } from "../lib/assignments";
import { addHolding, bookings, cancelBooking, decideBooking, equipmentStatus, holdings, issueLoan, loans, requestBooking, returnLoan, roomUse } from "../lib/operations";
import { fixtures, demoEmail, personas } from "../scripts/fixtures";
import type { Scope } from "../lib/scope";

const owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const as = new Map<string, Scope>();
const i = fixtures.institution;
const tag = randomUUID().slice(0, 8);
const ids = { lab: randomUUID(), scope: randomUUID(), session: randomUUID() };
const rejects = (run: () => Promise<unknown>, pattern?: RegExp) =>
  assert.rejects(async () => run(), (e: unknown) => (e instanceof WorkflowError || (e as Error).name === "ZodError") && (!pattern || pattern.test((e as Error).message)));
const local = (hours: number) => new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Kolkata" })
  .format(new Date(Date.now() + hours * 3600000)).replace(" ", "T");
const day = (d: number) => local(d * 24).slice(0, 10);

before(async () => {
  for (const url of [process.env.MIGRATION_DATABASE_URL, process.env.DATABASE_URL]) assert.ok(url && ["127.0.0.1", "localhost"].includes(new URL(url).hostname));
  for (const [alias, [, , role]] of Object.entries(personas)) {
    const { rows: [row] } = await owner.query('SELECT id FROM "user" WHERE email=$1', [demoEmail(alias)]);
    as.set(alias, { account: row.id, role, institution: alias === "tenant" ? fixtures.otherInstitution : fixtures.institution });
  }
  await owner.query("INSERT INTO campus_resource (institution_id,id,name,kind,location) VALUES ($1,$2,$3,'room','Fictional'),($1,$4,$5,'equipment','Fictional')",
    [i, ids.lab, `Lab ${tag}`, ids.scope, `Oscilloscope ${tag}`]);
  await owner.query(`INSERT INTO class_session (institution_id,id,series_id,offering_id,section_id,faculty_id,room_id,slot,state,created_by,published_at)
    SELECT $1,$2,gen_random_uuid(),$3,o.section_id,$4,$5,tstzrange(now()+interval '70 hours',now()+interval '72 hours'),'published',$4,now()
    FROM offering o WHERE o.institution_id=$1 AND o.id=$3`, [i, ids.session, fixtures.offering, as.get("faculty")!.account, ids.lab]);
});
after(async () => {
  await owner.query("DELETE FROM custody_loan WHERE institution_id=$1 AND (resource_id=$2 OR book_id IN (SELECT id FROM library_item WHERE institution_id=$1 AND title LIKE $3))", [i, ids.scope, `% ${tag}`]);
  await owner.query("DELETE FROM library_item WHERE institution_id=$1 AND title LIKE $2", [i, `% ${tag}`]);
  await owner.query("DELETE FROM facility_booking WHERE institution_id=$1 AND resource_id=$2", [i, ids.lab]);
  await owner.query("DELETE FROM class_session WHERE institution_id=$1 AND id=$2", [i, ids.session]);
  await owner.query("DELETE FROM campus_resource WHERE institution_id=$1 AND id IN ($2,$3)", [i, ids.lab, ids.scope]);
  await Promise.all([db.end(), owner.end()]);
});

test("lab bookings need a supervising teacher for students and an office decision that avoids classes and approved bookings", async () => {
  const student = as.get("student")!, faculty = as.get("faculty")!, admin = as.get("admin")!;
  const slot = { room: ids.lab, purpose: `Project build ${tag}`, start: local(30), minutes: 120 };
  await rejects(() => requestBooking(student, slot), /supervise/);
  await rejects(() => requestBooking(student, { ...slot, supervisor: as.get("outsider")!.account }), /supervise/);
  await rejects(() => requestBooking(admin, slot));
  await rejects(() => requestBooking(student, { ...slot, supervisor: faculty.account, start: local(-1) }), /future/);
  const mine = await requestBooking(student, { ...slot, supervisor: faculty.account });
  const theirs = await requestBooking(faculty, { ...slot, purpose: `Calibration ${tag}` });
  const clash = await requestBooking(faculty, { ...slot, purpose: `During class ${tag}`, start: local(70.5), minutes: 60 });
  assert.ok((await bookings(faculty)).some(b => b.id === mine), "the supervisor sees it");
  assert.ok(!(await bookings(as.get("outsider")!)).some(b => b.id === mine), "other students do not");
  await rejects(() => decideBooking(faculty, { booking: mine, decision: "approved", reason: "x" }));
  await rejects(() => decideBooking(admin, { booking: clash, decision: "approved", reason: "x" }), /class is scheduled/);
  await decideBooking(admin, { booking: mine, decision: "approved", reason: "Lab assistant on duty" });
  await rejects(() => decideBooking(admin, { booking: theirs, decision: "approved", reason: "x" }), /already holds/);
  await decideBooking(admin, { booking: theirs, decision: "declined", reason: "Slot already approved for a student project" });
  await rejects(() => decideBooking(admin, { booking: mine, decision: "declined", reason: "x" }), /already decided/);
  await rejects(() => cancelBooking(faculty, mine));
  await cancelBooking(student, mine);
  assert.equal((await bookings(student)).find(b => b.id === mine)?.state, "cancelled");
  assert.ok(!(await bookings({ ...as.get("tenant")!, role: "admin" })).some(b => b.id === mine));
});

test("the office lends library copies and equipment, receives them with a condition, and tracks custody", async () => {
  const admin = as.get("admin")!, student = as.get("student")!, faculty = as.get("faculty")!;
  await rejects(() => addHolding(student, { title: `x ${tag}`, author: "x", copies: 1 }));
  const book = await addHolding(admin, { title: `Signals and Systems ${tag}`, author: "Fictional Author", copies: 1 });
  assert.equal((await holdings(student, tag))[0].available, 1);
  assert.deepEqual(await holdings({ ...as.get("tenant")!, role: "student" }, tag), []);
  await rejects(() => issueLoan(faculty, { item: book, kind: "book", borrower: student.account, due: day(7) }));
  await rejects(() => issueLoan(admin, { item: book, kind: "book", borrower: student.account, due: day(-1) }), /past/);
  await rejects(() => issueLoan(admin, { item: book, kind: "book", borrower: as.get("tenant")!.account, due: day(7) }), /current member/);
  const loan = await issueLoan(admin, { item: book, kind: "book", borrower: student.account, due: day(7) });
  await rejects(() => issueLoan(admin, { item: book, kind: "book", borrower: faculty.account, due: day(7) }), /No copy/);
  assert.equal((await holdings(student, tag))[0].available, 0);
  const kit = await issueLoan(admin, { item: ids.scope, kind: "equipment", borrower: faculty.account, due: day(3) });
  await rejects(() => issueLoan(admin, { item: ids.scope, kind: "equipment", borrower: student.account, due: day(3) }), /already out/);
  await rejects(() => issueLoan(admin, { item: book, kind: "equipment", borrower: student.account, due: day(3) }));
  assert.deepEqual((await loans(student)).filter(l => l.item.includes(tag)).map(l => l.id), [loan], "a member sees only their own loans");
  assert.ok((await loans(admin)).some(l => l.id === kit && l.borrower === "Riya Rao"), "the office sees the current custodian");
  await rejects(() => returnLoan(student, { loan, condition: "good" }));
  await returnLoan(admin, { loan: kit, condition: "damaged" });
  await rejects(() => returnLoan(admin, { loan: kit, condition: "good" }), /already returned/);
  assert.equal((await loans(admin)).find(l => l.id === kit)?.condition, "damaged");
  await returnLoan(admin, { loan, condition: "good" });
  assert.equal((await holdings(student, tag))[0].available, 1);
});

test("room use counts published classes and approved bookings for the office only", async () => {
  const lab = (await roomUse(as.get("admin")!)).find(r => r.room === `Lab ${tag}`)!;
  assert.equal(lab.class_hours, 2);
  assert.equal(lab.booking_hours, 0, "the approved booking was cancelled");
  for (const alias of ["student", "faculty", "principal"]) assert.deepEqual(await roomUse(as.get(alias)!), []);
});

test("department heads see room use and equipment status, without who booked or holds what", async () => {
  const hod = as.get("hod")!;
  const lab = (await roomUse(hod)).find(r => r.room === `Lab ${tag}`)!;
  assert.equal(lab.class_hours, 2);
  assert.ok(!("requester" in lab), "totals only");
  const scope = (await equipmentStatus(hod)).find(e => e.name === `Oscilloscope ${tag}`)!;
  assert.deepEqual([scope.state, scope.last_condition], ["available", "damaged"], "returned damaged earlier, free now");
  assert.ok(!("borrower" in scope));
  for (const alias of ["student", "faculty", "principal"]) assert.deepEqual(await equipmentStatus(as.get(alias)!), []);
  assert.deepEqual(await equipmentStatus({ ...as.get("tenant")!, role: "hod" }), []);
});
