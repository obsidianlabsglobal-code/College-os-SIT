import Link from "next/link";
import { departmentComparison, departmentFaculty, departmentSections, escalatedRequests } from "../../lib/department";
import { departmentSummary, institutionSummary } from "../../lib/reporting";
import { notifications } from "../../lib/automation";
import { workspaceQuery, type Scope } from "../../lib/scope";
import { SegmentedBar } from "../experience/segmented-bar";
import { Inbox } from "../experience/inbox";
import { plural } from "../faculty/format";
import styles from "./boards.module.css";

const rate = (part: number, whole: number) => whole ? `${(100 * part / whole).toFixed(1)}%` : "—";
const statusLabel: Record<string, string> = { submitted: "Awaiting review", in_progress: "In review", resolved: "Resolved", declined: "Declined" };

/** HOD board: what needs department attention first, then who carries which work, then each section's record. */
export async function HodBoard({ current }: { current: Scope }) {
  const [summary, faculty, sections] = await Promise.all([departmentSummary(current), departmentFaculty(current), departmentSections(current)]);
  const pending = faculty.reduce((n, row) => n + row.pending, 0), awaiting = faculty.reduce((n, row) => n + row.awaiting, 0);
  const unrecorded = faculty.reduce((n, row) => n + row.unrecorded, 0);
  const below = sections.filter(row => row.target !== null && row.marked > 0 && 100 * row.present / row.marked < row.target);
  return <div className={styles.board}>
    <section className={`panel ${styles.hero}`} aria-labelledby="hod-focus">
      <p className={styles.eyebrow}>Department focus</p>
      <h2 id="hod-focus">{pending + awaiting + unrecorded + below.length === 0 ? "Department records are up to date"
        : [pending && `${pending} awaiting evaluation`, awaiting && `${plural(awaiting, "feedback draft")} unpublished`,
          unrecorded && `${plural(unrecorded, "class", "classes")} without attendance`, below.length && `${plural(below.length, "section")} below target`].filter(Boolean).join(" · ")}</h2>
      <p className="meta">Counts come from submissions, grades, classes and attendance records in your assigned departments. Attendance uses each class’s latest correction.</p>
      <dl className={styles.kpis}>
        <div><dt>Faculty teaching</dt><dd>{faculty.length}</dd></div>
        <div><dt>Sections</dt><dd>{sections.length}</dd></div>
        <div><dt>Awaiting evaluation</dt><dd>{pending}</dd></div>
        <div><dt>Classes without attendance (7 days)</dt><dd>{unrecorded}</dd></div>
      </dl>
    </section>

    <section className="panel">
      <h2>Department activity</h2>
      <p className="meta">All recorded activity in your assigned departments. Turnaround measures the average time from submission to first publication.</p>
      {summary.length ? <div className="table-scroll department-report" role="region" aria-label="Department reports" tabIndex={0}><table>
        <thead><tr><th scope="col">Department</th><th scope="col">Published assignments</th><th scope="col">Submissions</th><th scope="col">Published results</th><th scope="col">Average turnaround</th><th scope="col">Results progress</th></tr></thead>
        <tbody>{summary.map(row => <tr key={row.name}><th scope="row">{row.name}</th><td>{row.assignments}</td><td>{row.submissions}</td><td>{row.results}</td><td>{row.hours === null ? "—" : `${row.hours.toFixed(1)} h`}</td><td><SegmentedBar label={`${row.name} published results`} total={row.submissions}
          rest="awaiting results" parts={[{ label: "published", value: row.results, tone: 1 }]} /></td></tr>)}</tbody>
      </table></div> : <p>No departments are assigned to this workspace.</p>}
    </section>

    <div className={styles.columns}>
      <section className="panel" aria-labelledby="faculty-title">
        <h2 id="faculty-title">Faculty responsibilities</h2>
        <p className="meta">Current teaching assignments. Evaluation counts cover published assignments; classes cover the next and last seven days.</p>
        {faculty.length ? <ul className={styles.people}>{faculty.map(row => <li key={row.account}>
          <h3>{row.name}</h3>
          <p className="meta">{row.offerings.join(" · ")}</p>
          <dl className={styles.chips}>
            <div data-attention={row.pending > 0 || undefined}><dt>Awaiting evaluation</dt><dd>{row.pending}</dd></div>
            <div><dt>Drafts unpublished</dt><dd>{row.awaiting}</dd></div>
            <div><dt>Classes next 7 days</dt><dd>{row.upcoming}</dd></div>
            <div data-attention={row.unrecorded > 0 || undefined}><dt>Attendance not recorded</dt><dd>{row.unrecorded}</dd></div>
          </dl>
        </li>)}</ul> : <p>No faculty currently teach in your departments.</p>}
      </section>

      <section className="panel" aria-labelledby="sections-title">
        <h2 id="sections-title">Sections and attendance</h2>
        <p className="meta">Verified attendance from recorded classes. Planning targets are shown as recorded; they are not eligibility decisions.</p>
        {sections.length ? <ul className={styles.people}>{sections.map(row => <li key={row.offering}>
          <div className={styles.head}><h3>{row.course} · {row.section}</h3>
            {row.target !== null && row.marked > 0 && 100 * row.present / row.marked < row.target && <span className="tag tag-attention">Below planning target</span>}</div>
          <p className="meta">{row.term} · {row.faculty.join(", ") || "No faculty assigned"} · {row.classes} recorded classes · {rate(row.present, row.marked)} present
            {row.target !== null && ` · target ${row.target}% (${row.target_source})`}</p>
          {row.marked > 0 && <SegmentedBar label={`${row.course} ${row.section} attendance`} total={row.marked} rest="absent"
            parts={[{ label: "present", value: row.present, tone: 1 }]} />}
          <details><summary>Roster · {plural(row.students.length, "student")}</summary>
            {row.students.length ? <ul className={styles.roster}>{row.students.map(name => <li key={name}>{name}</li>)}</ul> : <p>No enrolled students.</p>}
          </details>
        </li>)}</ul> : <p>No sections in your departments.</p>}
      </section>
    </div>
  </div>;
}

