import { db } from "./db";
import type { Scope } from "./scope";

// Department and leadership read models. Every query re-checks the caller's active post in SQL, so a revoked HOD,
// principal or faculty membership returns nothing even with a stale session. Counts come from records only.

export type Workload = { account: string; name: string; offerings: string[]; assignments: number; pending: number;
  awaiting: number; upcoming: number; unrecorded: number; mentees: number };

// Teaching and evaluation commitments per faculty member. `upcoming` = published classes in the next 7 days;
// `unrecorded` = published classes that ended in the last 7 days without an attendance record.
const workload = `SELECT u.id AS account,u.name,
    array_agg(DISTINCT c.name || ' · ' || s.name ORDER BY c.name || ' · ' || s.name) AS offerings,
    count(DISTINCT a.id)::int AS assignments,
    count(DISTINCT sub.id) FILTER (WHERE NOT EXISTS (SELECT 1 FROM grade g WHERE (g.institution_id,g.submission_id)=(sub.institution_id,sub.id)))::int AS pending,
    count(DISTINCT sub.id) FILTER (WHERE EXISTS (SELECT 1 FROM grade g WHERE (g.institution_id,g.submission_id)=(sub.institution_id,sub.id)
      AND g.published_at IS NULL AND g.superseded_at IS NULL))::int AS awaiting,
    (SELECT count(*)::int FROM class_session cs WHERE cs.institution_id=$1 AND cs.faculty_id=u.id AND cs.state='published'
      AND lower(cs.slot) BETWEEN now() AND now()+interval '7 days') AS upcoming,
    (SELECT count(*)::int FROM class_session cs WHERE cs.institution_id=$1 AND cs.faculty_id=u.id AND cs.state='published'
      AND upper(cs.slot) BETWEEN now()-interval '7 days' AND now()
      AND NOT EXISTS (SELECT 1 FROM class_attendance_revision v WHERE (v.institution_id,v.session_id)=(cs.institution_id,cs.id))) AS unrecorded,
    (SELECT count(*)::int FROM mentor_assignment ma JOIN membership sm ON sm.institution_id=ma.institution_id AND sm.account_id=ma.student_id
      AND sm.role='student' AND sm.ended_at IS NULL WHERE ma.institution_id=$1 AND ma.mentor_id=u.id AND ma.ended_at IS NULL) AS mentees
  FROM roster r
  JOIN membership fm ON fm.institution_id=r.institution_id AND fm.account_id=r.account_id AND fm.role='faculty' AND fm.ended_at IS NULL
  JOIN "user" u ON u.id=r.account_id
  JOIN offering o ON (o.institution_id,o.id)=(r.institution_id,r.offering_id)
  JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id)
  JOIN section s ON (s.institution_id,s.id)=(o.institution_id,o.section_id)
  LEFT JOIN assignment a ON (a.institution_id,a.offering_id)=(o.institution_id,o.id) AND a.published_at IS NOT NULL
  LEFT JOIN submission sub ON (sub.institution_id,sub.assignment_id)=(a.institution_id,a.id)
  WHERE r.institution_id=$1 AND r.role='faculty' AND r.ended_at IS NULL`;

const hodDepartments = `SELECT department_id FROM membership WHERE institution_id=$1 AND account_id=$2 AND role='hod' AND ended_at IS NULL`;

/** DH-002 / DH-006: current faculty in the HOD's departments with their teaching and evaluation allocations. */
export async function departmentFaculty(scope: Scope) {
  if (scope.role !== "hod") return [];
  return (await db.query<Workload>(`${workload} AND c.department_id IN (${hodDepartments})
    GROUP BY u.id,u.name ORDER BY u.name`, [scope.institution, scope.account])).rows;
}

/** FC-019: the caller's own commitments, from the same definition the HOD sees. */
export async function facultyWorkload(scope: Scope) {
  if (scope.role !== "faculty") return null;
  return (await db.query<Workload>(`${workload} AND r.account_id=$2 GROUP BY u.id,u.name`, [scope.institution, scope.account])).rows[0] ?? null;
}

export type SectionRoster = { offering: string; course: string; section: string; term: string; faculty: string[]; students: string[];
  classes: number; present: number; marked: number; target: number | null; target_source: string | null };

