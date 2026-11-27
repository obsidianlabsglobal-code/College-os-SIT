import { PageHeader } from "../page-header";
import { notFound } from "next/navigation";
import { account, scope, workspaceQuery } from "../../lib/scope";
import Link from "next/link";
import { requests, requestStaff, type QueueView } from "../../lib/connected";
import { Chrome } from "../chrome";
import { ActionForm } from "../forms";
import { connected } from "../actions/connected";

const statuses: Record<string,string> = { submitted: "Submitted", in_progress: "In progress", resolved: "Resolved", declined: "Declined" };

const views: Record<QueueView,string> = { mine: "Assigned to me", unassigned: "Unassigned", all: "All requests" };

export default async function Requests({ searchParams }: { searchParams: Promise<{ institution?: string; role?: string; view?: string }> }) {
  const [selection,user] = await Promise.all([searchParams,account()]);
  const current = await scope(selection.institution,selection.role);
  if (current.role !== "admin" && current.role !== "student") notFound();
  const view: QueueView = selection.view === "mine" || selection.view === "unassigned" ? selection.view : "all";
  const [records, staff] = await Promise.all([requests(current, view), requestStaff(current)]);
  const query = workspaceQuery(current);
  return <Chrome user={user} current={current} section="/requests">
    <PageHeader title="Service requests" parent={{ href: `/?${workspaceQuery(current)}`, label: "Workspace" }} />
    <div className={current.role === "student" ? "grid" : "stack"}>
      <section className="panel stack">
        <h2>{current.role === "admin" ? "Student request queue" : "Your requests"}</h2>
        {current.role === "admin" && <nav className="row" aria-label="Queue view">{(Object.keys(views) as QueueView[]).map(key =>
          <Link key={key} href={`/requests?${query}&view=${key}`} aria-current={key === view ? "page" : undefined}
            className={key === view ? "button" : "button secondary"}>{views[key]}</Link>)}</nav>}
        {!records.length && <p>{view === "mine" ? "No requests are assigned to you." : view === "unassigned" ? "Every open request has an owner." : "No requests yet."}</p>}
        {records.map(record => <article key={record.id} className="stack">
          <div><h3>Enrollment letter{current.role === "admin" ? ` · ${record.student}` : ""}</h3><p className="meta">Reference {record.id}</p><span className="tag">{statuses[record.status]}</span></div>
          <p className="prose-text">{record.description}</p>
          {current.role === "admin" && <p className="meta">{record.assignee ? `Assigned to ${record.assignee}` : "Unassigned"}</p>}
          {record.handler && <p className="meta">Handled by {record.handler}</p>}
          {current.role === "admin" && (record.status === "submitted" || record.status === "in_progress") && staff.length > 0 &&
            <ActionForm action={connected} context={current} operation="assign-request" label={record.assigned_to ? "Reassign" : "Assign"} secondary>
              <input name="id" type="hidden" value={record.id} />
              <label>Owner<select name="assignee" defaultValue={record.assigned_to ?? current.account}>{staff.map(person =>
                <option key={person.id} value={person.id}>{person.id === current.account ? `${person.name} (you)` : person.name}</option>)}</select></label>
            </ActionForm>}
          {record.outcome && <p className="prose-text">{record.outcome}</p>}
          {current.role === "admin" && record.status === "submitted" && (!record.assigned_to || record.assigned_to === current.account) && <ActionForm action={connected} context={current} operation="advance-request" label="Start review">
            <input name="id" type="hidden" value={record.id} /><input name="status" type="hidden" value="in_progress" />
          </ActionForm>}
          {current.role === "admin" && record.status === "in_progress" && (!record.assigned_to || record.assigned_to === current.account) && <ActionForm action={connected} context={current} operation="advance-request" label="Record outcome">
            <input name="id" type="hidden" value={record.id} />
            <label>Decision<select name="status"><option value="resolved">Resolve</option><option value="declined">Decline</option></select></label>
            <label>Outcome<textarea name="outcome" maxLength={4000} required /></label>
          </ActionForm>}
        </article>)}
      </section>
      {current.role === "student" && <section className="panel">
        <h2>Request an enrollment letter</h2>
        <ActionForm action={connected} context={current} operation="create-request" label="Submit request">
          <label>Purpose and delivery needs<textarea name="description" maxLength={4000} required /></label>
        </ActionForm>
      </section>}
    </div>
  </Chrome>;
}
