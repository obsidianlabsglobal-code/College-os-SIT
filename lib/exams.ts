import type { PoolClient } from "pg";
import { z } from "zod";
import { audit, WorkflowError } from "./assignments";
import { db, transaction } from "./db";
import type { Scope } from "./scope";

// SA-015 / SA-016 / AD-009 / AD-029 / LE-008: the office (admin) drafts and publishes examination sittings with a room
// and an invigilator. Publication checks the section, room and invigilator against published exams (database
// exclusion constraints), classes and confirmed bookings. Readers see only published sittings in their scope.
const unavailable = () => new WorkflowError("This sitting is unavailable or has already changed.");
const wall = z.iso.datetime({ local: true, precision: -1 }).refine(v => !v.endsWith("Z"));
const draftInput = z.object({
  offering: z.uuid(), kind: z.enum(["internal", "external"]), title: z.string().trim().min(1).max(160),
  start: wall, end: wall, room: z.uuid(), invigilator: z.string().min(1).max(100), source: z.string().trim().max(300).optional(),
}).refine(v => v.kind === "internal" || !!v.source, { message: "Enter the official source for an external examination." });

async function requireAdmin(client: PoolClient, scope: Scope) {
  if (scope.role !== "admin") throw unavailable();
  const { rowCount } = await client.query("SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role='admin' AND ended_at IS NULL FOR SHARE",
    [scope.institution, scope.account]);
  if (!rowCount) throw unavailable();
}

export function draftExam(scope: Scope, raw: unknown) {
  const input = draftInput.parse(raw);
  return transaction(async client => {
    await requireAdmin(client, scope);
    const { rows: [row] } = await client.query<{ id: string }>(`INSERT INTO exam_sitting
      (institution_id,offering_id,section_id,kind,title,slot,room_id,invigilator_id,source,created_by)
      SELECT o.institution_id,o.id,o.section_id,$3,$4,tstzrange($5::timestamp AT TIME ZONE i.timezone,$6::timestamp AT TIME ZONE i.timezone,'[)'),
        room.id,$8,$9,$10
      FROM offering o JOIN institution i ON i.id=o.institution_id
      JOIN campus_resource room ON room.institution_id=o.institution_id AND room.id=$7 AND room.kind='room'
      JOIN membership f ON f.institution_id=o.institution_id AND f.account_id=$8 AND f.role='faculty' AND f.ended_at IS NULL
      WHERE o.institution_id=$1 AND o.id=$2 AND $6::timestamp > $5::timestamp AND $5::timestamp AT TIME ZONE i.timezone > clock_timestamp()
      RETURNING id`, [scope.institution, input.offering, input.kind, input.title, input.start, input.end, input.room, input.invigilator,
      input.source || null, scope.account]);
    if (!row) throw new WorkflowError("Choose a future time, a room and a current faculty invigilator.");
    await audit(client, scope, row.id, "exam.drafted", 1);
    return row.id;
  });
}

export function publishExam(scope: Scope, raw: unknown) {
  const input = z.object({ exam: z.uuid(), revision: z.number().int().min(1) }).parse(raw);
  return transaction(async client => {
    await requireAdmin(client, scope);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`exam-schedule:${scope.institution}`]);
    const { rows: [exam] } = await client.query<{ state: string; revision: number; future: boolean }>(
      "SELECT state,revision,lower(slot)>clock_timestamp() AS future FROM exam_sitting WHERE institution_id=$1 AND id=$2 FOR UPDATE", [scope.institution, input.exam]);
    if (!exam || exam.state !== "draft" || !exam.future) throw unavailable();
    if (exam.revision !== input.revision) throw new WorkflowError("This sitting changed. Refresh before publishing.");
    const { rows: [clash] } = await client.query<{ what: string }>(`SELECT CASE
        WHEN cs.room_id=e.room_id THEN 'The room has a class at this time.'
        WHEN cs.faculty_id=e.invigilator_id THEN 'The invigilator teaches a class at this time.'
        ELSE 'The section has a class at this time.' END AS what
      FROM exam_sitting e JOIN class_session cs ON cs.institution_id=e.institution_id AND cs.state IN ('published','conducted') AND cs.slot && e.slot
        AND (cs.room_id=e.room_id OR cs.faculty_id=e.invigilator_id OR cs.section_id=e.section_id)
      WHERE e.institution_id=$1 AND e.id=$2
      UNION ALL SELECT 'A confirmed booking holds the room at this time.' FROM exam_sitting e JOIN resource_booking b
        ON b.institution_id=e.institution_id AND b.resource_id=e.room_id AND b.state='confirmed' AND b.slot && e.slot WHERE e.institution_id=$1 AND e.id=$2
      LIMIT 1`, [scope.institution, input.exam]);
    if (clash) throw new WorkflowError(clash.what);
    try {
      await client.query("UPDATE exam_sitting SET state='published',published_at=clock_timestamp(),revision=revision+1 WHERE institution_id=$1 AND id=$2",
        [scope.institution, input.exam]);
    } catch (error) {
      const constraint = (error as { code?: string; constraint?: string });
      if (constraint.code !== "23P01") throw error;
      const subject = { exam_section_overlap: "section", exam_room_overlap: "room", exam_invigilator_overlap: "invigilator" }[constraint.constraint ?? ""] ?? "schedule";
      throw new WorkflowError(`The ${subject} already has a published examination at this time.`);
    }
    await audit(client, scope, input.exam, "exam.published", exam.revision + 1);
  });
}

