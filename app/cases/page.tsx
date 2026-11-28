import Link from "next/link";
import { PageHeader } from "../page-header";
import { Chrome } from "../chrome";
import { ActionForm } from "../forms";
import { caseAction } from "../actions/cases";
import { account, scope, workspaceQuery } from "../../lib/scope";
import { caseKinds, officeKinds, caseStaff, cases, caseSummary, integrityPolicy, studentDepartments, supportStudents, type CaseKind } from "../../lib/cases";
import { assessmentHistory } from "../../lib/assignments";

const stateLabel = { open: "Open", in_progress: "In progress", resolved: "Resolved", declined: "Declined" };
const kindLabel: Record<CaseKind, string> = { support: "Student support", grievance: "Grievances", facility: "Repairs", integrity: "Integrity appeals", department: "Department requests", representation: "Student representation", letter: "Letters" };
const about: Record<CaseKind, string> = {
  support: "Academic support coordinated by the department head. Students do not see these cases.",
  grievance: "Confidential complaints to the administrative office. Grievances open for more than 7 days are visible to the principal by title only.",
  facility: "Repairs reported to the office. Whoever reported a repair can reopen it within 14 days if it is not fixed.",
  integrity: "Confidential appeals about an assessment, tied to the published integrity policy version. Reviewed in the course’s department.",
  department: "Requests to a department where you study, routed by its head to an accountable teacher.",
  representation: "Issues raised for students generally. Every current student can read them and add support; the office owns the response.",
  letter: "Leave and permission letters submitted to the office. Only you and the office can read them; draft one from Letter drafts.",
};

