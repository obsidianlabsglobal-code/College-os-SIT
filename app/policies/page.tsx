import { PageHeader } from "../page-header";
import { Chrome } from "../chrome";
import { ActionForm } from "../forms";
import { planningAction } from "../actions/planning";
import { account, scope, workspaceQuery } from "../../lib/scope";
import { policyVersions, publishedPolicies } from "../../lib/policies";

const kindLabel = { general: "General", attendance: "Attendance", service: "Office service", integrity: "Academic integrity" };

export default async function Policies({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [params, user] = await Promise.all([searchParams, account()]);
  const current = await scope(params.institution, params.role);
  const [published, versions] = await Promise.all([publishedPolicies(current), policyVersions(current)]);
  const query = workspaceQuery(current);
  const when = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" });
  const drafts = versions.filter(v => v.state === "draft");
  return <Chrome user={user} current={current} section="/policies">
    <PageHeader title="Policies and services" parent={{ href: `/?${query}`, label: "Workspace" }}
      context="Approved institutional policies and office services. Each shows the version in force and when it was approved." />
    {current.role === "principal" && drafts.length > 0 && <section className="panel stack" aria-labelledby="decide-title">
      <h2 id="decide-title">Awaiting your approval</h2>
      {drafts.map(d => <article key={`${d.policy_id}:${d.version}`} aria-label={`${d.title} version ${d.version}`} className="stack">
        <h3>{d.title} · version {d.version}</h3>
        <p className="meta">{kindLabel[d.kind]} · drafted by {d.drafted_by}{d.attendance_threshold !== null && ` · minimum attendance ${d.attendance_threshold}%`}</p>
        <p style={{ whiteSpace: "pre-wrap" }}>{d.body}</p>
        <ActionForm action={planningAction} context={current} operation="policy-decide" label="Record policy decision">
          <input type="hidden" name="policy" value={d.policy_id} /><input type="hidden" name="version" value={d.version} />
          <label>Decision<select name="decision" required defaultValue=""><option value="" disabled>Choose</option>
            <option value="approve">Approve and publish</option><option value="reject">Reject</option></select></label>
          <label>Reason<input name="reason" required maxLength={500} /></label>
        </ActionForm>
      </article>)}
    </section>}
    {current.role === "admin" && <section className="panel stack" aria-labelledby="draft-title">
      <h2 id="draft-title">Draft a policy or a new version</h2>
      <p className="meta">The principal approves each version before it is published.</p>
      <ActionForm action={planningAction} context={current} operation="policy-draft" label="Save draft for approval">
        <label>Existing policy (leave empty for a new one)<select name="policy" defaultValue=""><option value="">New policy</option>
          {published.map(p => <option key={p.id} value={p.id}>{p.title} (v{p.version})</option>)}</select></label>
        <label>Title (new policy)<input name="title" maxLength={160} /></label>
        <label>Type (new policy)<select name="kind" defaultValue="general">{Object.entries(kindLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Audience (new policy)<select name="audience" defaultValue="everyone"><option value="everyone">Everyone</option><option value="staff">Staff</option><option value="students">Students</option></select></label>
        <label>Minimum attendance % (attendance policies)<input name="threshold" type="number" min={1} max={100} /></label>
        <label>Text<textarea name="body" required maxLength={20000} rows={6} /></label>
      </ActionForm>
      {versions.length > 0 && <ul className="items">{versions.map(v => <li key={`${v.policy_id}:${v.version}`} className="meta">
        {v.title} v{v.version} · {{ draft: "Awaiting principal", approved: "Approved", rejected: "Rejected" }[v.state]}{v.decision_reason && ` · ${v.decision_reason}`}</li>)}</ul>}
    </section>}
    <section className="panel stack" aria-labelledby="published-title">
      <h2 id="published-title">In force</h2>
      {published.length ? published.map(p => <article key={p.id} aria-label={p.title} className="stack">
        <div className="row spread"><h3>{p.title}</h3><span className="tag">{kindLabel[p.kind]} · v{p.version}</span></div>
        <p className="meta">Approved {when.format(p.approved_at)}{p.attendance_threshold !== null && ` · minimum attendance ${p.attendance_threshold}%`}</p>
        <p style={{ whiteSpace: "pre-wrap" }}>{p.body}</p>
      </article>) : <p>No policies are published yet.</p>}
    </section>
  </Chrome>;
}
