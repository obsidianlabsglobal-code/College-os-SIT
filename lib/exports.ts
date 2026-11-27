import { assessmentHistory } from "./assignments";
import { db } from "./db";
import { departmentComparison, facultyWorkload } from "./department";
import { operationsReport } from "./reporting";
import type { Scope } from "./scope";

type Cell = string | number | boolean | null | Date;
/** RFC 4180 CSV. Cells that a spreadsheet would run as a formula are prefixed with an apostrophe. */
export function csv(rows: Cell[][]) {
  const cell = (value: Cell) => {
    let text = value === null ? "" : value instanceof Date ? value.toISOString() : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return rows.map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** SA-022: the student's own published results and latest attendance marks, each with its source record. */
export async function studentRecord(scope: Scope) {
  if (scope.role !== "student") return null;
  const [assessments, attendance] = await Promise.all([assessmentHistory(scope), db.query<{ id: string; course: string; term: string; scheme: string; start: Date; status: string; revision: number }>(
    `SELECT s.id,c.name AS course,t.name AS term,sc.name AS scheme,lower(s.slot) AS start,m.status,m.revision
     FROM class_session s JOIN offering o ON (o.institution_id,o.id)=(s.institution_id,s.offering_id)
     JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id)
     JOIN academic_term t ON (t.institution_id,t.id)=(o.institution_id,o.term_id)
     JOIN academic_scheme sc ON (sc.institution_id,sc.id)=(t.institution_id,t.scheme_id)
     JOIN roster r ON (r.institution_id,r.offering_id)=(o.institution_id,o.id) AND r.account_id=$2 AND r.role='student' AND r.ended_at IS NULL
     JOIN membership mm ON mm.institution_id=s.institution_id AND mm.account_id=$2 AND mm.role='student' AND mm.ended_at IS NULL
     JOIN class_attendance_mark m ON (m.institution_id,m.session_id)=(s.institution_id,s.id) AND m.student_id=$2
     WHERE s.institution_id=$1 AND s.state='conducted'
       AND m.revision=(SELECT max(revision) FROM class_attendance_revision v WHERE (v.institution_id,v.session_id)=(s.institution_id,s.id))
     ORDER BY lower(s.slot),s.id`, [scope.institution, scope.account])]);
  return csv([["record", "scheme", "term", "course", "item", "date", "result", "source"],
    ...assessments.map(a => ["assessment", a.scheme, a.term, a.course, a.title, a.submitted_at ?? a.deadline,
      a.marks !== null ? `${a.marks}/${a.max_marks}${a.corrected ? " (corrected)" : ""}` : a.submitted_at ? "awaiting result" : "not submitted",
      `assignment:${a.id}`]),
    ...attendance.rows.map(r => ["attendance", r.scheme, r.term, r.course, "class", r.start, r.status, `class_session:${r.id} revision ${r.revision}`])]);
}

/** FC-028: per-offering teaching and evaluation report for the caller's current teaching assignments. */
export async function facultyReport(scope: Scope) {
  if (scope.role !== "faculty") return null;
  const { rows } = await db.query<{ offering: string; course: string; section: string; term: string; students: number; assignments: number;
    submissions: number; published: number; classes: number; present: number; marked: number }>(
    `SELECT o.id AS offering,c.name AS course,s.name AS section,t.name AS term,
       (SELECT count(*)::int FROM roster x WHERE (x.institution_id,x.offering_id)=(o.institution_id,o.id) AND x.role='student' AND x.ended_at IS NULL) AS students,
       (SELECT count(*)::int FROM assignment a WHERE (a.institution_id,a.offering_id)=(o.institution_id,o.id) AND a.published_at IS NOT NULL) AS assignments,
       (SELECT count(*)::int FROM submission sub JOIN assignment a ON (a.institution_id,a.id)=(sub.institution_id,sub.assignment_id)
         WHERE (a.institution_id,a.offering_id)=(o.institution_id,o.id)) AS submissions,
       (SELECT count(DISTINCT g.submission_id)::int FROM grade g JOIN submission sub ON (sub.institution_id,sub.id)=(g.institution_id,g.submission_id)
         JOIN assignment a ON (a.institution_id,a.id)=(sub.institution_id,sub.assignment_id)
         WHERE (a.institution_id,a.offering_id)=(o.institution_id,o.id) AND g.published_at IS NOT NULL) AS published,
       (SELECT count(*)::int FROM class_session cs WHERE (cs.institution_id,cs.offering_id)=(o.institution_id,o.id) AND cs.faculty_id=$2 AND cs.state='conducted') AS classes,
       coalesce(att.present,0) AS present,coalesce(att.marked,0) AS marked
     FROM roster r
     JOIN membership m ON m.institution_id=r.institution_id AND m.account_id=r.account_id AND m.role='faculty' AND m.ended_at IS NULL
     JOIN offering o ON (o.institution_id,o.id)=(r.institution_id,r.offering_id)
     JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id)
     JOIN section s ON (s.institution_id,s.id)=(o.institution_id,o.section_id)
     JOIN academic_term t ON (t.institution_id,t.id)=(o.institution_id,o.term_id)
     LEFT JOIN LATERAL (SELECT count(*) FILTER (WHERE k.status='present')::int AS present,count(*)::int AS marked
       FROM class_session cs JOIN class_attendance_mark k ON (k.institution_id,k.session_id)=(cs.institution_id,cs.id)
       WHERE (cs.institution_id,cs.offering_id)=(o.institution_id,o.id) AND cs.faculty_id=$2 AND cs.state='conducted'
         AND k.revision=(SELECT max(revision) FROM class_attendance_revision v WHERE (v.institution_id,v.session_id)=(cs.institution_id,cs.id))) att ON true
     WHERE r.institution_id=$1 AND r.account_id=$2 AND r.role='faculty' AND r.ended_at IS NULL ORDER BY c.name,s.name,o.id`,
    [scope.institution, scope.account]);
  const load = await facultyWorkload(scope);
  return csv([["course", "section", "term", "active students", "published assignments", "submissions", "submissions with published result",
    "classes with attendance", "present marks", "recorded marks", "source"],
    ...rows.map(r => [r.course, r.section, r.term, r.students, r.assignments, r.submissions, r.published, r.classes, r.present, r.marked, `offering:${r.offering}`]),
    [],
    ["workload", "awaiting evaluation", "unpublished feedback drafts", "classes next 7 days", "classes without attendance (7 days)", "current mentees"],
    ["current", load?.pending ?? 0, load?.awaiting ?? 0, load?.upcoming ?? 0, load?.unrecorded ?? 0, load?.mentees ?? 0]]);
}

/** LE-019: principal's executive summary. Every figure names its definition, time window and source query, and the file
 * records when it was generated, so a claim in a briefing can be traced back to records. */
export async function executiveReport(scope: Scope, window?: { from: string; to: string }) {
  if (scope.role !== "principal") return null;
  const [departments, ops] = await Promise.all([departmentComparison(scope), operationsReport(scope)]);
  if (!ops) return null;
  const now = new Date();
  const range = window && /^\d{4}-\d{2}-\d{2}$/.test(window.from) && /^\d{4}-\d{2}-\d{2}$/.test(window.to) && window.from <= window.to ? window : null;
  const windowed = range ? (await db.query<{ submitted: number; resolved: number; declined: number; attendance: number; results: number }>(`SELECT
      (SELECT count(*)::int FROM service_request r WHERE r.institution_id=i.id AND r.created_at>=f AND r.created_at<t) AS submitted,
      (SELECT count(*)::int FROM service_request r WHERE r.institution_id=i.id AND r.status='resolved' AND r.closed_at>=f AND r.closed_at<t) AS resolved,
      (SELECT count(*)::int FROM service_request r WHERE r.institution_id=i.id AND r.status='declined' AND r.closed_at>=f AND r.closed_at<t) AS declined,
      (SELECT count(*)::int FROM class_attendance_revision v WHERE v.institution_id=i.id AND v.revision>1 AND v.recorded_at>=f AND v.recorded_at<t) AS attendance,
      (SELECT count(*)::int FROM grade g WHERE g.institution_id=i.id AND g.revision>1 AND g.published_at>=f AND g.published_at<t) AS results
    FROM institution i, LATERAL (SELECT $2::date::timestamp AT TIME ZONE i.timezone AS f, ($3::date+1)::timestamp AT TIME ZONE i.timezone AS t) w
    WHERE i.id=$1`, [scope.institution, range.from, range.to])).rows[0] : null;
  const label = range ? `${range.from} to ${range.to}` : "";
  const pct = (part: number, whole: number) => whole ? (100 * part / whole).toFixed(1) : "";
  return csv([["section", "subject", "measure", "value", "window", "definition", "source"],
    ["report", "institution", "generated at", now, "", "Time this file was produced", "NEXUS executive report"],
    ...departments.flatMap(d => [
      ["department", d.name, "active students", d.students, "current", "Distinct students on an active roster", `department:${d.id}`],
      ["department", d.name, "active faculty", d.faculty, "current", "Distinct faculty on an active roster", `department:${d.id}`],
      ["department", d.name, "published assignments", d.assignments, "all time", "Assignments with a publication time", `department:${d.id}`],
      ["department", d.name, "results published %", pct(d.results, d.submissions), "all time", "Submissions with a published result / submissions", `department:${d.id}`],
      ["department", d.name, "attendance %", pct(d.present, d.marked), "all time", "Present marks in each class's latest attendance revision / marks", `department:${d.id}`],
    ]),
    ["operations", "service requests", "open", ops.open, "current", "Submitted or in review", "service_request"],
    ["operations", "service requests", "unassigned open", ops.unassigned, "current", "Open with no accountable owner", "service_request"],
    ["operations", "service requests", "oldest open hours", ops.oldest_open_hours, "current", "Age of the oldest open request", "service_request"],
    ["operations", "service requests", "resolved", ops.resolved_30d, "last 30 days", "Closed as resolved", "service_request"],
    ["operations", "service requests", "declined", ops.declined_30d, "last 30 days", "Closed as declined", "service_request"],
    ["operations", "service requests", "median resolution hours", ops.median_resolution_hours, "last 30 days", "Submission to recorded outcome", "service_request"],
    ["operations", "corrections", "attendance corrections", ops.attendance_corrections_30d, "last 30 days", "New attendance revisions after the first", "class_attendance_revision"],
    ["operations", "corrections", "result corrections", ops.grade_corrections_30d, "last 30 days", "Published grade revisions after the first", "grade"],
    ...(windowed ? [
      ["window", "service requests", "received", windowed.submitted, label, "Requests submitted in the window (institution local dates)", "service_request"],
      ["window", "service requests", "resolved", windowed.resolved, label, "Closed as resolved in the window", "service_request"],
      ["window", "service requests", "declined", windowed.declined, label, "Closed as declined in the window", "service_request"],
      ["window", "corrections", "attendance corrections", windowed.attendance, label, "Attendance revisions after the first, recorded in the window", "class_attendance_revision"],
      ["window", "corrections", "result corrections", windowed.results, label, "Published grade revisions after the first, in the window", "grade"],
    ] : [])]);
}
