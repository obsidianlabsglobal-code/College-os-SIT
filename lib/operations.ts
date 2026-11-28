import type { PoolClient } from "pg";
import { z } from "zod";
import { audit, WorkflowError } from "./assignments";
import { db, transaction } from "./db";
import type { Scope } from "./scope";

// OP-002 / OP-003 / OP-004 / OP-005 / OP-009 / OP-014: room and lab bookings approved by the office, custody of equipment and
// library copies, and a room-use summary. The office is the admin role.
const unavailable = () => new WorkflowError("This action is unavailable.");
const member = (client: PoolClient, scope: Scope, account = scope.account, role: string = scope.role) => client.query(
  "SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role=$3 AND ended_at IS NULL", [scope.institution, account, role]).then(r => !!r.rowCount);
async function requireAdmin(client: PoolClient, scope: Scope) {
  const { rowCount } = await client.query("SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role='admin' AND ended_at IS NULL FOR SHARE",
    [scope.institution, scope.account]);
  if (scope.role !== "admin" || !rowCount) throw unavailable();
}
const slotInput = { start: z.iso.datetime({ local: true }), minutes: z.coerce.number().int().min(15).max(600) };
const range = (start: string, minutes: number) => `[${start}+05:30,${new Date(new Date(`${start}+05:30`).getTime() + minutes * 60000).toISOString()})`;

export type Booking = { id: string; room: string; requester: string; supervisor: string | null; purpose: string; starts_at: Date; ends_at: Date; state: string; reason: string | null; mine: boolean };
/** The requester sees their own bookings; the office sees all. Others never see private purposes. */
export async function bookings(scope: Scope) {
  return (await db.query<Booking>(`SELECT b.id,r.name AS room,ru.name AS requester,su.name AS supervisor,b.purpose,lower(b.slot) AS starts_at,upper(b.slot) AS ends_at,
      b.state,b.reason,b.requester_id=$2 AS mine
    FROM facility_booking b JOIN campus_resource r ON (r.institution_id,r.id)=(b.institution_id,b.resource_id) JOIN "user" ru ON ru.id=b.requester_id
    LEFT JOIN "user" su ON su.id=b.supervisor_id
    WHERE b.institution_id=$1 AND (b.requester_id=$2 OR $3='admin' OR b.supervisor_id=$2)
      AND EXISTS (SELECT 1 FROM membership m WHERE m.institution_id=$1 AND m.account_id=$2 AND m.role=$3 AND m.ended_at IS NULL)
    ORDER BY (b.state='requested') DESC,lower(b.slot) LIMIT 100`, [scope.institution, scope.account, scope.role])).rows;
}

const bookingInput = z.object({ room: z.uuid(), purpose: z.string().trim().min(1).max(300), supervisor: z.string().max(100).optional(), ...slotInput });
/** OP-002: a student must name a current teacher as supervisor; staff book for themselves. */
export function requestBooking(scope: Scope, raw: unknown) {
  const input = bookingInput.parse(raw);
  if (scope.role === "principal" || scope.role === "admin") throw unavailable();
  const slot = range(input.start, input.minutes);
  return transaction(async client => {
    if (!(await member(client, scope))) throw unavailable();
    if (new Date(slot.slice(1, slot.indexOf(","))) <= new Date()) throw new WorkflowError("Choose a future time.");
    if (scope.role === "student") {
      if (!input.supervisor || !(await member(client, scope, input.supervisor, "faculty"))) throw new WorkflowError("Name a current teacher who will supervise.");
    }
    const { rowCount } = await client.query("SELECT 1 FROM campus_resource WHERE institution_id=$1 AND id=$2 AND kind='room'", [scope.institution, input.room]);
    if (!rowCount) throw new WorkflowError("Choose a room or lab.");
    const { rows: [row] } = await client.query<{ id: string }>(`INSERT INTO facility_booking (institution_id,resource_id,requester_id,supervisor_id,purpose,slot)
      VALUES ($1,$2,$3,$4,$5,$6::tstzrange) RETURNING id`, [scope.institution, input.room, scope.account, scope.role === "student" ? input.supervisor : null, input.purpose, slot]);
    await audit(client, scope, row.id, "booking.requested");
    return row.id;
  });
}

