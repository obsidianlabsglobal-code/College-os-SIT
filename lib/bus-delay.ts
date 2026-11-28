import { db } from "./db";
import type { Scope } from "./scope";

// Integration-owned attendance adapter for bus delays (contract: docs/TRANSPORT_DISRUPTIONS_5B.md).
// For the teacher of a class, a student gets a "bus delayed" note when all hold:
//   - the student's boarding is recorded on an inbound trip that ran on the class's local date (boarding, not route membership);
//   - a disruption was raised on that trip before the class ended;
//   - this class is the student's first published or conducted class that day.
// The note is computed on read and changes no mark: the teacher's decision stands and the original record is untouched.
// Only the time it was reported is shown, never the incident kind, location, injuries or other riders.
export type BusDelayNote = { student_id: string; reported_at: Date };

export async function busDelayNotes(scope: Scope, session: string): Promise<BusDelayNote[]> {
  if (scope.role !== "faculty") return [];
  return (await db.query<BusDelayNote>(`SELECT r.account_id AS student_id,min(d.created_at) AS reported_at
    FROM class_session s
    JOIN institution i ON i.id=s.institution_id
    JOIN membership me ON me.institution_id=s.institution_id AND me.account_id=$2 AND me.role='faculty' AND me.ended_at IS NULL
    JOIN roster r ON (r.institution_id,r.offering_id)=(s.institution_id,s.offering_id) AND r.role='student' AND r.ended_at IS NULL
    JOIN transport_trip t ON t.institution_id=s.institution_id AND t.service_on=(lower(s.slot) AT TIME ZONE i.timezone)::date AND t.state<>'cancelled'
    JOIN transport_route tr ON (tr.institution_id,tr.id)=(t.institution_id,t.route_id) AND tr.direction='inbound'
    JOIN transport_boarding b ON (b.institution_id,b.trip_id,b.student_id)=(t.institution_id,t.id,r.account_id)
    JOIN transport_disruption d ON (d.institution_id,d.trip_id)=(t.institution_id,t.id) AND d.created_at < upper(s.slot)
    WHERE s.institution_id=$1 AND s.id=$3 AND s.faculty_id=$2 AND s.state IN ('published','conducted')
      AND NOT EXISTS (SELECT 1 FROM class_session e JOIN roster er ON (er.institution_id,er.offering_id)=(e.institution_id,e.offering_id)
        AND er.account_id=r.account_id AND er.role='student' AND er.ended_at IS NULL
        WHERE e.institution_id=s.institution_id AND e.state IN ('published','conducted') AND lower(e.slot) < lower(s.slot)
          AND (lower(e.slot) AT TIME ZONE i.timezone)::date=(lower(s.slot) AT TIME ZONE i.timezone)::date)
    GROUP BY r.account_id`, [scope.institution, scope.account, session])).rows;
}
