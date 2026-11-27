import { notFound } from "next/navigation";
import { PageHeader } from "../page-header";
import { Chrome } from "../chrome";
import { ActionForm } from "../forms";
import { planningAction } from "../actions/planning";
import { account, scope, workspaceQuery } from "../../lib/scope";
import { actionMeasures, actionOwners, improvementActions } from "../../lib/improvement";

export default async function Improvement({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [params, user] = await Promise.all([searchParams, account()]);
  const current = await scope(params.institution, params.role);
  if (current.role === "student") notFound();
  const [rows, owners] = await Promise.all([improvementActions(current), actionOwners(current)]);
  const measures = actionMeasures(rows);
  const query = workspaceQuery(current);
  const when = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" });
  return <Chrome user={user} current={current} section="/improvement">
    <PageHeader title="Improvement actions" parent={{ href: `/?${query}`, label: "Workspace" }}
      context="Each action has one owner, a measure of success and a due date. Only the owner records progress or closes it." />
    <section className="panel" aria-label="Action measures">
      <dl className="metrics"><div><dt>Open</dt><dd>{measures.open}</dd></div><div><dt>Overdue</dt><dd>{measures.overdue}</dd></div>
        <div><dt>Done</dt><dd>{measures.done}</dd></div><div><dt>Done on time</dt><dd>{measures.onTime}</dd></div></dl>
    </section>
    {owners.length > 0 && <section className="panel stack" aria-labelledby="new-action">
      <h2 id="new-action">{current.role === "principal" ? "New institution action" : "New department action"}</h2>
      <ActionForm action={planningAction} context={current} operation="action-create" label="Create action">
        <label>Action<input name="title" required maxLength={160} /></label>
        <label>How success is measured<input name="measure" required maxLength={500} /></label>
        <label>Owner<select name="owner" required defaultValue=""><option value="" disabled>Choose</option>
          {owners.map(o => <option key={`${o.id}|${o.department ?? ""}`} value={`${o.id}|${o.department ?? ""}`}>{o.label}</option>)}</select></label>
        <label>Due<input name="due" type="date" required /></label>
      </ActionForm>
    </section>}
    <section className="panel stack" aria-labelledby="actions-title">
      <h2 id="actions-title">Actions</h2>
      {rows.length ? <ul className="items">{rows.map(a => <li key={a.id}><article aria-label={a.title} className="stack">
        <div className="row spread"><h3>{a.title}</h3><span className={a.overdue ? "tag tag-attention" : "tag"}>
          {a.state === "open" ? (a.overdue ? "Overdue" : `${a.progress}%`) : a.state === "done" ? "Done" : "Dropped"}</span></div>
        <p className="meta">{a.department ?? "Institution"} · Owner {a.owner} · Due {a.due_on}</p>
        <p>Measure: {a.measure}</p>
        {a.updates.length > 0 && <ul className="items">{a.updates.map((u, n) => <li key={n} className="meta">{when.format(new Date(u.created_at))} · {u.author} · {u.progress}% — {u.note}</li>)}</ul>}
        {a.owner_id === current.account && a.state === "open" && <ActionForm action={planningAction} context={current} operation="action-update" label="Record progress">
          <input type="hidden" name="action" value={a.id} />
          <label>Progress (%)<input name="progress" type="number" min={0} max={100} required defaultValue={a.progress} /></label>
          <label>Update<textarea name="note" required maxLength={1000} /></label>
          <label>Close<select name="close" defaultValue=""><option value="">Keep open</option><option value="done">Mark done</option><option value="dropped">Drop</option></select></label>
        </ActionForm>}
      </article></li>)}</ul> : <p>No improvement actions.</p>}
    </section>
  </Chrome>;
}
