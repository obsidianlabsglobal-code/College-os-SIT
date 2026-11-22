import Link from "next/link";
import { notFound } from "next/navigation";
import { account, scope, workspaceQuery } from "../../lib/scope";
import { offerings } from "../../lib/assignments";
import {
  gradingAssignments, resultPage, evaluationLabels, queueFilters, evaluationQueue, evaluationTotals,
  queueSortLabels, queueSorts, queueStatusLabels, queueStatuses, type QueueStatus,
} from "../../lib/faculty";
import { Chrome } from "../chrome";
import { PageHeader } from "../page-header";
import { actionLabels, formatDate, href, plural } from "../faculty/format";

type Search = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export default async function EvaluationQueue({ searchParams }: { searchParams: Promise<Search> }) {
  const [params, user] = await Promise.all([searchParams, account()]);
  const current = await scope(first(params.institution), first(params.role));
  if (current.role !== "faculty") notFound();
  const query = workspaceQuery(current);
  const requested = queueFilters.parse({
    status: first(params.status), sort: first(params.sort), assignment: first(params.assignment),
    offering: first(params.offering), page: first(params.page),
  });
  const assignmentSearch = first(params.assignmentSearch)?.trim().slice(0,160) ?? "";
  const pickerPage = resultPage.parse(first(params.pickerPage));
  const [queue, totals, options, selection, courses] = await Promise.all([
    evaluationQueue(current, requested),
    evaluationTotals(current, { assignment: requested.assignment, offering: requested.offering }),
    gradingAssignments(current, { offering: requested.offering, search: assignmentSearch, page: pickerPage }),
    requested.assignment ? gradingAssignments(current, { assignment: requested.assignment }) : [],
    offerings(current),
  ]);
  const [selected] = selection;
  const filters = { status: queue.status, sort: queue.sort, assignment: queue.assignment, offering: queue.offering, assignmentSearch, pickerPage };
  const pages = Math.max(1, Math.ceil(queue.total / queue.pageSize));
  const start = (queue.page - 1) * queue.pageSize;
  const counts: Partial<Record<QueueStatus, number>> = { pending: totals.pending, awaiting: totals.awaiting, published: totals.published };
  const course = courses.find(row => row.id === queue.offering);
  const assignmentOptions = options.slice(0,25);
  const conflictingFilters = selected && queue.offering && selected.offering_id !== queue.offering;

  return <Chrome user={user} current={current} section="/grading">
    <PageHeader title="Evaluation queue" context="Submitted work in the courses you currently teach. Students see marks and feedback only after you publish them."
      parent={{ href: `/?${query}`, label: "Overview" }} />
    <div className="stack">
      <nav aria-label="Queue status" className="status-tabs">
        {queueStatuses.map(status => <Link key={status} href={href("/grading", query, { ...filters, status })}
          aria-current={status === queue.status ? "page" : undefined}>
          {queueStatusLabels[status]}{counts[status] !== undefined && <>{" "}<span className="count">{counts[status]}</span></>}
        </Link>)}
      </nav>

      <p className="meta">A submission with a pending correction appears under both Awaiting publication and Has a published result. Students keep seeing the published result until the correction is published.</p>
      <form className="panel queue-filters" method="get" action="/grading">
        <input type="hidden" name="institution" value={current.institution} />
        <input type="hidden" name="role" value={current.role} />
        <input type="hidden" name="status" value={queue.status} />
        <label>Course
          <select name="offering" defaultValue={queue.offering ?? ""}>
            <option value="">All my courses</option>
            {courses.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}
          </select>
        </label>
        <label>Find assignments by title
          <input type="search" name="assignmentSearch" defaultValue={assignmentSearch} maxLength={160}/>
        </label>
        <label>Assignment
          <select name="assignment" defaultValue={queue.assignment ?? ""}>
            <option value="">All assignments</option>
            {assignmentOptions.map(row => <option key={row.id} value={row.id}>{row.title} · {row.section}</option>)}
            {queue.assignment && !selected && <option value={queue.assignment}>Unavailable assignment</option>}
            {selected && !assignmentOptions.some(row => row.id === selected.id) && <option value={selected.id}>{selected.title} · {selected.section}</option>}
          </select>
        </label>
        <label>Sort
          <select name="sort" defaultValue={queue.sort}>
            {queueSorts.map(sort => <option key={sort} value={sort}>{queueSortLabels[sort]}</option>)}
          </select>
        </label>
        <div className="row"><button className="button">Apply filters</button>
          {(queue.offering || queue.assignment || assignmentSearch) && <Link href={href("/grading", query, { status: queue.status, sort: queue.sort })}>Clear filters</Link>}</div>
      </form>
      {assignmentSearch && !options.length && pickerPage === 1 && <p className="meta">No submitted assignments match that title search.</p>}
      {(pickerPage !== 1 || options.length > 25) && <nav aria-label="Assignment choices" className="row">
        {pickerPage !== 1 && <Link href={href("/grading", query, { ...filters, pickerPage: pickerPage > 1 && options.length ? pickerPage - 1 : 1, page: queue.page || undefined })}>{pickerPage > 1 && options.length ? "Previous assignment choices" : "Go to first assignment choices"}</Link>}
        {options.length > 25 && <Link href={href("/grading", query, { ...filters, pickerPage: pickerPage + 1, page: queue.page || undefined })}>Next assignment choices</Link>}
      </nav>}

      <section className="panel" aria-labelledby="queue-results">
        <h2 id="queue-results">{queueStatusLabels[queue.status]}</h2>
        {(course || selected) && <p className="meta">Filtered to {[course?.label, selected && `${selected.title} · ${selected.section}`].filter(Boolean).join(" · ")}</p>}
        {queue.items.length > 0 && <p className="meta" role="status">Showing {start + 1}–{start + queue.items.length} of {plural(queue.total, "submission")}</p>}
        {!queue.page ? <p>That page number is invalid. <Link href={href("/grading", query, { ...filters, page: 1 })}>Go to page 1</Link></p>
          : conflictingFilters ? <p>The selected assignment belongs to a different course. <Link href={href("/grading", query, { ...filters, assignment: undefined, page: 1 })}>Clear assignment filter</Link></p>
          : queue.assignment && !selected ? <p>The selected assignment is unavailable.</p>
          : !courses.length ? <p>You have no active teaching assignments in this workspace.</p>
          : queue.total === 0 && queue.page === 1 ? <EmptyState status={queue.status} awaiting={totals.awaiting} query={query} filters={filters} filtered={Boolean(queue.offering || queue.assignment)} />
          : queue.items.length === 0 ? <p>This page is past the end of the results. <Link href={href("/grading", query, { ...filters, page: pages })}>Go to the last page</Link></p>
          : <ol className="queue" start={start + 1}>{queue.items.map(item => <li key={item.submission}>
            <div className="queue-main">
              <p className="queue-student">{item.student}</p>
              <p className="meta">{item.title} · {item.course} · {item.section}</p>
              <p className="meta">Submitted {formatDate(item.submitted_at, item.timezone)} · Deadline {formatDate(item.deadline, item.timezone)}</p>
            </div>
            <div className="queue-state">
              {queue.status !== "pending" && <span className={item.state === "pending" ? "tag tag-attention" : "tag"}>{evaluationLabels[item.state]}</span>}
              <p className="meta">
                {item.draft_marks !== null && <>Draft {item.draft_marks}/{item.max_marks}</>}
                {item.draft_marks !== null && item.published_marks !== null && " · "}
                {item.published_marks !== null && <>Published {item.published_marks}/{item.max_marks}</>}
              </p>
            </div>
            <Link className="button secondary" href={href(`/assignments/${item.assignment}`, query, { submission: item.submission })}>
              {actionLabels[item.state]}<span className="sr-only"> submission by {item.student} for {item.title}</span>
            </Link>
          </li>)}</ol>}
        {pages > 1 && queue.items.length > 0 && <nav aria-label="Queue pages" className="pagination">
          {queue.page > 1 ? <Link href={href("/grading", query, { ...filters, page: queue.page - 1 })}>Previous page</Link> : <span aria-hidden="true" />}
          <span>Page {queue.page} of {pages}</span>
          {queue.page < pages ? <Link href={href("/grading", query, { ...filters, page: queue.page + 1 })}>Next page</Link> : <span aria-hidden="true" />}
        </nav>}
      </section>
    </div>
  </Chrome>;
}

function EmptyState({ status, awaiting, query, filters, filtered }: { status: QueueStatus; awaiting: number; query: string; filters: Parameters<typeof href>[2]; filtered: boolean }) {
  const message = {
    pending: "No submissions are awaiting evaluation.",
    awaiting: "No feedback drafts are awaiting publication.",
    published: "No results have been published yet.",
    all: "No submissions have been received yet.",
  }[status];
  return <div className="stack">
    <p>{filtered ? message.replace(".", " for this filter.") : message}</p>
    {status === "pending" && awaiting > 0 && <p><Link href={href("/grading", query, { ...filters, status: "awaiting" })}>Review {plural(awaiting, "feedback draft")} awaiting publication</Link></p>}
  </div>;
}
