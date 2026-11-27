import { MissionControl } from "./faculty/mission-control";
import Link from "next/link";
import { account, scope, workspaces, workspaceQuery } from "../lib/scope";
import { SegmentedBar } from "./experience/segmented-bar";
import { adminRequestSummary, departmentSummary, institutionSummary } from "../lib/reporting";
import { Suspense } from "react";
import { ExperienceHeading } from "./experience/heading";
import { StudentHome, StudentHomeLoading } from "./student/home";
import { cookies } from "next/headers";
import { Chrome, roleLabels } from "./chrome";

export default async function Home({ searchParams }: { searchParams: Promise<{ institution?: string; role?: string }> }) {
  const user = await account();
  const options = await workspaces(user.id);
  const params = await searchParams;
  const preferred = new URLSearchParams((await cookies()).get("nexus_workspace")?.value);
  const first = options.find(option => option.id === preferred.get("institution") && option.role === preferred.get("role")) ?? options[0];
  const current = first ? await scope(params.institution ?? first.id, params.role ?? first.role) : null;
  const workspace = options.find(option => option.id === current?.institution && option.role === current?.role);
  if (current?.role === "student") {
    return <Chrome user={user} current={current}>
      <Suspense fallback={<StudentHomeLoading />}>
        <StudentHome current={current} name={user.name} timezone={workspace?.timezone ?? "UTC"} />
      </Suspense>
    </Chrome>;
  }

  const [summary, overview, requestCounts] = current
    ? await Promise.all([departmentSummary(current), institutionSummary(current), adminRequestSummary(current)])
    : [[], [], null];
  const query = current ? workspaceQuery(current) : "";
  return <Chrome user={user} current={current}>
    <ExperienceHeading title={current ? roleLabels[current.role] : "Your workspace"}
      context={current?.role === "faculty" ? "Manage assignments for the courses you teach." :
        current?.role === "hod" ? "Review academic activity for your departments." :
        current?.role === "principal" ? "Institution reporting from published academic records and service requests." :
        current?.role === "admin" ? "Review service requests, configure courses and manage access." : undefined} />
    {!current && <p className="panel">Your account has no active institutional workspace.</p>}
    {current?.role === "principal" && <section className="panel">
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
    </section>}
    {current?.role === "admin" && <section className="panel">
      <h2>Institution operations</h2>
      {requestCounts && <dl className="metrics" aria-label="Enrollment-letter queue">
        <div><dt>Awaiting review</dt><dd>{requestCounts.submitted}</dd></div>
        <div><dt>In review</dt><dd>{requestCounts.in_review}</dd></div>
      </dl>}
      <p className="meta">Current enrollment-letter requests in this institution.</p>
      <ul className="items">
        <li><Link href={`/admin?${query}`}>Manage catalog and access</Link><p className="meta">Set up academic offerings, rosters and delegated roles.</p></li>
        <li><Link href={`/requests?${query}`}>Review the request queue</Link><p className="meta">Process student enrollment-letter requests.</p></li>
        <li><Link href={`/notices?${query}`}>Manage institution notices</Link><p className="meta">Publish notices for this institution.</p></li>
      </ul>
    </section>}
    {current?.role === "hod" && <section className="panel">
      <h2>Department activity</h2>
      <p className="meta">All recorded activity in your assigned departments. Turnaround measures the average time from submission to first publication.</p>
      {summary.length ? <div className="table-scroll department-report" role="region" aria-label="Department reports" tabIndex={0}><table>
        <thead><tr><th scope="col">Department</th><th scope="col">Published assignments</th><th scope="col">Submissions</th><th scope="col">Published results</th><th scope="col">Average turnaround</th><th scope="col">Results progress</th></tr></thead>
        <tbody>{summary.map(row => <tr key={row.name}><th scope="row">{row.name}</th><td>{row.assignments}</td><td>{row.submissions}</td><td>{row.results}</td><td>{row.hours === null ? "—" : `${row.hours.toFixed(1)} h`}</td><td><SegmentedBar label={`${row.name} published results`} total={row.submissions}
          rest="awaiting results" parts={[{ label: "published", value: row.results, tone: 1 }]} /></td></tr>)}</tbody>
      </table></div> : <p>No departments are assigned to this workspace.</p>}
    </section>}
    {current?.role === "faculty" && <MissionControl current={current} timezone={workspace?.timezone ?? "Asia/Kolkata"} />}
  </Chrome>;
}
