import { db } from "./db";
import type { Scope } from "./scope";

export async function departmentSummary(scope: Scope) {
  if (scope.role !== "hod") return [];
  return (await db.query<{ name: string; assignments: number; submissions: number; results: number; hours: number | null }>(
    `SELECT d.name, count(DISTINCT a.id)::int AS assignments, count(s.id)::int AS submissions,
       count(p.at)::int AS results, avg(extract(epoch FROM (p.at-s.submitted_at))/3600)::float8 AS hours
     FROM membership m JOIN department d ON (d.institution_id,d.id)=(m.institution_id,m.department_id)
     LEFT JOIN course c ON c.institution_id=d.institution_id AND c.department_id=d.id
     LEFT JOIN offering o ON o.institution_id=c.institution_id AND o.course_id=c.id
     LEFT JOIN assignment a ON a.institution_id=o.institution_id AND a.offering_id=o.id AND a.published_at IS NOT NULL
     LEFT JOIN submission s ON s.institution_id=a.institution_id AND s.assignment_id=a.id
     LEFT JOIN LATERAL (SELECT min(published_at) AS at FROM grade g
       WHERE (g.institution_id,g.submission_id)=(s.institution_id,s.id)) p ON true
     WHERE m.institution_id=$1 AND m.account_id=$2 AND m.role='hod' AND m.ended_at IS NULL
     GROUP BY d.id,d.name ORDER BY d.name`, [scope.institution, scope.account],
  )).rows;
}

export async function institutionSummary(scope: Scope) {
  if (scope.role !== "principal") return [];
  return (await db.query<{ name: string; assignments: number; submissions: number; results: number; open_requests: number }>(
    `SELECT i.name,
      (SELECT count(*)::int FROM assignment a WHERE a.institution_id=i.id AND a.published_at IS NOT NULL) AS assignments,
      (SELECT count(*)::int FROM submission s WHERE s.institution_id=i.id) AS submissions,
      (SELECT count(DISTINCT submission_id)::int FROM grade g WHERE g.institution_id=i.id AND g.published_at IS NOT NULL) AS results,
      (SELECT count(*)::int FROM service_request s WHERE s.institution_id=i.id AND s.status IN ('submitted','in_progress')) AS open_requests
     FROM institution i JOIN membership m ON m.institution_id=i.id
     WHERE i.id=$1 AND m.account_id=$2 AND m.role='principal' AND m.ended_at IS NULL`, [scope.institution, scope.account],
  )).rows;
}

export async function adminRequestSummary(scope: Scope) {
  if (scope.role !== "admin") return null;
  const result = await db.query<{ submitted:number; in_review:number }>(
    `SELECT count(r.id) FILTER (WHERE r.status='submitted')::int AS submitted,
            count(r.id) FILTER (WHERE r.status='in_progress')::int AS in_review
       FROM membership m LEFT JOIN service_request r ON r.institution_id=m.institution_id
      WHERE m.institution_id=$1 AND m.account_id=$2 AND m.role='admin' AND m.ended_at IS NULL
      GROUP BY m.id`, [scope.institution,scope.account]);
  return result.rows[0] ?? null;
}