// Attendance uses each class's latest revision only, so corrections replace rather than add to the record.
const sections = `SELECT o.id AS offering,c.name AS course,s.name AS section,t.name AS term,
    coalesce(array_agg(DISTINCT u.name ORDER BY u.name) FILTER (WHERE r.role='faculty'),'{}') AS faculty,
    coalesce(array_agg(DISTINCT u.name ORDER BY u.name) FILTER (WHERE r.role='student'),'{}') AS students,
    att.classes,att.present,att.marked,pt.percent AS target,pt.source AS target_source
  FROM offering o
  JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id)
  JOIN section s ON (s.institution_id,s.id)=(o.institution_id,o.section_id)
  JOIN academic_term t ON (t.institution_id,t.id)=(o.institution_id,o.term_id)
  LEFT JOIN roster r ON (r.institution_id,r.offering_id)=(o.institution_id,o.id) AND r.ended_at IS NULL
  LEFT JOIN "user" u ON u.id=r.account_id
  LEFT JOIN LATERAL (SELECT count(DISTINCT cs.id)::int AS classes,
      count(m.*) FILTER (WHERE m.status='present')::int AS present, count(m.*)::int AS marked
    FROM class_session cs
    JOIN LATERAL (SELECT max(revision) AS revision FROM class_attendance_revision v WHERE (v.institution_id,v.session_id)=(cs.institution_id,cs.id)) lv ON lv.revision IS NOT NULL
    JOIN class_attendance_mark m ON (m.institution_id,m.session_id,m.revision)=(cs.institution_id,cs.id,lv.revision)
    WHERE (cs.institution_id,cs.offering_id)=(o.institution_id,o.id) AND cs.state IN ('published','conducted')) att ON true
  LEFT JOIN LATERAL (SELECT percent,source FROM attendance_planning_target p WHERE (p.institution_id,p.offering_id)=(o.institution_id,o.id)
    ORDER BY revision DESC LIMIT 1) pt ON true
  WHERE o.institution_id=$1`;

/** DH-003 / DH-009: rosters by section with verified attendance (latest revision) beside the recorded planning target. */
export async function departmentSections(scope: Scope) {
  if (scope.role !== "hod") return [];
  return (await db.query<SectionRoster>(`${sections} AND c.department_id IN (${hodDepartments})
    GROUP BY o.id,c.name,s.name,t.name,att.classes,att.present,att.marked,pt.percent,pt.source ORDER BY c.name,s.name`,
  [scope.institution, scope.account])).rows;
}

export type DepartmentProfile = { id: string; name: string; offerings: number; faculty: number; students: number; assignments: number;
  submissions: number; results: number; present: number; marked: number };

/** LE-002: department profiles with one shared definition per measure, for comparison by leadership. */
export async function departmentComparison(scope: Scope) {
  if (scope.role !== "principal") return [];
  return (await db.query<DepartmentProfile>(`SELECT d.id,d.name,
      (SELECT count(*)::int FROM offering o JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id) WHERE c.institution_id=d.institution_id AND c.department_id=d.id) AS offerings,
      (SELECT count(DISTINCT r.account_id)::int FROM roster r JOIN offering o ON (o.institution_id,o.id)=(r.institution_id,r.offering_id)
        JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id) WHERE c.institution_id=d.institution_id AND c.department_id=d.id AND r.role='faculty' AND r.ended_at IS NULL) AS faculty,
      (SELECT count(DISTINCT r.account_id)::int FROM roster r JOIN offering o ON (o.institution_id,o.id)=(r.institution_id,r.offering_id)
        JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id) WHERE c.institution_id=d.institution_id AND c.department_id=d.id AND r.role='student' AND r.ended_at IS NULL) AS students,
      (SELECT count(*)::int FROM assignment a JOIN offering o ON (o.institution_id,o.id)=(a.institution_id,a.offering_id)
        JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id) WHERE c.institution_id=d.institution_id AND c.department_id=d.id AND a.published_at IS NOT NULL) AS assignments,
      (SELECT count(*)::int FROM submission sub JOIN assignment a ON (a.institution_id,a.id)=(sub.institution_id,sub.assignment_id) JOIN offering o ON (o.institution_id,o.id)=(a.institution_id,a.offering_id)
        JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id) WHERE c.institution_id=d.institution_id AND c.department_id=d.id) AS submissions,
      (SELECT count(DISTINCT g.submission_id)::int FROM grade g JOIN submission sub ON (sub.institution_id,sub.id)=(g.institution_id,g.submission_id)
        JOIN assignment a ON (a.institution_id,a.id)=(sub.institution_id,sub.assignment_id) JOIN offering o ON (o.institution_id,o.id)=(a.institution_id,a.offering_id)
        JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id) WHERE c.institution_id=d.institution_id AND c.department_id=d.id AND g.published_at IS NOT NULL) AS results,
      coalesce(att.present,0) AS present, coalesce(att.marked,0) AS marked
    FROM department d
    JOIN membership pm ON pm.institution_id=d.institution_id AND pm.account_id=$2 AND pm.role='principal' AND pm.ended_at IS NULL
    LEFT JOIN LATERAL (SELECT count(*) FILTER (WHERE m.status='present')::int AS present,count(*)::int AS marked
      FROM class_session cs JOIN offering o ON (o.institution_id,o.id)=(cs.institution_id,cs.offering_id)
      JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id)
      JOIN LATERAL (SELECT max(revision) AS revision FROM class_attendance_revision v WHERE (v.institution_id,v.session_id)=(cs.institution_id,cs.id)) lv ON lv.revision IS NOT NULL
      JOIN class_attendance_mark m ON (m.institution_id,m.session_id,m.revision)=(cs.institution_id,cs.id,lv.revision)
      WHERE c.institution_id=d.institution_id AND c.department_id=d.id AND cs.state IN ('published','conducted')) att ON true
    WHERE d.institution_id=$1 ORDER BY d.name`, [scope.institution, scope.account])).rows;
}

