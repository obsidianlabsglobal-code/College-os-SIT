import Link from "next/link";
import { account, scope, workspaces, workspaceQuery } from "../lib/scope";
import { assignments, offerings } from "../lib/assignments";
import { departmentSummary, institutionSummary } from "../lib/reporting";
import { ActionForm } from "./forms";
import { workflow } from "./actions/workflow";
import { Chrome } from "./chrome";

const roleLabels = { student: "Student", faculty: "Faculty", hod: "Department head", admin: "Institution admin", principal: "Principal" };

export default async function Home({ searchParams }: { searchParams: Promise<{ institution?: string; role?: string }> }) {
  const user = await account();
  const options = await workspaces(user.id);
  const params = await searchParams;
  const first = options[0];
  const current = first ? await scope(params.institution ?? first.id, params.role ?? first.role) : null;
  const workspace = options.find(option => option.id === current?.institution && option.role === current?.role);
  const [records, courses, summary, overview] = current
    ? await Promise.all([assignments(current), offerings(current), departmentSummary(current), institutionSummary(current)])
    : [[], [], [], []];
  const query = current ? workspaceQuery(current) : "";
  return <Chrome name={user.name}>
    <div className="hero">
      <span className="meta">{workspace?.name ?? "College OS"}</span>
      <h1>{current ? roleLabels[current.role] : "Your workspace"}</h1>
      {options.length > 1 && <nav className="row" aria-label="Workspaces">
        {options.map(option => <Link key={`${option.id}-${option.role}`} href={`/?${new URLSearchParams({ institution: option.id, role: option.role })}`}
          aria-current={option === workspace ? "page" : undefined}>{option.name} · {roleLabels[option.role]}</Link>)}
      </nav>}
    </div>
    {!current && <p className="panel">Your account has no active institutional workspace.</p>}
    {current && <nav className="row workspace-nav" aria-label="Campus workflows">
      <Link href={`/notices?${query}`}>Notices</Link>
      {(current.role === "admin" || current.role === "student") && <Link href={`/requests?${query}`}>Service requests</Link>}
      {current.role === "admin" && <Link href={`/admin?${query}`}>Academic setup and roles</Link>}
    </nav>}
    {current?.role === "principal" && <section className="panel">
      <h2>Institution activity</h2>
      {overview.map(row => <dl key={row.name}>
        <dt>Published assignments</dt><dd>{row.assignments}</dd>
        <dt>Submissions</dt><dd>{row.submissions}</dd>
        <dt>Published results</dt><dd>{row.results}</dd>
        <dt>Open service requests</dt><dd>{row.open_requests}</dd>
      </dl>)}
    </section>}
    {current?.role === "hod" && <section className="panel">
      <h2>Department activity</h2>
      {summary.length ? <div className="table-scroll"><table>
        <thead><tr><th scope="col">Department</th><th scope="col">Published assignments</th><th scope="col">Submissions</th><th scope="col">Published results</th><th scope="col">Average turnaround</th></tr></thead>
        <tbody>{summary.map(row => <tr key={row.name}><th scope="row">{row.name}</th><td>{row.assignments}</td><td>{row.submissions}</td><td>{row.results}</td><td>{row.hours === null ? "—" : `${row.hours.toFixed(1)} h`}</td></tr>)}</tbody>
      </table></div> : <p>No departments are assigned to this workspace.</p>}
    </section>}
    {(current?.role === "faculty" || current?.role === "student") && <div className={current.role === "faculty" ? "grid" : "stack"}>
      <section className="panel">
        <h2>Assignments</h2>
        {records.length ? <ul className="items">{records.map(record => <li key={record.id}>
          <div className="row"><Link href={`/assignments/${record.id}?${query}`}>{record.title}</Link><span className="tag">{record.published_at ? "Published" : "Draft"}</span></div>
          <p className="meta">{record.course} · {record.section} · Due {formatDate(record.deadline, record.timezone)}</p>
        </li>)}</ul> : <p>No assignments are available.</p>}
      </section>
      {current.role === "faculty" && <section className="panel">
        <h2>Create assignment</h2>
        {courses.length ? <ActionForm action={workflow} context={current} operation="create" label="Create draft">
          <label>Course and section<select name="offering" required>{courses.map(course => <option key={course.id} value={course.id}>{course.label}</option>)}</select></label>
          <label>Title<input name="title" required maxLength={160} /></label>
          <label>Instructions<textarea name="description" required maxLength={10000} /></label>
          <label>Deadline ({workspace?.timezone})<input name="deadline" type="datetime-local" required /></label>
          <label>Maximum marks<input name="marks" type="number" min={1} max={10000} required /></label>
          <label>Rubric (optional)<textarea name="rubric" maxLength={8000} /></label>
          <label>Attachment (optional, PDF or TXT, 4 MiB)<input name="file" type="file" accept=".pdf,.txt" /></label>
        </ActionForm> : <p>No courses are currently assigned to you.</p>}
      </section>}
    </div>}
  </Chrome>;
}

function formatDate(value: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(value);
}