/** OP-014: the office approves (no clash with approved bookings or published classes) or declines, with a reason. */
export function decideBooking(scope: Scope, raw: unknown) {
  const input = z.object({ booking: z.uuid(), decision: z.enum(["approved", "declined"]), reason: z.string().trim().min(1).max(500) }).parse(raw);
  return transaction(async client => {
    await requireAdmin(client, scope);
    const { rows: [b] } = await client.query<{ state: string; resource_id: string; slot: string; future: boolean }>(
      "SELECT state,resource_id,slot::text,lower(slot)>clock_timestamp() AS future FROM facility_booking WHERE institution_id=$1 AND id=$2 FOR UPDATE",
      [scope.institution, input.booking]);
    if (!b || b.state !== "requested") throw new WorkflowError("This request is unavailable or already decided.");
    if (input.decision === "approved") {
      if (!b.future) throw new WorkflowError("This slot has already started.");
      const { rowCount } = await client.query(`SELECT 1 FROM class_session WHERE institution_id=$1 AND room_id=$2 AND state IN ('published','conducted') AND slot && $3::tstzrange`,
        [scope.institution, b.resource_id, b.slot]);
      if (rowCount) throw new WorkflowError("A class is scheduled in this room at that time.");
    }
    try {
      await client.query("UPDATE facility_booking SET state=$3,decided_by=$4,reason=$5 WHERE institution_id=$1 AND id=$2",
        [scope.institution, input.booking, input.decision, scope.account, input.reason]);
    } catch (error) {
      if ((error as { code?: string }).code === "23P01") throw new WorkflowError("Another approved booking already holds this room at that time.");
      throw error;
    }
    await audit(client, scope, input.booking, `booking.${input.decision}`);
  });
}

export function cancelBooking(scope: Scope, id: unknown) {
  const booking = z.uuid().parse(id);
  return transaction(async client => {
    const { rowCount } = await client.query(`UPDATE facility_booking SET state='cancelled' WHERE institution_id=$1 AND id=$2 AND requester_id=$3
      AND state IN ('requested','approved') AND lower(slot) > clock_timestamp()`, [scope.institution, booking, scope.account]);
    if (!rowCount) throw new WorkflowError("This booking can no longer be cancelled.");
    await audit(client, scope, booking, "booking.cancelled");
  });
}

export type Holding = { id: string; title: string; author: string; copies: number; available: number };
/** OP-004: every current member can search the holdings. */
export async function holdings(scope: Scope, query = "") {
  return (await db.query<Holding>(`SELECT b.id,b.title,b.author,b.copies,
      b.copies-(SELECT count(*)::int FROM custody_loan l WHERE (l.institution_id,l.book_id)=(b.institution_id,b.id) AND l.returned_at IS NULL) AS available
    FROM library_item b WHERE b.institution_id=$1 AND strpos(lower(b.title||' '||b.author),lower($4))>0
      AND EXISTS (SELECT 1 FROM membership m WHERE m.institution_id=$1 AND m.account_id=$2 AND m.role=$3 AND m.ended_at IS NULL)
    ORDER BY b.title LIMIT 50`, [scope.institution, scope.account, scope.role, query.trim().slice(0, 120)])).rows;
}

