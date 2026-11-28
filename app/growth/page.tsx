import { notFound } from "next/navigation";
import { PageHeader } from "../page-header";
import { Chrome } from "../chrome";
import { ActionForm } from "../forms";
import { planningAction } from "../actions/planning";
import { account, scope, workspaceQuery } from "../../lib/scope";
import { developmentRecords, researchProjects, teachingDepartments } from "../../lib/faculty-records";

const devState = { submitted: "Awaiting verification", verified: "Verified", returned: "Returned" };
const projectState = { proposed: "Awaiting approval", approved: "Approved", returned: "Returned", completed: "Completed" };

export default async function Growth({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [params, user] = await Promise.all([searchParams, account()]);
  const current = await scope(params.institution, params.role);
  if (!["faculty", "hod", "principal"].includes(current.role)) notFound();
  const [records, projects, departments] = await Promise.all([developmentRecords(current), researchProjects(current), teachingDepartments(current)]);
  const query = workspaceQuery(current);
  const verifiedHours = records.filter(r => r.state === "verified").reduce((n, r) => n + r.hours, 0);
  return <Chrome user={user} current={current} section="/growth">
    <PageHeader title="Development and research" parent={{ href: `/?${query}`, label: "Workspace" }}
      context={current.role === "principal" ? "Approved research projects that departments have disclosed to the institution."
        : "Professional development records verified by the department head, and departmental research projects with milestones."} />
    {current.role !== "principal" && <section className="panel stack" aria-labelledby="dev-title">
      <h2 id="dev-title">Professional development</h2>
      <p className="meta">{current.role === "hod" ? "Records from teachers in your departments." : "Your records."} Verified hours: {verifiedHours}</p>
      {current.role === "faculty" && departments.length > 0 && <details><summary>Record an activity</summary>
        <ActionForm action={planningAction} context={current} operation="dev-add" label="Send for verification">
          <label>Department<select name="department" required defaultValue={departments[0].id}>{departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
          <label>Activity<input name="title" required maxLength={160} /></label>
          <label>Completed on<input name="completed" type="date" required /></label>
          <label>Hours<input name="hours" type="number" min={0.5} max={500} step={0.5} required /></label>
          <label>Evidence<input name="evidence" required maxLength={1000} /></label>
        </ActionForm></details>}
      {records.length ? <ul className="items">{records.map(r => <li key={r.id}><article aria-label={r.title} className="stack">
        <div className="row spread"><h3>{r.title}</h3><span className={r.state === "submitted" ? "tag tag-attention" : "tag"}>{devState[r.state]}</span></div>
        <p className="meta">{r.faculty} · {r.department} · {r.completed_on} · {r.hours} h · {r.evidence}{r.decision_reason && ` · ${r.decision_reason}`}</p>
        {current.role === "hod" && r.state === "submitted" && <ActionForm action={planningAction} context={current} operation="dev-decide" label="Record verification">
          <input type="hidden" name="record" value={r.id} />
          <label>Decision<select name="decision" required defaultValue=""><option value="" disabled>Choose</option><option value="verify">Verify</option><option value="return">Return</option></select></label>
          <label>Reason<input name="reason" required maxLength={500} /></label></ActionForm>}
      </article></li>)}</ul> : <p>No development records.</p>}
    </section>}
    <section className="panel stack" aria-labelledby="research-title">
      <h2 id="research-title">Research projects</h2>
      {current.role === "faculty" && departments.length > 0 && <details><summary>Propose a project</summary>
        <ActionForm action={planningAction} context={current} operation="research-propose" label="Send proposal">
          <label>Department<select name="department" required defaultValue={departments[0].id}>{departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
          <label>Title<input name="title" required maxLength={200} /></label>
          <label>Summary<textarea name="summary" required maxLength={2000} /></label>
        </ActionForm></details>}
      {projects.length ? <ul className="items">{projects.map(p => <li key={p.id}><article aria-label={p.title} className="stack">
        <div className="row spread"><h3>{p.title}</h3><span className={p.state === "proposed" ? "tag tag-attention" : "tag"}>{projectState[p.state]}</span></div>
        <p className="meta">{p.department} · Lead {p.lead}{p.disclosure === "institution" && " · Disclosed to the institution"}{p.decision_reason && ` · ${p.decision_reason}`}</p>
        {current.role !== "principal" && <p>{p.summary}</p>}
        {p.milestones.length > 0 && <ul className="items">{p.milestones.map(m => <li key={m.id}>
          <p>{m.title} · due {m.due_on} · {m.done_at ? `done — ${m.evidence}` : "open"}</p>
          {p.lead_id === current.account && !m.done_at && p.state === "approved" && <ActionForm action={planningAction} context={current} operation="research-done" label="Mark milestone done" secondary>
            <input type="hidden" name="milestone" value={m.id} /><label>Evidence<input name="evidence" required maxLength={1000} /></label></ActionForm>}
        </li>)}</ul>}
        {p.lead_id === current.account && p.state === "approved" && <details><summary>Add a milestone</summary>
          <ActionForm action={planningAction} context={current} operation="research-milestone" label="Add milestone">
            <input type="hidden" name="project" value={p.id} />
            <label>Milestone<input name="title" required maxLength={160} /></label><label>Due<input name="due" type="date" required /></label></ActionForm></details>}
        {current.role === "hod" && p.state === "proposed" && <ActionForm action={planningAction} context={current} operation="research-decide" label="Record project decision">
          <input type="hidden" name="project" value={p.id} />
          <label>Decision<select name="decision" required defaultValue=""><option value="" disabled>Choose</option><option value="approve">Approve</option><option value="return">Return</option></select></label>
          <label>Disclosure<select name="disclosure" defaultValue="department"><option value="department">Department only</option><option value="institution">Disclose to the institution</option></select></label>
          <label>Reason<input name="reason" required maxLength={500} /></label></ActionForm>}
      </article></li>)}</ul> : <p>No research projects.</p>}
    </section>
  </Chrome>;
}