/** Principal board: escalations and decisions first, then institution totals, then a like-for-like department comparison. */
export async function PrincipalBoard({ current, timezone }: { current: Scope; timezone: string }) {
  const [overview, departments, escalations, inbox] = await Promise.all([institutionSummary(current), departmentComparison(current),
    escalatedRequests(current), notifications(current)]);
  const query = workspaceQuery(current);
  const open = escalations.filter(row => row.status === "submitted" || row.status === "in_progress");
  const when = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: timezone });
  return <div className={styles.board}>
    <section className={`panel ${styles.hero}`} aria-labelledby="principal-focus">
      <p className={styles.eyebrow}>Institution focus</p>
      <h2 id="principal-focus">{open.length ? `${open.length} escalated ${open.length === 1 ? "request is" : "requests are"} still open` : "No open escalations"}</h2>
      <p className="meta">Escalations come from the service-request rule after 48 hours without review. Decisions stay with the administrative office.</p>
      {overview.map(row => <dl className={styles.kpis} key={row.name}>
        <div><dt>Departments</dt><dd>{departments.length}</dd></div>
        <div><dt>Students enrolled</dt><dd>{departments.reduce((n, d) => n + d.students, 0)}</dd></div>
        <div><dt>Results published</dt><dd>{rate(row.results, row.submissions)}</dd></div>
        <div><dt>Open escalations</dt><dd>{open.length}</dd></div>
      </dl>)}
    </section>

    <div className={styles.columns}>
      <Inbox items={inbox} current={current} query={query} title="Escalations" timezone={timezone} className="panel" />
      <section className="panel" aria-labelledby="decisions-title">
        <h2 id="decisions-title">Escalated requests and decisions</h2>
        {escalations.length ? <ul className={styles.people}>{escalations.map(row => <li key={row.id}>
          <div className={styles.head}><h3>{row.student}</h3><span className={row.status === "submitted" ? "tag tag-attention" : "tag"}>{statusLabel[row.status]}</span></div>
          <p className="meta">Submitted {when.format(row.created_at)} · escalated {when.format(row.escalated_at)}{row.handler && ` · handled by ${row.handler}`}</p>
          <p>{row.outcome ?? row.description}</p>
        </li>)}</ul> : <p>No requests have been escalated to you.</p>}
        <Link href={`/automation?${query}`}>Automation Centre</Link>
      </section>
    </div>

    <section className="panel">
      <h2>Institution activity</h2>
      <p className="meta">All recorded activity for this institution. Published results count each submission once.</p>
      {overview.map(row => <dl className="metrics" key={row.name}>
        <div><dt>Published assignments</dt><dd>{row.assignments}</dd></div>
        <div><dt>Submissions</dt><dd>{row.submissions}</dd></div>
        <div><dt>Published results</dt><dd>{row.results}</dd></div>
        <div><dt>Open service requests</dt><dd>{row.open_requests}</dd></div>
      </dl>)}
      {overview.map(row => <SegmentedBar key={row.name} label="Submissions with published results" total={row.submissions} rest="awaiting results"
        parts={[{ label: "with published results", value: row.results, tone: 1 }]} />)}
    </section>

    <section className="panel" aria-labelledby="compare-title">
      <h2 id="compare-title">Departments compared</h2>
      <p className="meta">Each measure uses the same definition in every department: active rosters, published assignments, submissions with a published result, and present marks in each class’s latest attendance record.</p>
      {departments.length ? <div className={`table-scroll ${styles.compare}`} role="region" aria-label="Department comparison" tabIndex={0}><table>
        <thead><tr><th scope="col">Department</th><th scope="col">Offerings</th><th scope="col">Faculty</th><th scope="col">Students</th><th scope="col">Published assignments</th><th scope="col">Results published</th><th scope="col">Attendance</th></tr></thead>
        <tbody>{departments.map(row => <tr key={row.id}><th scope="row">{row.name}</th><td>{row.offerings}</td><td>{row.faculty}</td><td>{row.students}</td><td>{row.assignments}</td>
          <td>{rate(row.results, row.submissions)}</td><td>{rate(row.present, row.marked)}</td></tr>)}</tbody>
      </table></div> : <p>No departments are configured.</p>}
    </section>
  </div>;
}
