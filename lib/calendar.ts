import { z } from "zod";
import { db } from "./db";
import type { Scope } from "./scope";

// SA-010: one month of dated records the caller can already see — assignment deadlines, classes and published
// examinations in their current rosters (and invigilation duties), and campus events they registered for. Nothing here is a separate calendar store; dates come from the records.
export type CalendarItem = { kind: "deadline" | "class" | "event" | "exam"; id: string; title: string; course: string | null;
  offering_id: string | null; at: Date; finish: Date | null; state: string };

const filter = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  offering: z.uuid().optional(),
  kind: z.enum(["deadline", "class", "event", "exam"]).optional(),
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
      SELECT 'event',e.id,e.title||' · '||e.location,NULL,NULL,e.starts_at,e.ends_at,e.state
      FROM club_registration g CROSS JOIN i JOIN club_event e ON (e.institution_id,e.id)=(g.institution_id,g.event_id)
      WHERE g.institution_id=$1 AND g.account_id=$2 AND e.state NOT IN ('draft','pending_approval') AND ${span} && tstzrange(e.starts_at,e.ends_at)
    ) item
    WHERE ($5::uuid IS NULL OR item.offering_id=$5) AND ($6::text IS NULL OR item.kind=$6)
    ORDER BY item.at,item.kind,item.id LIMIT 500`,
  [scope.institution, scope.account, scope.role, input.month, input.offering ?? null, input.kind ?? null])).rows;
}
