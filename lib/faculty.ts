import { z } from "zod";
import { db } from "./db";
import type { Scope } from "./scope";

// Read models for faculty mission control and the evaluation queue.
// Every query starts from the caller's active faculty membership and active faculty roster,
// never from scope.role alone. Evaluation states are derived from the existing grade table:
// the grading engine in lib/assignments.ts remains the only writer.

export type EvaluationState = "pending" | "draft" | "correction" | "published";

export const evaluationLabels: Record<EvaluationState, string> = {
  pending: "Awaiting evaluation",
  draft: "Draft awaiting publication",
  correction: "Correction awaiting publication",
  published: "Published",
};

const taught = `taught AS (
  SELECT DISTINCT r.institution_id,r.offering_id FROM roster r
  JOIN membership m ON m.institution_id=r.institution_id AND m.account_id=r.account_id
    AND m.role='faculty' AND m.ended_at IS NULL
  WHERE r.institution_id=$1 AND r.account_id=$2 AND r.role='faculty' AND r.ended_at IS NULL)`;

const work = `work AS (
  SELECT s.institution_id,s.id,s.assignment_id,s.student_id,s.submitted_at,
    d.marks AS draft_marks,p.marks AS published_marks,p.published_at,
    CASE WHEN d.revision IS NOT NULL AND p.revision IS NOT NULL THEN 'correction'
      WHEN d.revision IS NOT NULL THEN 'draft'
      WHEN p.revision IS NOT NULL THEN 'published' ELSE 'pending' END AS state
  FROM taught t
  JOIN assignment a ON a.institution_id=t.institution_id AND a.offering_id=t.offering_id
  JOIN submission s ON s.institution_id=a.institution_id AND s.assignment_id=a.id
  LEFT JOIN grade d ON d.institution_id=s.institution_id AND d.submission_id=s.id
    AND d.published_at IS NULL AND d.superseded_at IS NULL
  LEFT JOIN LATERAL (SELECT g.revision,g.marks,g.published_at FROM grade g
    WHERE g.institution_id=s.institution_id AND g.submission_id=s.id AND g.published_at IS NOT NULL
    ORDER BY g.revision DESC LIMIT 1) p ON true)`;

export type AssignmentProgress = {
  id: string; title: string; offering_id: string; course: string; section: string; term: string;
  deadline: Date; published_at: Date | null; accepting: boolean; max_marks: number; timezone: string;
  enrolled: number; submitted: number; submitted_enrolled: number; withdrawn: number;
  pending: number; awaiting: number; published: number; oldest_pending: Date | null;
};

/**
 * `active`: unpublished, open for submissions, or with evaluation outstanding (outstanding work first).
 * `unpublished`: never published. `open`: published and accepting submissions (earliest deadline first).
 */
export type ProgressView = "all" | "active" | "unpublished" | "open";
type ProgressFilter = { assignment?: string; offering?: string; view?: ProgressView; limit?: number };

const enrolled = `enrolled AS (
  SELECT r.institution_id,r.offering_id,r.account_id FROM roster r
  JOIN taught t ON t.institution_id=r.institution_id AND t.offering_id=r.offering_id
  JOIN membership m ON m.institution_id=r.institution_id AND m.account_id=r.account_id
    AND m.role='student' AND m.ended_at IS NULL
  WHERE r.role='student' AND r.ended_at IS NULL)`;

/**
 * Per-assignment evaluation progress for offerings the caller currently teaches.
 * `submitted_enrolled` counts only currently enrolled students so it can be compared with `enrolled`;
 * `withdrawn` counts submissions from students no longer enrolled. `truncated` reports a row limit.
 */
