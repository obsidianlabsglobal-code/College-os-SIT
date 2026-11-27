import { z } from "zod";
import { db, transaction } from "./db";
import { audit, WorkflowError } from "./assignments";
import type { Scope } from "./scope";

// SA-010: institution dates published by the office, and one month of dated records the caller can already see — assignment deadlines, classes and published
// examinations in their current rosters (and invigilation duties), and campus events they registered for. Nothing here is a separate calendar store; dates come from the records.
export type CalendarItem = { kind: "deadline" | "class" | "event" | "exam" | "institution"; id: string; title: string; course: string | null;
  offering_id: string | null; at: Date; finish: Date | null; state: string };

const filter = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  offering: z.uuid().optional(),
  kind: z.enum(["deadline", "class", "event", "exam", "institution"]).optional(),
});
export type CalendarFilter = z.infer<typeof filter>;
export const parseCalendarFilter = (raw: Record<string, string | undefined>, fallbackMonth: string) =>
  filter.safeParse({ month: raw.month || fallbackMonth, offering: raw.offering || undefined, kind: raw.kind || undefined }).data ?? null;

const span = `tstzrange(($4||'-01')::date::timestamp AT TIME ZONE i.timezone,
  (($4||'-01')::date + interval '1 month')::timestamp AT TIME ZONE i.timezone,'[)')`;
const roster = `JOIN roster r ON (r.institution_id,r.offering_id)=(o.institution_id,o.id) AND r.account_id=$2 AND r.role=$3 AND r.ended_at IS NULL`;

export async function calendar(scope: Scope, input: CalendarFilter) {
  if (scope.role !== "student" && scope.role !== "faculty") return [];
  return (await db.query<CalendarItem>(`WITH i AS (SELECT i.timezone FROM institution i
      JOIN membership m ON m.institution_id=i.id AND m.account_id=$2 AND m.role=$3 AND m.ended_at IS NULL WHERE i.id=$1)
    SELECT * FROM (
      SELECT 'deadline' AS kind,a.id,a.title,c.name AS course,o.id AS offering_id,a.deadline AS at,NULL::timestamptz AS finish,'published' AS state
      FROM assignment a CROSS JOIN i JOIN offering o ON (o.institution_id,o.id)=(a.institution_id,a.offering_id)
      JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id) ${roster}
      WHERE a.institution_id=$1 AND a.published_at IS NOT NULL AND ${span} @> a.deadline
      UNION ALL
      SELECT 'class',s.id,c.name||' · '||sec.name,c.name,o.id,lower(s.slot),upper(s.slot),s.state
      FROM class_session s CROSS JOIN i JOIN offering o ON (o.institution_id,o.id)=(s.institution_id,s.offering_id)
      JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id)
      JOIN section sec ON (sec.institution_id,sec.id)=(s.institution_id,s.section_id) ${roster}
      WHERE s.institution_id=$1 AND s.state<>'draft' AND ($3='student' OR s.faculty_id=$2) AND ${span} && s.slot
      UNION ALL
      SELECT 'exam',e.id,e.title||' · '||room.name,c.name,o.id,lower(e.slot),upper(e.slot),e.state
      FROM exam_sitting e CROSS JOIN i JOIN offering o ON (o.institution_id,o.id)=(e.institution_id,e.offering_id)
      JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id)
      JOIN campus_resource room ON (room.institution_id,room.id)=(e.institution_id,e.room_id)
      WHERE e.institution_id=$1 AND e.state<>'draft' AND ${span} && e.slot
        AND (EXISTS (SELECT 1 FROM roster r WHERE (r.institution_id,r.offering_id)=(o.institution_id,o.id) AND r.account_id=$2 AND r.role=$3 AND r.ended_at IS NULL)
          OR ($3='faculty' AND e.invigilator_id=$2))
      UNION ALL
      SELECT 'institution',e.id,e.title,NULL,NULL,e.starts_on::timestamp AT TIME ZONE i.timezone,(e.ends_on+1)::timestamp AT TIME ZONE i.timezone,e.kind
      FROM calendar_entry e CROSS JOIN i WHERE e.institution_id=$1 AND e.withdrawn_at IS NULL
        AND ${span} && tstzrange(e.starts_on::timestamp AT TIME ZONE i.timezone,(e.ends_on+1)::timestamp AT TIME ZONE i.timezone)
      UNION ALL
      SELECT 'event',e.id,e.title||' · '||e.location,NULL,NULL,e.starts_at,e.ends_at,e.state
      FROM club_registration g CROSS JOIN i JOIN club_event e ON (e.institution_id,e.id)=(g.institution_id,g.event_id)
      WHERE g.institution_id=$1 AND g.account_id=$2 AND e.state NOT IN ('draft','pending_approval') AND ${span} && tstzrange(e.starts_at,e.ends_at)
    ) item
    WHERE ($5::uuid IS NULL OR item.offering_id=$5) AND ($6::text IS NULL OR item.kind=$6)
    ORDER BY item.at,item.kind,item.id LIMIT 500`,
  [scope.institution, scope.account, scope.role, input.month, input.offering ?? null, input.kind ?? null])).rows;
}

/** Office: publish or withdraw institution-wide dates. */
export async function calendarEntries(scope: Scope) {
  if (scope.role !== "admin") return [];
  return (await db.query<{ id: string; title: string; kind: string; starts_on: string; ends_on: string }>(`SELECT e.id,e.title,e.kind,
      to_char(e.starts_on,'YYYY-MM-DD') AS starts_on,to_char(e.ends_on,'YYYY-MM-DD') AS ends_on FROM calendar_entry e
    WHERE e.institution_id=$1 AND e.withdrawn_at IS NULL AND EXISTS (SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role='admin' AND ended_at IS NULL)
    ORDER BY e.starts_on`, [scope.institution, scope.account])).rows;
}
const entryInput = z.object({ title: z.string().trim().min(1).max(160), kind: z.enum(["term", "holiday", "event", "deadline"]), from: z.iso.date(), to: z.iso.date() })
  .refine(v => v.to >= v.from, { message: "The end date must not be before the start date." });
export function addCalendarEntry(scope: Scope, raw: unknown) {
  const input = entryInput.parse(raw);
  if (scope.role !== "admin") throw new WorkflowError("This action is unavailable.");
  return transaction(async client => {
    const { rows: [row] } = await client.query<{ id: string }>(`INSERT INTO calendar_entry (institution_id,title,kind,starts_on,ends_on,created_by)
      SELECT $1,$2,$3,$4,$5,$6 WHERE EXISTS (SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$6 AND role='admin' AND ended_at IS NULL) RETURNING id`,
    [scope.institution, input.title, input.kind, input.from, input.to, scope.account]);
    if (!row) throw new WorkflowError("This action is unavailable.");
    await audit(client, scope, row.id, "calendar.published");
    return row.id;
  });
}
export function withdrawCalendarEntry(scope: Scope, id: unknown) {
  const entry = z.uuid().parse(id);
  if (scope.role !== "admin") throw new WorkflowError("This action is unavailable.");
  return transaction(async client => {
    const { rowCount } = await client.query(`UPDATE calendar_entry SET withdrawn_at=clock_timestamp() WHERE institution_id=$1 AND id=$2 AND withdrawn_at IS NULL
      AND EXISTS (SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$3 AND role='admin' AND ended_at IS NULL)`, [scope.institution, entry, scope.account]);
    if (!rowCount) throw new WorkflowError("This date is unavailable.");
    await audit(client, scope, entry, "calendar.withdrawn");
  });
}