export default async function Cases({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [params, user] = await Promise.all([searchParams, account()]);
  const current = await scope(params.institution, params.role);
  const kinds = caseKinds[current.role];
  const kind = kinds.find(k => k === params.kind) ?? kinds[0];
  const [rows, summary, staff, students, departments, policy, assessments] = await Promise.all([cases(current, kind), caseSummary(current, kind),
    caseStaff(current, kind), supportStudents(current), studentDepartments(current), integrityPolicy(current), assessmentHistory(current)]);
  const query = workspaceQuery(current);
  const when = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
  const coordinator = officeKinds.includes(kind) ? current.role === "admin" : current.role === "hod";
  const canOpen = kind === "letter" ? false : kind === "facility" ? current.role !== "principal" : kind === "support" ? (current.role === "hod" || current.role === "faculty") && students.length > 0
    : current.role === "student" && (kind !== "integrity" || !!policy) && (kind !== "department" || departments.length > 0);
  return <Chrome user={user} current={current} section="/cases">
    <PageHeader title="Cases and requests" parent={{ href: `/?${query}`, label: "Workspace" }} context={about[kind]} />
    {kinds.length > 1 && <nav aria-label="Case type" className="row">{kinds.map(k => <Link key={k} href={`/cases?${query}&kind=${k}`}
      aria-current={k === kind ? "page" : undefined} className={k === kind ? "button" : "button secondary"}>{kindLabel[k]}</Link>)}</nav>}
    {current.role !== "student" && <section className="panel" aria-label="Case measures">
      <dl className="metrics">
        <div><dt>Open</dt><dd>{summary.open}</dd></div><div><dt>Without an owner</dt><dd>{summary.unassigned}</dd></div>
        <div><dt>Closed · 90 days</dt><dd>{summary.closed_90d}</dd></div>
        <div><dt>Median time to close</dt><dd>{summary.median_hours === null ? "—" : `${summary.median_hours} h`}</dd></div>
      </dl>
    </section>}
    {canOpen && <section className="panel stack" aria-labelledby="open-title">
      <h2 id="open-title">{{ support: "Open a support case", grievance: "Raise a grievance", facility: "Report a repair", integrity: "Appeal an integrity decision", department: "Request from a department", representation: "Raise an issue for students", letter: "" }[kind]}</h2>
      {kind === "integrity" && policy && <p className="meta">Your appeal will cite {policy.title}, version {policy.version}.</p>}
      <ActionForm action={caseAction} context={current} operation="open" label={{ support: "Open case", grievance: "Submit grievance", facility: "Report repair", integrity: "Submit appeal", department: "Send request", representation: "Raise issue", letter: "" }[kind]}>
        <input type="hidden" name="kind" value={kind} />
        {kind === "support" && <label>Student<select name="subject" required defaultValue=""><option value="" disabled>Choose a student</option>
          {students.map(s => <option key={`${s.id}|${s.department}`} value={`${s.id}|${s.department}`}>{s.name} · {s.department_name}</option>)}</select></label>}
        {kind === "department" && <label>Department<select name="department" required defaultValue=""><option value="" disabled>Choose</option>
          {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>}
        {kind === "integrity" && <label>Assessment<select name="assignment" required defaultValue=""><option value="" disabled>Choose</option>
          {assessments.map(a => <option key={a.id} value={a.id}>{a.course} · {a.title}</option>)}</select></label>}
        <label>Subject<input name="title" required maxLength={160} /></label>
        <label>Details<textarea name="body" required maxLength={4000} /></label>
      </ActionForm>
    </section>}
    <section className="panel stack" aria-labelledby="cases-title">
      <h2 id="cases-title">{kindLabel[kind]}</h2>
      {rows.length ? <ul className="items">{rows.map(row => <li key={row.id}>
        <article aria-label={row.title} className="stack">
          <div className="row spread"><h3>{row.title}</h3><span className={row.state === "open" ? "tag tag-attention" : "tag"}>{stateLabel[row.state]}{row.escalated && " · escalated"}{row.reopened > 0 && ` · reopened ×${row.reopened}`}</span></div>
          <p className="meta">{current.role !== "student" && row.opened_by !== current.account && row.opener !== row.subject ? `${row.subject} · ` : ""}{current.role !== "student" ? `Opened by ${row.opener} · ` : ""}{row.department && `${row.department} · `}Opened {when.format(row.created_at)}
            {current.role !== "student" && ` · ${row.assignee ? `Owner ${row.assignee}` : "No owner"}`}</p>
          {(row.policy || row.assignment) && <p className="meta">{row.assignment && `Assessment: ${row.assignment}`}{row.policy && ` · Policy: ${row.policy}`}</p>}
          {current.role !== "principal" && <p style={kind === "letter" ? { whiteSpace: "pre-wrap" } : undefined}>{row.body}</p>}
          {row.outcome && <p><strong>Outcome:</strong> {row.outcome}</p>}
          {kind === "representation" && <p className="meta">{row.supporters} {row.supporters === 1 ? "student supports" : "students support"} this issue</p>}
          {kind === "representation" && current.role === "student" && !row.supported && (row.state === "open" || row.state === "in_progress") &&
            <ActionForm action={caseAction} context={current} operation="support" label="Add my support" secondary><input type="hidden" name="case" value={row.id} /></ActionForm>}
          {row.notes.length > 0 && <ul className="items">{row.notes.map((n, i) => <li key={i} className="meta">{n.author} · {when.format(new Date(n.created_at))}: {n.body}</li>)}</ul>}
          {coordinator && (row.state === "open" || row.state === "in_progress") && <ActionForm action={caseAction} context={current} operation="assign" label={row.assignee ? "Reassign" : "Assign"} secondary>
            <input type="hidden" name="case" value={row.id} />
            <label>Owner<select name="assignee" required defaultValue={row.assigned_to ?? ""}><option value="" disabled>Choose</option>
              {staff.filter(p => officeKinds.includes(kind) || p.department === row.department_id).map(p => <option key={`${p.id}${p.department}`} value={p.id}>{p.name}</option>)}</select></label>
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
          {kind === "facility" && row.state === "resolved" && row.opened_by === current.account && <details><summary>Not fixed? Reopen</summary>
            <ActionForm action={caseAction} context={current} operation="reopen" label="Reopen repair">
              <input type="hidden" name="case" value={row.id} /><label>What is still wrong<textarea name="reason" required maxLength={2000} /></label></ActionForm></details>}
        </article>
      </li>)}</ul> : <p>No cases.</p>}
    </section>
  </Chrome>;
}