export type EscalatedRequest = { id: string; student: string; description: string; status: string; outcome: string | null;
  handler: string | null; created_at: Date; escalated_at: Date };

/** LE-009: requests escalated to this principal by the SLA rule, with the current decision recorded by the office. */
export async function escalatedRequests(scope: Scope) {
  if (scope.role !== "principal") return [];
  return (await db.query<EscalatedRequest>(`SELECT r.id,su.name AS student,r.description,r.status,r.outcome,h.name AS handler,r.created_at,
      min(n.created_at) AS escalated_at
    FROM notification n
    JOIN service_request r ON r.institution_id=n.institution_id AND r.id=n.entity_id
    JOIN "user" su ON su.id=r.student_id LEFT JOIN "user" h ON h.id=r.handled_by
    JOIN membership pm ON pm.institution_id=n.institution_id AND pm.account_id=$2 AND pm.role='principal' AND pm.ended_at IS NULL
    WHERE n.institution_id=$1 AND n.recipient_id=$2 AND n.kind='escalation'
    GROUP BY r.institution_id,r.id,su.name,h.name ORDER BY (r.status IN ('submitted','in_progress')) DESC,min(n.created_at) DESC LIMIT 50`,
  [scope.institution, scope.account])).rows;
}

export type Cohort = { term: string; section: string; students: number; submissions: number; results: number; score: number | null;
  present: number; marked: number };

/** LE-003: academic indicators per term and section, using the same definitions as the department comparison.
 * `score` is the mean percentage of each submission's latest published result. */
export async function cohortProgress(scope: Scope) {
  if (scope.role !== "principal") return [];
  return (await db.query<Cohort>(`WITH latest AS (
      SELECT DISTINCT ON (g.submission_id) o.term_id,o.section_id,g.marks,a.max_marks FROM grade g
      JOIN submission sub ON (sub.institution_id,sub.id)=(g.institution_id,g.submission_id)
      JOIN assignment a ON (a.institution_id,a.id)=(sub.institution_id,sub.assignment_id)
      JOIN offering o ON (o.institution_id,o.id)=(a.institution_id,a.offering_id)
      WHERE g.institution_id=$1 AND g.published_at IS NOT NULL ORDER BY g.submission_id,g.revision DESC),
    marks AS (SELECT o.term_id,o.section_id,m.status FROM class_session cs
      JOIN offering o ON (o.institution_id,o.id)=(cs.institution_id,cs.offering_id)
      JOIN class_attendance_mark m ON (m.institution_id,m.session_id)=(cs.institution_id,cs.id)
      WHERE cs.institution_id=$1 AND cs.state IN ('published','conducted')
        AND m.revision=(SELECT max(revision) FROM class_attendance_revision v WHERE (v.institution_id,v.session_id)=(cs.institution_id,cs.id)))
    SELECT t.name AS term,s.name AS section,count(DISTINCT r.account_id)::int AS students,
      (SELECT count(*)::int FROM submission sub JOIN assignment a ON (a.institution_id,a.id)=(sub.institution_id,sub.assignment_id)
        JOIN offering o2 ON (o2.institution_id,o2.id)=(a.institution_id,a.offering_id) WHERE o2.institution_id=$1 AND o2.term_id=t.id AND o2.section_id=s.id) AS submissions,
      (SELECT count(*)::int FROM latest l WHERE l.term_id=t.id AND l.section_id=s.id) AS results,
      (SELECT round(avg(100.0*l.marks/l.max_marks)::numeric,1)::float8 FROM latest l WHERE l.term_id=t.id AND l.section_id=s.id) AS score,
      (SELECT count(*) FILTER (WHERE m.status='present')::int FROM marks m WHERE m.term_id=t.id AND m.section_id=s.id) AS present,
      (SELECT count(*)::int FROM marks m WHERE m.term_id=t.id AND m.section_id=s.id) AS marked
    FROM offering o
    JOIN membership pm ON pm.institution_id=o.institution_id AND pm.account_id=$2 AND pm.role='principal' AND pm.ended_at IS NULL
    JOIN academic_term t ON (t.institution_id,t.id)=(o.institution_id,o.term_id)
    JOIN section s ON (s.institution_id,s.id)=(o.institution_id,o.section_id)
    LEFT JOIN roster r ON (r.institution_id,r.offering_id)=(o.institution_id,o.id) AND r.role='student' AND r.ended_at IS NULL
    WHERE o.institution_id=$1
    GROUP BY t.id,t.name,s.id,s.name ORDER BY t.name,s.name`, [scope.institution, scope.account])).rows;
}