export function cancelExam(scope: Scope, raw: unknown) {
  const input = z.object({ exam: z.uuid(), reason: z.string().trim().min(1).max(500) }).parse(raw);
  return transaction(async client => {
    await requireAdmin(client, scope);
    const { rows: [exam] } = await client.query<{ state: string; revision: number }>(
      "SELECT state,revision FROM exam_sitting WHERE institution_id=$1 AND id=$2 FOR UPDATE", [scope.institution, input.exam]);
    if (!exam || exam.state === "cancelled") throw unavailable();
    await client.query("UPDATE exam_sitting SET state='cancelled',change_reason=$3,revision=revision+1 WHERE institution_id=$1 AND id=$2",
      [scope.institution, input.exam, input.reason]);
    await audit(client, scope, input.exam, "exam.cancelled", exam.revision + 1);
  });
}

export type Sitting = { id: string; kind: "internal" | "external"; title: string; course: string; section: string; start: Date; finish: Date;
  room: string; invigilator: string; invigilator_id: string; source: string | null; state: "draft" | "published" | "cancelled";
  change_reason: string | null; revision: number; enrolled: number; capacity: number | null };

const member = `EXISTS (SELECT 1 FROM membership x WHERE x.institution_id=e.institution_id AND x.account_id=$2 AND x.role=$3 AND x.ended_at IS NULL)`;
const roster = (role: string) => `EXISTS (SELECT 1 FROM roster r WHERE (r.institution_id,r.offering_id)=(e.institution_id,e.offering_id)
  AND r.account_id=$2 AND r.role='${role}' AND r.ended_at IS NULL)`;
const visible = `${member} AND CASE $3
  WHEN 'admin' THEN true
  WHEN 'principal' THEN e.state<>'draft'
  WHEN 'student' THEN e.state<>'draft' AND ${roster("student")}
  WHEN 'faculty' THEN e.state<>'draft' AND (e.invigilator_id=$2 OR ${roster("faculty")})
  WHEN 'hod' THEN e.state<>'draft' AND EXISTS (SELECT 1 FROM membership h WHERE h.institution_id=e.institution_id AND h.account_id=$2
    AND h.role='hod' AND h.department_id=c.department_id AND h.ended_at IS NULL)
  ELSE false END`;

export async function exams(scope: Scope) {
  return (await db.query<Sitting>(`SELECT e.id,e.kind,e.title,c.name AS course,s.name AS section,lower(e.slot) AS start,upper(e.slot) AS finish,
      room.name AS room,u.name AS invigilator,e.invigilator_id,e.source,e.state,e.change_reason,e.revision,room.capacity,
      (SELECT count(*)::int FROM roster r WHERE (r.institution_id,r.offering_id)=(e.institution_id,e.offering_id) AND r.role='student' AND r.ended_at IS NULL) AS enrolled
    FROM exam_sitting e JOIN offering o ON (o.institution_id,o.id)=(e.institution_id,e.offering_id)
    JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id) JOIN section s ON (s.institution_id,s.id)=(e.institution_id,e.section_id)
    JOIN campus_resource room ON (room.institution_id,room.id)=(e.institution_id,e.room_id) JOIN "user" u ON u.id=e.invigilator_id
    WHERE e.institution_id=$1 AND ${visible} AND upper(e.slot) > clock_timestamp()-interval '30 days'
    ORDER BY lower(e.slot),e.id LIMIT 200`, [scope.institution, scope.account, scope.role])).rows;
}

/** LE-008: unresolved operational issues on upcoming published sittings, recomputed from current records. */
export function examIssues(rows: Sitting[], invigilatorsActive: Set<string>) {
  const now = Date.now();
  return rows.filter(e => e.state === "published" && e.start.getTime() > now).flatMap(e => [
    ...(!invigilatorsActive.has(e.invigilator_id) ? [{ exam: e, issue: "Invigilator no longer holds a faculty post" }] : []),
    ...(e.capacity !== null && e.enrolled > e.capacity ? [{ exam: e, issue: `Room seats ${e.capacity}; ${e.enrolled} students enrolled` }] : []),
  ]);
}

export async function examOptions(scope: Scope) {
  if (scope.role !== "admin") return null;
  const [offerings, rooms, faculty] = await Promise.all([
    db.query<{ id: string; label: string }>(`SELECT o.id,c.name||' · '||s.name||' · '||t.name AS label FROM offering o
      JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id) JOIN section s ON (s.institution_id,s.id)=(o.institution_id,o.section_id)
      JOIN academic_term t ON (t.institution_id,t.id)=(o.institution_id,o.term_id) WHERE o.institution_id=$1 ORDER BY label`, [scope.institution]),
    db.query<{ id: string; label: string }>(`SELECT id,name||' · '||location||coalesce(' · '||capacity||' seats','') AS label FROM campus_resource
      WHERE institution_id=$1 AND kind='room' ORDER BY name`, [scope.institution]),
    db.query<{ id: string; name: string }>(`SELECT DISTINCT u.id,u.name FROM membership m JOIN "user" u ON u.id=m.account_id
      WHERE m.institution_id=$1 AND m.role='faculty' AND m.ended_at IS NULL ORDER BY u.name`, [scope.institution])]);
  return { offerings: offerings.rows, rooms: rooms.rows, faculty: faculty.rows };
}

export async function activeFaculty(scope: Scope) {
  return new Set((await db.query<{ account_id: string }>("SELECT account_id FROM membership WHERE institution_id=$1 AND role='faculty' AND ended_at IS NULL",
    [scope.institution])).rows.map(r => r.account_id));
}
