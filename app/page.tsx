import { MissionControl } from "./faculty/mission-control";
import Link from "next/link";
import { account, scope, workspaces, workspaceQuery } from "../lib/scope";
import { notifications } from "../lib/automation";
import { Inbox } from "./experience/inbox";
import { adminRequestSummary, operationsReport } from "../lib/reporting";
import { HodBoard, PrincipalBoard } from "./leadership/boards";
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

  const [requestCounts, inbox, ops] = current?.role === "admin"
    ? await Promise.all([adminRequestSummary(current), notifications(current), operationsReport(current)])
    : [null, [], null];
  const query = current ? workspaceQuery(current) : "";
  return <Chrome user={user} current={current}>
    <ExperienceHeading title={current ? roleLabels[current.role] : "Your workspace"}
      context={current?.role === "faculty" ? "Manage assignments for the courses you teach." :
        current?.role === "hod" ? "Review academic activity for your departments." :
        current?.role === "principal" ? "Institution reporting from published academic records and service requests." :
        current?.role === "admin" ? "Review service requests, configure courses and manage access." : undefined} />
    {!current && <p className="panel">Your account has no active institutional workspace.</p>}
    {current?.role === "principal" && <PrincipalBoard current={current} timezone={workspace?.timezone ?? "Asia/Kolkata"} />}
    {current?.role === "admin" && <section className="panel">
      <h2>Institution operations</h2>
      {requestCounts && <dl className="metrics" aria-label="Enrollment-letter queue">
        <div><dt>Awaiting review</dt><dd>{requestCounts.submitted}</dd></div>
        <div><dt>In review</dt><dd>{requestCounts.in_review}</dd></div>
      </dl>}
      <p className="meta">Current enrollment-letter requests in this institution.</p>
      {ops && <section aria-labelledby="ops-title">
        <h3 id="ops-title">Operations · last 30 days</h3>
        <dl className="metrics" aria-label="Operations report">
          <div><dt>Unassigned open requests</dt><dd>{ops.unassigned}</dd></div>
          <div><dt>Oldest open request</dt><dd>{ops.oldest_open_hours === null ? "None" : `${ops.oldest_open_hours} h`}</dd></div>
          <div><dt>Median resolution</dt><dd>{ops.median_resolution_hours === null ? "—" : `${ops.median_resolution_hours} h`}</dd></div>
          <div><dt>Resolved · declined</dt><dd>{ops.resolved_30d} · {ops.declined_30d}</dd></div>
          <div><dt>Attendance corrections</dt><dd>{ops.attendance_corrections_30d}</dd></div>
          <div><dt>Result corrections</dt><dd>{ops.grade_corrections_30d}</dd></div>
        </dl>
      </section>}
      <Inbox items={inbox} current={current!} query={query} title="Routed to you" timezone={workspace?.timezone ?? "Asia/Kolkata"} />
      <ul className="items">
        <li><Link href={`/admin?${query}`}>Manage catalog and access</Link><p className="meta">Set up academic offerings, rosters and delegated roles.</p></li>
        <li><Link href={`/requests?${query}`}>Review the request queue</Link><p className="meta">Process student enrollment-letter requests.</p></li>
        <li><Link href={`/requests?${query}&view=mine`}>Requests assigned to me</Link><p className="meta">Your owned queue; unassigned requests are claimed when you start review.</p></li>
        <li><Link href={`/audit?${query}`}>Search the audit log</Link><p className="meta">Who changed which record and when, without record contents.</p></li>
        <li><Link href={`/notices?${query}`}>Manage institution notices</Link><p className="meta">Publish notices for this institution.</p></li>
      </ul>
    </section>}
    {current?.role === "hod" && <HodBoard current={current} />}
    {current?.role === "faculty" && <MissionControl current={current} timezone={workspace?.timezone ?? "Asia/Kolkata"} />}
  </Chrome>;
}
