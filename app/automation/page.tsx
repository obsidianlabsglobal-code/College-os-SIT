import { notFound } from "next/navigation";
import { PageHeader } from "../page-header";
import { Chrome } from "../chrome";
import { ActionForm } from "../forms";
import { automation } from "../actions/automation";
import { automationOverview } from "../../lib/automation";
import { account, scope, workspaceQuery } from "../../lib/scope";
import { SegmentedBar } from "../experience/segmented-bar";
import styles from "./automation.module.css";

const authority: Record<string, string> = { L0: "Read only", L1: "Prepares drafts only", L2: "Runs after confirmation", L3: "Pre-authorized, low risk" };
const workflows: Record<string, string> = { attendance: "Attendance communication", assignments: "Assignment coordination",
  results: "Results communication", requests: "Administrative requests", timetable: "Timetable change coordination" };
const stateLabel: Record<string, string> = { active: "Active", paused: "Paused · work is held", disabled: "Disabled · new events ignored" };

export default async function AutomationCentre({ searchParams }: { searchParams: Promise<{ institution?: string; role?: string }> }) {
  const [selection, user] = await Promise.all([searchParams, account()]);
  const current = await scope(selection.institution, selection.role);
  const overview = await automationOverview(current);
  if (!overview) notFound();
  const when = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
  const { health } = overview;
  const wait = health.oldest_wait_seconds;
  const groups = Object.keys(workflows).map(key => [key, overview.rules.filter(rule => rule.workflow === key)] as const);
  return <Chrome user={user} current={current} section="/automation">
    <PageHeader title="Automation Centre" parent={{ href: `/?${workspaceQuery(current)}`, label: "Workspace" }} />
    <p className={styles.worker} data-live={overview.workerLive || undefined} role="status">
      <strong>{overview.workerLive ? `Worker running (${overview.workersLive})` : "Worker not running"}</strong>
      {overview.workerLive ? ` · last check-in ${when.format(overview.workerSeenAt!)}` : overview.workerSeenAt
        ? ` · last seen ${when.format(overview.workerSeenAt)}. New work is queued safely and runs when a worker restarts.`
        : " · no worker has started yet. Automations are queued, not executed."}
    </p>
    <dl className="metrics" aria-label="Job health for this institution">
      <div><dt>Completed in 24 hours</dt><dd>{health.succeeded_24h}</dd></div>
      <div><dt>Oldest waiting job</dt><dd>{wait === null ? "None" : wait < 120 ? `${wait} s` : `${Math.round(wait / 60)} min`}</dd></div>
      <div><dt>Failed in 24 hours</dt><dd>{health.failed_24h}</dd></div>
      <div><dt>Needs attention</dt><dd>{overview.failures.length}</dd></div>
    </dl>

    <section className="panel stack" aria-labelledby="effort-title">
      <h2 id="effort-title">Manual effort</h2>
      <p className="meta">Reduction = (baseline − remaining human minutes per case) ÷ baseline. Remaining time includes review, corrections, exceptions and recovery. Synthetic rehearsals are engineering estimates, not pilot results.</p>
      {overview.effort.length ? <div className="table-scroll" role="region" aria-label="Effort evidence" tabIndex={0}><table>
        <thead><tr><th scope="col">Workflow</th><th scope="col">Evidence</th><th scope="col">Baseline min/case</th><th scope="col">Remaining min/case</th><th scope="col">Reduction</th></tr></thead>
        <tbody>{overview.effort.map(row => <tr key={row.workflow + row.quality}>
          <th scope="row">{workflows[row.workflow]}</th>
          <td><span className="tag">{row.quality === "synthetic" ? "Synthetic rehearsal" : "Measured"}</span></td>
          <td>{row.baseline?.toFixed(1) ?? "—"} <span className="meta">({row.baseline_cases} cases)</span></td>
          <td>{row.post?.toFixed(1) ?? "—"} <span className="meta">({row.post_cases} cases)</span></td>
          <td>{row.reduction === null ? "Not measured" : `${row.reduction}%`}</td>
        </tr>)}</tbody>
      </table></div> : <p>No effort evidence recorded. Institutional baselines stay unmeasured until authorized participants time representative tasks.</p>}
    </section>

    {groups.map(([workflow, rules]) => <section key={workflow} className="panel stack" aria-labelledby={`wf-${workflow}`}>
      <h2 id={`wf-${workflow}`}>{workflows[workflow]}</h2>
      <ul className={styles.rules}>{rules.map(rule => {
        const total = rule.succeeded + rule.skipped + rule.waiting + rule.scheduled + rule.dead + rule.cancelled;
        return <li key={rule.key} className={styles.rule}>
          <div className={styles.ruleHead}>
            <h3>{rule.title}</h3>
            <span className="tag" data-state={rule.state}>{stateLabel[rule.state]}</span>
          </div>
          <p className="meta">When <code>{rule.event_type}</code> · {rule.authority} {authority[rule.authority]} · {rule.last_run ? `last run ${when.format(rule.last_run)}` : "not run yet"}</p>
          <SegmentedBar label={`${rule.title} runs`} total={total} parts={[
            { label: "completed", value: rule.succeeded, tone: 1 },
            { label: "scheduled or waiting", value: rule.scheduled + rule.waiting, tone: 2 },
            { label: "skipped or cancelled", value: rule.skipped + rule.cancelled, tone: 3 }]} rest="failed" />
          {current.role === "admin" && <div className="row">
            {(rule.state === "active" ? ["paused", "disabled"] : rule.state === "paused" ? ["active", "disabled"] : ["active"]).map(next =>
              <ActionForm key={next} action={automation} context={current} operation="rule-state" secondary
                label={next === "active" ? "Resume rule" : next === "paused" ? "Pause rule" : "Disable rule"}
                confirmation={next === "disabled" ? "Disable this rule? Waiting jobs are cancelled and new events are ignored until you resume it." : undefined}>
                <input type="hidden" name="rule" value={rule.key} /><input type="hidden" name="state" value={next} />
              </ActionForm>)}
          </div>}
        </li>;
      })}</ul>
    </section>)}

    <section className="panel stack" aria-labelledby="failures-title">
      <h2 id="failures-title">Needs attention</h2>
      {overview.failures.length ? <ul className={styles.rules}>{overview.failures.map(job => <li key={job.id} className={styles.rule}>
        <p><strong>Job {job.id}</strong> · {job.rule_key} · stopped after {job.attempt} attempts · {job.last_error ?? "unknown error"}</p>
        {current.role === "admin" && <div className="row">
          <ActionForm action={automation} context={current} operation="retry-job" label="Retry" secondary><input type="hidden" name="id" value={job.id} /></ActionForm>
          <ActionForm action={automation} context={current} operation="cancel-job" label="Cancel" secondary><input type="hidden" name="id" value={job.id} /></ActionForm>
        </div>}
      </li>)}</ul> : <p>No failed jobs.</p>}
    </section>
  </Chrome>;
}
