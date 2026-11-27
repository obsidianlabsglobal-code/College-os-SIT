import { notifications } from "../../lib/automation";
import { Inbox } from "../experience/inbox";
import { facultyAttendanceWork } from "../../lib/academic-day";
import { StatusBreakdown } from "../experience/status-breakdown";
import { QuickLookup } from "../aura/quick-lookup";
import { ClassTimeline } from "../experience/class-timeline";
import Link from "next/link";
import { assignmentProgress, evaluationTotals } from "../../lib/faculty";
import { offerings } from "../../lib/assignments";
import { workspaceQuery, type Scope } from "../../lib/scope";
import { ActionForm } from "../forms";
import { workflow } from "../actions/workflow";
import { assignmentStatus, formatDate, href, plural } from "./format";
import { ProgressLine } from "./progress-line";
import { Icon } from "../experience/workspace-icon";
import styles from "./mission-control.module.css";

// Faculty home. Every count below is read from PostgreSQL for the caller's current teaching roster.
export async function MissionControl({ current, timezone }: { current: Scope; timezone: string }) {
  // Each section has its own query so a row limit in one cannot hide work in another.
  const day = new Intl.DateTimeFormat("sv-SE",{dateStyle:"short",timeZone:timezone});
  const [totals, active, unpublished, upcoming, courses, attendanceWork, inbox] = await Promise.all([
    evaluationTotals(current),
    assignmentProgress(current, { view: "active", limit: 100 }),
    assignmentProgress(current, { view: "unpublished", limit: 20 }),
    assignmentProgress(current, { view: "open", limit: 5 }),
    offerings(current),
    facultyAttendanceWork(current,day.format(new Date())),
    notifications(current),
  ]);
  const query = workspaceQuery(current);
  const waiting = attendanceWork.filter(item=>item.state==="published");

  return <div className={styles.workspace}>
    <Inbox items={inbox} current={current} query={query} title="Prepared for you" timezone={timezone} className="panel" />
    <div className={styles.lead}>
      <section className={`panel ${styles.hero}`} aria-labelledby="faculty-priority">
        <p className={styles.eyebrow}>Your teaching workspace</p>
        <h2 id="faculty-priority">Teaching priorities</h2>
        <p className="meta">{totals.pending > 0 ? `${plural(totals.pending, "submission")} awaiting evaluation.` :
          totals.awaiting > 0 ? `${plural(totals.awaiting, "feedback draft")} ready for review before publication.` :
          courses.length ? "No evaluations are waiting. View today’s classes or create an assignment." :
          "Your workspace has no active teaching assignments."}</p>
        <div className={styles.actions}>{totals.pending > 0 || totals.awaiting > 0
          ? <Link className="button" href={href("/grading", query, { status: totals.pending > 0 ? "pending" : "awaiting" })}>Go to evaluation queue</Link>
          : null}
          <Link className={totals.pending || totals.awaiting ? "button secondary" : "button"}
            href={href("/timetable", query, { view: "day" })}>Today’s timetable</Link>
          {waiting.length>0 && <a className="button secondary" href="#attendance-workbench">Review attendance queue</a>}
          {courses.length>0 && <a className="button secondary" href="#create-assignment">Create assignment</a>}
        </div>
      </section>
      <div className={styles.timeline}><ClassTimeline current={current} timezone={timezone} /></div>
    </div>
    <section className={`panel ${styles.attendanceWork}`} id="attendance-workbench" tabIndex={-1} aria-labelledby="attendance-work-title">
      <div><p className="app-kicker">Class records</p><h2 id="attendance-work-title">Attendance queue</h2>
        <p className="meta">Your eligible classes that ended today or on the preceding six calendar days.</p></div>
      <StatusBreakdown label="Class attendance records" segments={[
        {label:"To record",count:waiting.length,tone:"attention"},
        {label:"Recorded",count:attendanceWork.length-waiting.length,tone:"primary"},
      ]} />
      {waiting.length ? <ul className={styles.attendanceList}>{waiting.map(item=><li key={item.id}>
        <div><h3>{item.course} · {item.section}</h3><p className="meta">{formatDate(item.start,timezone)} · {item.room}</p></div>
        <a href={href("/timetable",query,{day:day.format(item.start),view:"day",session:item.id})+"#class-details"}
          aria-label={`Open roll sheet for ${item.course}, ${item.section}, ${formatDate(item.start,timezone)}`}>Open roll sheet</a>
      </li>)}</ul> : <p>No eligible classes waiting for attendance.</p>}
    </section>
    <nav className={styles.summary} aria-label="Teaching overview">
      <Link href={href("/grading", query, { status: "pending" })}><Icon name="check" /><span>Pending evaluations</span><strong>{totals.pending}</strong></Link>
      <Link href={href("/grading", query, { status: "awaiting" })}><Icon name="book" /><span>Private feedback drafts</span><strong>{totals.awaiting}</strong></Link>
      <a href="#next-work"><Icon name="notice" /><span>Unpublished assignments</span><strong>{unpublished.total}</strong></a>
      <a href="#my-courses"><Icon name="people" /><span>Active teaching assignments</span><strong>{courses.length}</strong></a>
    </nav>
    <div className={styles.columns}>
    <div className="stack">
      <section className={`panel ${styles.priority}`} aria-labelledby="next-work">
        <p className={styles.eyebrow}>Teaching priorities</p>
        <h2 id="next-work" tabIndex={-1}>What needs your attention</h2>
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
      <section className={`panel ${styles.aura}`} aria-labelledby="faculty-aura">
        <h2 id="faculty-aura">AURA assistant</h2>
        <p className="meta">Look up your teaching schedule or evaluation queue from authorized records.</p>
        <QuickLookup current={current} />
      </section>
      <section className="panel" aria-labelledby="my-courses">
        <h2 id="my-courses" tabIndex={-1}>My courses</h2>
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
        <h2 id="create-assignment" tabIndex={-1}>Create assignment</h2>
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
    </div>
  </div>;
}
