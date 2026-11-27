import { notFound } from "next/navigation";
import { PageHeader } from "../page-header";
import { Chrome } from "../chrome";
import { account, scope, workspaceQuery } from "../../lib/scope";
import { thresholdScenario } from "../../lib/department";

export default async function Decisions({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [params, user] = await Promise.all([searchParams, account()]);
  const current = await scope(params.institution, params.role);
  if (current.role !== "principal") notFound();
  const proposed = Number(params.threshold ?? 75);
  const rows = await thresholdScenario(current, proposed) ?? [];
  const query = workspaceQuery(current);
  const current_ = rows[0]?.current ?? null;
  return <Chrome user={user} current={current} section="/decisions">
    <PageHeader title="Decision simulation" parent={{ href: `/?${query}`, label: "Workspace" }}
      context="Compare a proposed attendance minimum with the approved policy before deciding. Nothing here changes any record." />
    <section className="panel stack" aria-labelledby="scenario-title">
      <h2 id="scenario-title">Attendance minimum scenario</h2>
      <p className="meta">Assumptions: each student’s rate so far from each class’s latest attendance record; no future classes, leave or exceptions. {current_ === null ? "No attendance policy is approved yet." : `The approved minimum is ${current_}%.`}</p>
      <form method="get" className="row" aria-label="Scenario">
        {[...new URLSearchParams(query)].map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <label>Proposed minimum (%)<input name="threshold" type="number" min={1} max={100} defaultValue={proposed} required /></label>
        <button className="button secondary">Compare</button>
      </form>
      {rows.length ? <div className="table-scroll" role="region" aria-label="Scenario results" tabIndex={0}><table>
        <thead><tr><th scope="col">Course · section</th><th scope="col">Students with records</th><th scope="col">Below approved</th><th scope="col">Below proposed ({proposed}%)</th></tr></thead>
        <tbody>{rows.map(r => <tr key={`${r.course}|${r.section}`}><th scope="row">{r.course} · {r.section}</th><td>{r.measured}</td>
          <td>{r.below_current ?? "—"}</td><td>{r.below_proposed}</td></tr>)}</tbody>
      </table></div> : <p>No attendance has been recorded yet.</p>}
    </section>
  </Chrome>;
}
