import { notFound } from "next/navigation";
import { PageHeader } from "../../page-header";
import { Chrome } from "../../chrome";
import { ActionForm } from "../../forms";
import { decideJoinAction } from "../../actions/onboarding";
import { account, scope, workspaceQuery } from "../../../lib/scope";
import { sectionRequests } from "../../../lib/student-admission";

export default async function StudentApprovals({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [params, user] = await Promise.all([searchParams, account()]);
  const current = await scope(params.institution, params.role);
  if (current.role !== "faculty") notFound();
  const requests = await sectionRequests(current);
  const pending = requests.filter(r => r.state === "pending");
  const when = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" });
  return <Chrome user={user} current={current} section="/approvals/students">
    <PageHeader title="Student approvals" parent={{ href: `/?${workspaceQuery(current)}`, label: "Workspace" }}
      context="Students who asked to join the sections you teach or mentor. Check each name and USN against your class list before approving." />
    <section className="panel stack" aria-labelledby="pending-title">
      <h2 id="pending-title">Waiting for a decision ({pending.length})</h2>
      {pending.length ? <ActionForm action={decideJoinAction} context={current} label="Approve selected">
        <input type="hidden" name="decision" value="approved" />
        <fieldset><legend>Select students</legend>{pending.map(r => <label key={r.id}><input type="checkbox" name="request" value={r.id} />
          {r.name} · {r.usn} · {r.section} · semester {r.semester} · {r.email}</label>)}</fieldset>
      </ActionForm> : <p>No requests are waiting.</p>}
      {pending.length > 0 && <details><summary>Reject selected with a reason</summary>
        <ActionForm action={decideJoinAction} context={current} label="Reject selected">
          <input type="hidden" name="decision" value="rejected" />
          <fieldset><legend>Select students</legend>{pending.map(r => <label key={r.id}><input type="checkbox" name="request" value={r.id} /> {r.name} · {r.usn}</label>)}</fieldset>
          <label>Reason the student will see<input name="reason" required maxLength={300} /></label>
        </ActionForm></details>}
    </section>
    {requests.some(r => r.state !== "pending") && <section className="panel stack" aria-labelledby="decided-title">
      <h2 id="decided-title">Decided in the last 30 days</h2>
      <ul className="items">{requests.filter(r => r.state !== "pending").map(r => <li key={r.id}>{r.name} · {r.usn} · {r.section} · {r.state === "approved" ? "Approved" : `Rejected: ${r.reason}`} · asked {when.format(r.created_at)}</li>)}</ul>
    </section>}
  </Chrome>;
}