export async function assignmentProgress(scope: Scope, filter: ProgressFilter = {}) {
  if (scope.role !== "faculty") return { rows: [] as AssignmentProgress[], total: 0, truncated: false };
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 200);
  const { rows } = await db.query<AssignmentProgress & { total_rows: number }>(
    `WITH ${taught}, ${work}, ${enrolled},
     progress AS (
       SELECT a.id,a.title,a.offering_id,c.name AS course,sec.name AS section,te.name AS term,a.deadline,a.published_at,
         a.deadline >= clock_timestamp() AS accepting,a.max_marks,i.timezone,
         (SELECT count(*)::int FROM enrolled e WHERE e.institution_id=a.institution_id AND e.offering_id=a.offering_id) AS enrolled,
         count(w.id)::int AS submitted,
         count(w.id) FILTER (WHERE e.account_id IS NOT NULL)::int AS submitted_enrolled,
         count(w.id) FILTER (WHERE e.account_id IS NULL)::int AS withdrawn,
         count(w.id) FILTER (WHERE w.state='pending')::int AS pending,
         count(w.id) FILTER (WHERE w.state IN ('draft','correction'))::int AS awaiting,
         count(w.id) FILTER (WHERE w.state IN ('published','correction'))::int AS published,
         min(w.submitted_at) FILTER (WHERE w.state='pending') AS oldest_pending
       FROM taught t
       JOIN assignment a ON a.institution_id=t.institution_id AND a.offering_id=t.offering_id
       JOIN offering o ON o.institution_id=a.institution_id AND o.id=a.offering_id
       JOIN course c ON c.institution_id=o.institution_id AND c.id=o.course_id
       JOIN section sec ON sec.institution_id=o.institution_id AND sec.id=o.section_id
       JOIN academic_term te ON te.institution_id=o.institution_id AND te.id=o.term_id
       JOIN institution i ON i.id=a.institution_id
       LEFT JOIN work w ON w.institution_id=a.institution_id AND w.assignment_id=a.id
       LEFT JOIN enrolled e ON e.institution_id=a.institution_id AND e.offering_id=a.offering_id AND e.account_id=w.student_id
       WHERE ($3::uuid IS NULL OR a.id=$3) AND ($4::uuid IS NULL OR a.offering_id=$4)
       GROUP BY a.institution_id,a.id,c.name,sec.name,te.name,i.timezone)
     SELECT *,count(*) OVER ()::int AS total_rows FROM progress
     WHERE CASE $5::text
       WHEN 'active' THEN published_at IS NULL OR accepting OR pending > 0 OR awaiting > 0
       WHEN 'unpublished' THEN published_at IS NULL
       WHEN 'open' THEN published_at IS NOT NULL AND accepting
       ELSE true END
     ORDER BY CASE WHEN $5='open' THEN false ELSE (pending + awaiting) = 0 END,
       CASE WHEN $5='open' THEN false ELSE published_at IS NOT NULL END,deadline,id
     LIMIT $6`,
    [scope.institution, scope.account, filter.assignment ?? null, filter.offering ?? null, filter.view ?? "all", limit],
  );
  const total = rows[0]?.total_rows ?? 0;
  return { rows: rows as AssignmentProgress[], total, truncated: total > rows.length };
}

export type EvaluationTotals = { offering_id: string | null; pending: number; awaiting: number; published: number; oldest_pending: Date | null };

/**
 * Evaluation counts independent of row limits: one overall row (`offering_id` null) plus one row per taught offering.
 * Optional assignment and offering filters narrow both.
 */
export async function evaluationTotals(scope: Scope, filter: { assignment?: string; offering?: string } = {}) {
  const empty: EvaluationTotals = { offering_id: null, pending: 0, awaiting: 0, published: 0, oldest_pending: null };
  if (scope.role !== "faculty") return { ...empty, byOffering: new Map<string, EvaluationTotals>() };
  const { rows } = await db.query<EvaluationTotals>(
    `WITH ${taught}, ${work}
     SELECT a.offering_id,
       count(*) FILTER (WHERE w.state='pending')::int AS pending,
       count(*) FILTER (WHERE w.state IN ('draft','correction'))::int AS awaiting,
       count(*) FILTER (WHERE w.state IN ('published','correction'))::int AS published,
       min(w.submitted_at) FILTER (WHERE w.state='pending') AS oldest_pending
     FROM work w JOIN assignment a ON a.institution_id=w.institution_id AND a.id=w.assignment_id
     WHERE ($3::uuid IS NULL OR a.id=$3) AND ($4::uuid IS NULL OR a.offering_id=$4)
     GROUP BY GROUPING SETS ((), (a.offering_id))`,
    [scope.institution, scope.account, filter.assignment ?? null, filter.offering ?? null],
  );
  const overall = rows.find(row => row.offering_id === null) ?? empty;
  return { ...overall, byOffering: new Map(rows.filter(row => row.offering_id).map(row => [row.offering_id as string, row])) };
}

export const queueStatuses = ["pending", "awaiting", "published", "all"] as const;
export const queueSorts = ["oldest", "newest", "deadline", "student", "recently-published"] as const;
export type QueueStatus = typeof queueStatuses[number];
export type QueueSort = typeof queueSorts[number];

