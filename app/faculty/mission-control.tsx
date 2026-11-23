import Link from "next/link";
import { assignmentProgress, evaluationTotals } from "../../lib/faculty";
import { offerings } from "../../lib/assignments";
import { workspaceQuery, type Scope } from "../../lib/scope";
import { ActionForm } from "../forms";
import { workflow } from "../actions/workflow";
import { assignmentStatus, formatDate, href, plural } from "./format";
import { ProgressLine } from "./progress-line";

// Faculty home. Every count below is read from PostgreSQL for the caller's current teaching roster.
export async function MissionControl({ current, timezone }: { current: Scope; timezone: string }) {
  // Each section has its own query so a row limit in one cannot hide work in another.
  const [totals, active, unpublished, upcoming, courses] = await Promise.all([
    evaluationTotals(current),
    assignmentProgress(current, { view: "active", limit: 100 }),
    assignmentProgress(current, { view: "unpublished", limit: 20 }),
    assignmentProgress(current, { view: "open", limit: 5 }),
    offerings(current),
  ]);
  const query = workspaceQuery(current);

  return <div className="grid">
    <div className="stack">
      <section className="panel" aria-labelledby="next-work">
        <h2 id="next-work">What needs your attention</h2>
        {!courses.length ? <p>You have no active teaching assignments in this workspace. An institution administrator assigns courses.</p> :
          <ul className="work-list">
            <li>
              <p className="work-count">{totals.pending ? <Link href={href("/grading", query, { status: "pending" })}>{plural(totals.pending, "submission")} awaiting evaluation</Link> : "No submissions are awaiting evaluation"}</p>
              {totals.oldest_pending && <p className="meta">Oldest submitted {formatDate(totals.oldest_pending, timezone)}</p>}
            </li>
            <li>
              <p className="work-count">{totals.awaiting ? <Link href={href("/grading", query, { status: "awaiting" })}>{plural(totals.awaiting, "feedback draft")} awaiting publication</Link> : "No feedback drafts are awaiting publication"}</p>
              {totals.awaiting > 0 && <p className="meta">Students see marks and feedback only after you publish them.</p>}
            </li>
            <li>
              <p className="work-count">{unpublished.total ? `${plural(unpublished.total, "assignment")} not published` : "Every assignment is published"}</p>
              {unpublished.total > 0 && <ul className="items">{unpublished.rows.map(row => {
                const status = assignmentStatus(row);
                return <li key={row.id}>
                  <div className="row"><Link href={href(`/assignments/${row.id}`, query)}>{row.title}</Link><span className={status.tone === "attention" ? "tag tag-attention" : "tag"}>{status.label}</span></div>
                  <p className="meta">{row.course} · {row.section} · Due {formatDate(row.deadline, row.timezone)}</p>
                  <p className="meta">{status.detail}</p>
                </li>;
              })}</ul>}
              {unpublished.truncated && <p className="meta">Showing the {unpublished.rows.length} earliest deadlines. Open a course to see the rest.</p>}
            </li>
          </ul>}
      </section>

      {courses.length > 0 && <section className="panel" aria-labelledby="assignment-progress">
        <div className="row spread"><h2 id="assignment-progress">Assignment progress</h2><Link href={href("/grading", query, { status: "all" })}>All submissions</Link></div>
        <p className="meta">Assignments that are unpublished, still open, or have unfinished evaluation. Closed assignments with every result published are listed on each course page.</p>
        {active.rows.length ? <ul className="items">{active.rows.map(row => {
          const status = assignmentStatus(row);
          return <li key={row.id}>
            <div className="row"><Link href={href(`/assignments/${row.id}`, query)}>{row.title}</Link><span className={status.tone === "attention" ? "tag tag-attention" : "tag"}>{status.label}</span></div>
            <p className="meta">{row.course} · {row.section} · Due {formatDate(row.deadline, row.timezone)}</p>
            {row.published_at && <ProgressLine row={row} query={query} />}
          </li>;
        })}</ul> : <p>No assignments need attention. Create one below or open a course.</p>}
        {active.truncated && <p className="meta">Showing the first {active.rows.length} assignments. Open a course to see the rest.</p>}
      </section>}

      {upcoming.rows.length > 0 && <section className="panel" aria-labelledby="upcoming">
        <h2 id="upcoming">Next deadlines</h2>
        <ul className="items">{upcoming.rows.map(row => <li key={row.id}>
          <div className="row"><Link href={href(`/assignments/${row.id}`, query)}>{row.title}</Link></div>
          <p className="meta">{formatDate(row.deadline, row.timezone)} · {row.course} · {row.section} · {row.submitted_enrolled} of {row.enrolled} enrolled submitted</p>
        </li>)}</ul>
      </section>}
    </div>

    <div className="stack">
      <section className="panel" aria-labelledby="my-courses">
        <h2 id="my-courses">My courses</h2>
        {courses.length ? <ul className="items">{courses.map(course => {
          const work = totals.byOffering.get(course.id);
          return <li key={course.id}>
            <Link href={href(`/courses/${course.id}`, query)}>{course.label}</Link>
            {work && (work.pending > 0 || work.awaiting > 0) && <p className="meta">
              <Link href={href("/grading", query, { status: work.pending ? "pending" : "awaiting", offering: course.id })}>
                {[work.pending && `${work.pending} awaiting evaluation`, work.awaiting && `${work.awaiting} awaiting publication`].filter(Boolean).join(" · ")}
              </Link></p>}
          </li>;
        })}</ul> : <p>No active course assignments are available for this workspace.</p>}
      </section>
      <section className="panel" aria-labelledby="create-assignment">
        <h2 id="create-assignment">Create assignment</h2>
        {courses.length ? <ActionForm action={workflow} context={current} operation="create" label="Create draft">
          <label>Course and section<select name="offering" required>{courses.map(course => <option key={course.id} value={course.id}>{course.label}</option>)}</select></label>
          <label>Title<input name="title" required maxLength={160} /></label>
          <label>Instructions<textarea name="description" required maxLength={10000} /></label>
          <label>Deadline ({timezone})<input name="deadline" type="datetime-local" required /></label>
          <label>Maximum marks<input name="marks" type="number" min={1} max={10000} required /></label>
          <label>Rubric (optional)<textarea name="rubric" maxLength={8000} /></label>
          <label>Attachment (optional, PDF or TXT, 4 MiB)<input name="file" type="file" accept=".pdf,.txt" /></label>
        </ActionForm> : <p>No courses are currently assigned to you.</p>}
      </section>
    </div>
  </div>;
}
