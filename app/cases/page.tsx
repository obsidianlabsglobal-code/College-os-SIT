import { PageHeader } from "../page-header";
import { Chrome } from "../chrome";
import { ActionForm } from "../forms";
import { caseAction } from "../actions/cases";
import { account, scope, workspaceQuery } from "../../lib/scope";
import { caseStaff, cases, caseSummary, supportStudents, type CaseKind } from "../../lib/cases";

const stateLabel = { open: "Open", in_progress: "In progress", resolved: "Resolved", declined: "Declined" };

export default async function Cases({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [params, user] = await Promise.all([searchParams, account()]);
  const current = await scope(params.institution, params.role);
  const kind: CaseKind = current.role === "hod" || current.role === "faculty" ? "support" : "grievance";
  const [rows, summary, staff, students] = await Promise.all([cases(current, kind), caseSummary(current, kind), caseStaff(current, kind), supportStudents(current)]);
  const query = workspaceQuery(current);
  const when = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
  const coordinator = (kind === "support" && current.role === "hod") || (kind === "grievance" && current.role === "admin");
  const title = kind === "support" ? "Student support cases" : current.role === "student" ? "My grievances" : "Student grievances";
  return <Chrome user={user} current={current} section="/cases">
    <PageHeader title={title} parent={{ href: `/?${query}`, label: "Workspace" }}
      context={kind === "support" ? "Academic support coordinated by the department head. Students do not see these cases."
        : current.role === "student" ? "Confidential complaints to the administrative office. Only the office sees what you write; you see the outcome."
        : current.role === "principal" ? `Grievances still open after 7 days are escalated here for visibility. The office keeps the decision.`
        : "Confidential student complaints. Assign an owner; only the owner records the outcome."} />
    {current.role !== "student" && <section className="panel" aria-label="Case measures">
      <dl className="metrics">
        <div><dt>Open</dt><dd>{summary.open}</dd></div><div><dt>Without an owner</dt><dd>{summary.unassigned}</dd></div>
        <div><dt>Closed · 90 days</dt><dd>{summary.closed_90d}</dd></div>
        <div><dt>Median time to close</dt><dd>{summary.median_hours === null ? "—" : `${summary.median_hours} h`}</dd></div>
      </dl>
    </section>}
    {(current.role === "student" || ((current.role === "hod" || current.role === "faculty") && students.length > 0)) && <section className="panel stack" aria-labelledby="open-title">
      <h2 id="open-title">{current.role === "student" ? "Raise a grievance" : "Open a support case"}</h2>
      <ActionForm action={caseAction} context={current} operation="open" label={current.role === "student" ? "Submit grievance" : "Open case"}>
        <input type="hidden" name="kind" value={kind} />
        {kind === "support" && <label>Student<select name="subject" required defaultValue=""><option value="" disabled>Choose a student</option>
          {students.map(s => <option key={`${s.id}|${s.department}`} value={`${s.id}|${s.department}`}>{s.name} · {s.department_name}</option>)}</select></label>}
        <label>Subject<input name="title" required maxLength={160} /></label>
        <label>Details<textarea name="body" required maxLength={4000} /></label>
      </ActionForm>
    </section>}
    <section className="panel stack" aria-labelledby="cases-title">
      <h2 id="cases-title">{kind === "support" ? "Cases" : current.role === "student" ? "Submitted" : "Grievances"}</h2>
      {rows.length ? <ul className="items">{rows.map(row => <li key={row.id}>
        <article aria-label={row.title} className="stack">
          <div className="row spread"><h3>{row.title}</h3><span className={row.state === "open" ? "tag tag-attention" : "tag"}>{stateLabel[row.state]}{row.escalated && " · escalated"}</span></div>
          <p className="meta">{kind === "support" ? `${row.subject} · ${row.department} · ` : current.role !== "student" ? `${row.subject} · ` : ""}Opened {when.format(row.created_at)}
            {current.role !== "student" && ` · ${row.assignee ? `Owner ${row.assignee}` : "No owner"}`}</p>
          {current.role !== "principal" && <p>{row.body}</p>}
          {row.outcome && <p><strong>Outcome:</strong> {row.outcome}</p>}
          {row.notes.length > 0 && <ul className="items">{row.notes.map((n, i) => <li key={i} className="meta">{n.author} · {when.format(new Date(n.created_at))}: {n.body}</li>)}</ul>}
          {coordinator && (row.state === "open" || row.state === "in_progress") && <ActionForm action={caseAction} context={current} operation="assign" label={row.assignee ? "Reassign" : "Assign"} secondary>
            <input type="hidden" name="case" value={row.id} />
            <label>Owner<select name="assignee" required defaultValue={row.assigned_to ?? ""}><option value="" disabled>Choose</option>
              {staff.filter(p => kind === "grievance" || p.department === row.department_id).map(p => <option key={`${p.id}${p.department}`} value={p.id}>{p.name}</option>)}</select></label>
          </ActionForm>}
          {row.assigned_to === current.account && row.state === "open" && <ActionForm action={caseAction} context={current} operation="start" label="Start work" secondary>
            <input type="hidden" name="case" value={row.id} /></ActionForm>}
          {current.role !== "student" && current.role !== "principal" && (row.state === "open" || row.state === "in_progress") && <details><summary>Add a note</summary>
            <ActionForm action={caseAction} context={current} operation="note" label="Save note">
              <input type="hidden" name="case" value={row.id} /><label>Note<textarea name="body" required maxLength={2000} /></label></ActionForm></details>}
          {row.assigned_to === current.account && (row.state === "open" || row.state === "in_progress") && <details><summary>Close this case</summary>
            <ActionForm action={caseAction} context={current} operation="close" label="Record outcome">
              <input type="hidden" name="case" value={row.id} />
              <label>Outcome<select name="outcome" required defaultValue="resolved"><option value="resolved">Resolved</option><option value="declined">Declined</option></select></label>
              <label>Reason<textarea name="reason" required maxLength={1000} /></label>
            </ActionForm></details>}
        </article>
      </li>)}</ul> : <p>No cases.</p>}
    </section>
  </Chrome>;
}