export const queueStatusLabels: Record<QueueStatus, string> = {
  pending: "Awaiting evaluation",
  awaiting: "Awaiting publication",
  published: "Published",
  all: "All submissions",
};

export const queueSortLabels: Record<QueueSort, string> = {
  oldest: "Oldest submission first",
  newest: "Newest submission first",
  deadline: "Earliest deadline first",
  student: "Student name",
  "recently-published": "Recently published first",
};

const orderings: Record<QueueSort, string> = {
  oldest: "w.submitted_at,w.id",
  newest: "w.submitted_at DESC,w.id",
  deadline: "a.deadline,w.submitted_at,w.id",
  student: "u.name,w.submitted_at,w.id",
  "recently-published": "w.published_at DESC NULLS LAST,w.submitted_at,w.id",
};

const statusStates: Record<QueueStatus, EvaluationState[]> = {
  pending: ["pending"],
  awaiting: ["draft", "correction"],
  published: ["published", "correction"],
  all: ["pending", "draft", "correction", "published"],
};

export const queueFilters = z.object({
  status: z.enum(queueStatuses).catch("pending"),
  sort: z.enum(queueSorts).catch("oldest"),
  assignment: z.uuid().optional().catch(undefined),
  offering: z.uuid().optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(1000).catch(1),
  pageSize: z.coerce.number().int().min(1).max(100).catch(25),
});
export type QueueFilters = z.infer<typeof queueFilters>;

export type QueueItem = {
  submission: string; assignment: string; title: string; course: string; section: string; student: string;
  submitted_at: Date; deadline: Date; state: EvaluationState; draft_marks: number | null;
  published_marks: number | null; published_at: Date | null; max_marks: number; timezone: string;
};

/**
 * One page of submissions for offerings the caller currently teaches.
 * Filters are revalidated here so every caller, including future AURA tools, gets the same bounds.
 */
export async function evaluationQueue(scope: Scope, raw: unknown = {}) {
  const filters = queueFilters.parse(raw ?? {});
  if (scope.role !== "faculty") return { items: [] as QueueItem[], total: 0, ...filters };
  const { rows } = await db.query<QueueItem & { total: number }>(
    `WITH ${taught}, ${work}
     SELECT w.id AS submission,a.id AS assignment,a.title,c.name AS course,sec.name AS section,u.name AS student,
       w.submitted_at,a.deadline,w.state,w.draft_marks,w.published_marks,w.published_at,a.max_marks,i.timezone,
       count(*) OVER ()::int AS total
     FROM work w
     JOIN assignment a ON a.institution_id=w.institution_id AND a.id=w.assignment_id
     JOIN offering o ON o.institution_id=a.institution_id AND o.id=a.offering_id
     JOIN course c ON c.institution_id=o.institution_id AND c.id=o.course_id
     JOIN section sec ON sec.institution_id=o.institution_id AND sec.id=o.section_id
     JOIN institution i ON i.id=w.institution_id
     JOIN "user" u ON u.id=w.student_id
     WHERE w.state = ANY($3::text[]) AND ($4::uuid IS NULL OR a.id=$4) AND ($5::uuid IS NULL OR a.offering_id=$5)
     ORDER BY ${orderings[filters.sort]}
     LIMIT $6 OFFSET $7`,
    [scope.institution, scope.account, statusStates[filters.status], filters.assignment ?? null, filters.offering ?? null,
      filters.pageSize, (filters.page - 1) * filters.pageSize],
  );
  let total = rows[0]?.total;
  if (total === undefined) {
    // An out-of-range page returns no rows; count separately so the interface can offer the last page.
    total = (filters.page > 1 ? (await evaluationQueue(scope, { ...filters, page: 1, pageSize: 1 })).total : 0);
  }
  return { items: rows as QueueItem[], total, ...filters };
}

/** The oldest submission still awaiting evaluation in an assignment, other than `exclude`. */
export async function nextAwaitingEvaluation(scope: Scope, assignment: string, exclude?: string) {
  const { items } = await evaluationQueue(scope, { status: "pending", sort: "oldest", assignment, pageSize: 2 });
  return items.find(item => item.submission !== exclude) ?? null;
}

/** The same derivation as the SQL `work` read model, for records already loaded by `submissions()`. */
export function evaluationState(submission: { draft: unknown; published: unknown }): EvaluationState {
  if (submission.draft && submission.published) return "correction";
  if (submission.draft) return "draft";
  return submission.published ? "published" : "pending";
}