export function addHolding(scope: Scope, raw: unknown) {
  const input = z.object({ title: z.string().trim().min(1).max(200), author: z.string().trim().min(1).max(160), copies: z.coerce.number().int().min(1).max(500) }).parse(raw);
  return transaction(async client => {
    await requireAdmin(client, scope);
    const { rows: [row] } = await client.query<{ id: string }>("INSERT INTO library_item (institution_id,title,author,copies,created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [scope.institution, input.title, input.author, input.copies, scope.account]);
    await audit(client, scope, row.id, "library.item_added");
    return row.id;
  });
}

const issueInput = z.object({ item: z.uuid(), kind: z.enum(["book", "equipment"]), borrower: z.string().min(1).max(100), due: z.iso.date() });
/** OP-003 / OP-004: the office issues one copy or one piece of equipment to a current member, if one is free. */
export function issueLoan(scope: Scope, raw: unknown) {
  const input = issueInput.parse(raw);
  return transaction(async client => {
    await requireAdmin(client, scope);
    const { rowCount: current } = await client.query("SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND ended_at IS NULL", [scope.institution, input.borrower]);
    if (!current) throw new WorkflowError("Choose a current member.");
    const { rows: [{ ok }] } = await client.query<{ ok: boolean }>("SELECT $1::date >= (now() AT TIME ZONE 'Asia/Kolkata')::date AS ok", [input.due]);
    if (!ok) throw new WorkflowError("The due date cannot be in the past.");
    if (input.kind === "book") {
      const { rows: [b] } = await client.query<{ copies: number }>("SELECT copies FROM library_item WHERE institution_id=$1 AND id=$2 FOR UPDATE", [scope.institution, input.item]);
      if (!b) throw unavailable();
      const { rows: [{ out }] } = await client.query<{ out: number }>("SELECT count(*)::int AS out FROM custody_loan WHERE institution_id=$1 AND book_id=$2 AND returned_at IS NULL",
        [scope.institution, input.item]);
      if (out >= b.copies) throw new WorkflowError("No copy is available.");
    } else {
      const { rowCount } = await client.query("SELECT 1 FROM campus_resource WHERE institution_id=$1 AND id=$2 AND kind='equipment'", [scope.institution, input.item]);
      if (!rowCount) throw unavailable();
    }
    try {
      const { rows: [row] } = await client.query<{ id: string }>(`INSERT INTO custody_loan (institution_id,book_id,resource_id,borrower_id,due_on,issued_by)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [scope.institution, input.kind === "book" ? input.item : null, input.kind === "equipment" ? input.item : null,
        input.borrower, input.due, scope.account]);
      await audit(client, scope, row.id, `loan.issued_${input.kind}`, undefined, input.borrower);
      return row.id;
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw new WorkflowError("This equipment is already out.");
      throw error;
    }
  });
}

/** OP-003: the office receives an item back and inspects its condition. */
export function returnLoan(scope: Scope, raw: unknown) {
  const input = z.object({ loan: z.uuid(), condition: z.enum(["good", "damaged", "lost"]) }).parse(raw);
  return transaction(async client => {
    await requireAdmin(client, scope);
    const { rowCount } = await client.query(`UPDATE custody_loan SET returned_at=clock_timestamp(),received_by=$3,condition=$4
      WHERE institution_id=$1 AND id=$2 AND returned_at IS NULL`, [scope.institution, input.loan, scope.account, input.condition]);
    if (!rowCount) throw new WorkflowError("This loan is unavailable or already returned.");
    await audit(client, scope, input.loan, `loan.returned_${input.condition}`);
  });
}

export type Loan = { id: string; item: string; kind: "book" | "equipment"; borrower: string; due_on: string; overdue: boolean; returned_at: Date | null; condition: string | null };
/** A member sees their own loans; the office sees every open loan and the last 50 returns (OP-005 custody history). */
export async function loans(scope: Scope) {
  return (await db.query<Loan>(`SELECT l.id,coalesce(b.title,r.name) AS item,CASE WHEN l.book_id IS NULL THEN 'equipment' ELSE 'book' END AS kind,u.name AS borrower,
      to_char(l.due_on,'YYYY-MM-DD') AS due_on,(l.returned_at IS NULL AND l.due_on < (now() AT TIME ZONE 'Asia/Kolkata')::date) AS overdue,l.returned_at,l.condition
    FROM custody_loan l JOIN "user" u ON u.id=l.borrower_id
    LEFT JOIN library_item b ON (b.institution_id,b.id)=(l.institution_id,l.book_id) LEFT JOIN campus_resource r ON (r.institution_id,r.id)=(l.institution_id,l.resource_id)
    WHERE l.institution_id=$1 AND (l.borrower_id=$2 OR $3='admin')
      AND EXISTS (SELECT 1 FROM membership m WHERE m.institution_id=$1 AND m.account_id=$2 AND m.role=$3 AND m.ended_at IS NULL)
    ORDER BY (l.returned_at IS NULL) DESC,l.due_on LIMIT 80`, [scope.institution, scope.account, scope.role])).rows;
}

/** OP-009 / DH-018: hours of published classes and approved bookings per room over the next seven days, for the office and
 * department heads (who plan and request lab time). Only totals are shown, never who booked or why. */
export async function roomUse(scope: Scope) {
  if (scope.role !== "admin" && scope.role !== "hod") return [];
  return (await db.query<{ room: string; class_hours: number; booking_hours: number; requested: number }>(`SELECT * FROM (SELECT r.name AS room,
      coalesce(round((SELECT sum(extract(epoch FROM upper(s.slot)-lower(s.slot)))/3600 FROM class_session s WHERE (s.institution_id,s.room_id)=(r.institution_id,r.id)
        AND s.state IN ('published','conducted') AND s.slot && tstzrange(clock_timestamp(),clock_timestamp()+interval '7 days'))::numeric,1),0)::float8 AS class_hours,
      coalesce(round((SELECT sum(extract(epoch FROM upper(b.slot)-lower(b.slot)))/3600 FROM facility_booking b WHERE (b.institution_id,b.resource_id)=(r.institution_id,r.id)
        AND b.state='approved' AND b.slot && tstzrange(clock_timestamp(),clock_timestamp()+interval '7 days'))::numeric,1),0)::float8 AS booking_hours,
      (SELECT count(*)::int FROM facility_booking b WHERE (b.institution_id,b.resource_id)=(r.institution_id,r.id) AND b.state='requested') AS requested
    FROM campus_resource r WHERE r.institution_id=$1 AND r.kind='room'
      AND EXISTS (SELECT 1 FROM membership m WHERE m.institution_id=$1 AND m.account_id=$2 AND m.role IN ('admin','hod') AND m.role=$3 AND m.ended_at IS NULL)
    ) used ORDER BY class_hours+booking_hours DESC,room LIMIT 40`, [scope.institution, scope.account, scope.role])).rows;
}

export async function operationChoices(scope: Scope) {
  const [rooms, equipment, teachers, people] = await Promise.all([
    db.query<{ id: string; name: string }>("SELECT id,name FROM campus_resource WHERE institution_id=$1 AND kind='room' ORDER BY name", [scope.institution]),
    scope.role === "admin" ? db.query<{ id: string; name: string }>("SELECT id,name FROM campus_resource WHERE institution_id=$1 AND kind='equipment' ORDER BY name", [scope.institution]) : { rows: [] },
    db.query<{ id: string; name: string }>(`SELECT DISTINCT u.id,u.name FROM membership m JOIN "user" u ON u.id=m.account_id
      WHERE m.institution_id=$1 AND m.role='faculty' AND m.ended_at IS NULL ORDER BY u.name`, [scope.institution]),
    scope.role === "admin" ? db.query<{ id: string; name: string }>(`SELECT DISTINCT u.id,u.name FROM membership m JOIN "user" u ON u.id=m.account_id
      WHERE m.institution_id=$1 AND m.ended_at IS NULL ORDER BY u.name`, [scope.institution]) : { rows: [] },
  ]);
  return { rooms: rooms.rows, equipment: equipment.rows, teachers: teachers.rows, people: people.rows };
}

export type EquipmentStatus = { id: string; name: string; location: string; state: "available" | "on loan" | "overdue"; due_on: string | null; last_condition: string | null };
/** DH-019: equipment and whether it is free, on loan or overdue, with its last returned condition. The office also sees who
 * holds it on the loans list; department heads see status only. */
export async function equipmentStatus(scope: Scope) {
  if (scope.role !== "admin" && scope.role !== "hod") return [];
  return (await db.query<EquipmentStatus>(`SELECT r.id,r.name,r.location,
      CASE WHEN l.id IS NULL THEN 'available' WHEN l.due_on < (now() AT TIME ZONE 'Asia/Kolkata')::date THEN 'overdue' ELSE 'on loan' END AS state,
      to_char(l.due_on,'YYYY-MM-DD') AS due_on,
      (SELECT x.condition FROM custody_loan x WHERE (x.institution_id,x.resource_id)=(r.institution_id,r.id) AND x.returned_at IS NOT NULL ORDER BY x.returned_at DESC LIMIT 1) AS last_condition
    FROM campus_resource r LEFT JOIN custody_loan l ON (l.institution_id,l.resource_id)=(r.institution_id,r.id) AND l.returned_at IS NULL
    WHERE r.institution_id=$1 AND r.kind='equipment'
      AND EXISTS (SELECT 1 FROM membership m WHERE m.institution_id=$1 AND m.account_id=$2 AND m.role=$3 AND m.role IN ('admin','hod') AND m.ended_at IS NULL)
    ORDER BY r.name`, [scope.institution, scope.account, scope.role])).rows;
}

export type BusyTime = { starts_at: Date; ends_at: Date; kind: "class" | "booked" };
/** SP-012 / OP-002: when a room is taken on a college-local date (published classes and approved bookings), for any current
 * member planning a request. Times only: never who booked it, why, or which class. */
export async function busyTimes(scope: Scope, raw: unknown) {
  const input = z.object({ room: z.uuid(), date: z.iso.date() }).parse(raw);
  return (await db.query<BusyTime>(`WITH day AS (
      SELECT tstzrange(($5::date)::timestamp AT TIME ZONE i.timezone,($5::date+1)::timestamp AT TIME ZONE i.timezone) AS span
      FROM institution i JOIN campus_resource r ON r.institution_id=i.id AND r.id=$4 AND r.kind='room'
      WHERE i.id=$1 AND EXISTS (SELECT 1 FROM membership m WHERE m.institution_id=$1 AND m.account_id=$2 AND m.role=$3 AND m.ended_at IS NULL))
    SELECT lower(s.slot) AS starts_at,upper(s.slot) AS ends_at,'class' AS kind FROM class_session s,day
      WHERE s.institution_id=$1 AND s.room_id=$4 AND s.state IN ('published','conducted') AND s.slot && day.span
    UNION ALL
    SELECT lower(b.slot),upper(b.slot),'booked' FROM facility_booking b,day
      WHERE b.institution_id=$1 AND b.resource_id=$4 AND b.state='approved' AND b.slot && day.span
    ORDER BY 1 LIMIT 100`, [scope.institution, scope.account, scope.role, input.room, input.date])).rows;
}
