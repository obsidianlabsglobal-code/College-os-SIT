import { PageHeader } from "../page-header";
import { Chrome } from "../chrome";
import { ActionForm } from "../forms";
import { planningAction } from "../actions/planning";
import { account, scope, workspaceQuery, workspaces } from "../../lib/scope";
import { activeFaculty, examIssues, examOptions, exams } from "../../lib/exams";

const stateLabel = { draft: "Draft", published: "Published", cancelled: "Cancelled" };

export default async function Exams({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [params, user] = await Promise.all([searchParams, account()]);
  const current = await scope(params.institution, params.role);
  const timezone = (await workspaces(user.id)).find(w => w.id === current.institution && w.role === current.role)?.timezone ?? "UTC";
  const [rows, options, active] = await Promise.all([exams(current), examOptions(current), activeFaculty(current)]);
  const issues = current.role === "admin" || current.role === "principal" ? examIssues(rows, active) : [];
  const query = workspaceQuery(current);
  const when = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: timezone });
  const time = new Intl.DateTimeFormat("en-IN", { timeStyle: "short", timeZone: timezone });
  return <Chrome user={user} current={current} section="/exams">
    <PageHeader title="Examinations" parent={{ href: `/?${query}`, label: "Workspace" }}
      context={current.role === "admin" ? `Draft sittings with a room and invigilator, then publish. Times are in ${timezone}.`
        : "Published internal and external sittings for your courses and duties. External sittings cite their official source."} />
    {(current.role === "admin" || current.role === "principal") && <section className="panel" aria-labelledby="issues-title">
      <h2 id="issues-title">Unresolved operational issues</h2>
      {issues.length ? <ul className="items">{issues.map(({ exam, issue }) => <li key={exam.id + issue}><strong>{exam.course} · {exam.title}</strong> · {when.format(exam.start)} — {issue}</li>)}</ul>
        : <p>No unresolved issues on upcoming published sittings.</p>}
    </section>}
    {options && <section className="panel stack" aria-labelledby="draft-title">
      <h2 id="draft-title">Draft a sitting</h2>
      <ActionForm action={planningAction} context={current} operation="exam-draft" label="Save draft sitting">
        <label>Course and section<select name="offering" required defaultValue=""><option value="" disabled>Choose</option>
          {options.offerings.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
        <label>Type<select name="kind" defaultValue="internal"><option value="internal">Internal (CIE)</option><option value="external">External (SEE)</option></select></label>
        <label>Title<input name="title" required maxLength={160} /></label>
        <label>Starts<input name="start" type="datetime-local" required /></label>
        <label>Ends<input name="end" type="datetime-local" required /></label>
        <label>Room<select name="room" required defaultValue=""><option value="" disabled>Choose</option>{options.rooms.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
        <label>Invigilator<select name="invigilator" required defaultValue=""><option value="" disabled>Choose</option>{options.faculty.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
        <label>Official source (required for external)<input name="source" maxLength={300} /></label>
      </ActionForm>
    </section>}
    <section className="panel stack" aria-labelledby="sittings-title">
      <h2 id="sittings-title">Sittings</h2>
      {rows.length ? <ul className="items">{rows.map(e => <li key={e.id}><article aria-label={`${e.course} ${e.title}`} className="stack">
        <div className="row spread"><h3>{e.course} · {e.title}</h3><span className={e.state === "draft" ? "tag tag-attention" : "tag"}>{e.kind === "external" ? "External" : "Internal"} · {stateLabel[e.state]}</span></div>
        <p className="meta">{when.format(e.start)} – {time.format(e.finish)} · {e.room} · {e.section} · Invigilator {e.invigilator}
          {e.invigilator_id === current.account && " (your duty)"}</p>
        {e.source && <p className="meta">Source: {e.source}</p>}
        {e.change_reason && <p className="meta">Cancelled: {e.change_reason}</p>}
        {options && e.state === "draft" && <ActionForm action={planningAction} context={current} operation="exam-publish" label="Publish sitting">
          <input type="hidden" name="exam" value={e.id} /><input type="hidden" name="revision" value={e.revision} /></ActionForm>}
        {options && e.state !== "cancelled" && <details><summary>Cancel this sitting</summary>
          <ActionForm action={planningAction} context={current} operation="exam-cancel" label="Cancel sitting" secondary>
            <input type="hidden" name="exam" value={e.id} /><label>Reason<input name="reason" required maxLength={500} /></label></ActionForm></details>}
      </article></li>)}</ul> : <p>No examination sittings.</p>}
    </section>
  </Chrome>;
}
