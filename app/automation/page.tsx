import { notFound } from "next/navigation";
import { PageHeader } from "../page-header";
import { Chrome } from "../chrome";
import { ActionForm } from "../forms";
import { automation } from "../actions/automation";
import { automationOverview } from "../../lib/automation";
import { account, scope, workspaceQuery } from "../../lib/scope";
import { SegmentedBar } from "../experience/segmented-bar";
import styles from "./automation.module.css";

const authority: Record<string, string> = { L0: "Read only", L1: "Drafts only", L2: "Runs after confirmation", L3: "Pre-authorized, low risk" };

export default async function AutomationCentre({ searchParams }: { searchParams: Promise<{ institution?: string; role?: string }> }) {
  const [selection, user] = await Promise.all([searchParams, account()]);
  const current = await scope(selection.institution, selection.role);
  const overview = await automationOverview(current);
  if (!overview) notFound();
  const when = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
  const live = overview.workerLive;
  const handled = overview.rules.reduce((sum, rule) => sum + rule.succeeded, 0);
  const notified = overview.rules.reduce((sum, rule) => sum + rule.notified, 0);
  const waiting = overview.rules.reduce((sum, rule) => sum + rule.waiting, 0);
  return <Chrome user={user} current={current} section="/automation">
    <PageHeader title="Automation Centre" parent={{ href: `/?${workspaceQuery(current)}`, label: "Workspace" }} />
    <p className={styles.worker} data-live={live || undefined} role="status">
      <strong>{live ? "Worker running" : "Worker not running"}</strong>
      {live ? ` · last check-in ${when.format(overview.workerSeenAt!)}` : overview.workerSeenAt
        ? ` · last seen ${when.format(overview.workerSeenAt)}. New work is queued safely and runs when the worker restarts.`
        : " · no worker has started yet. Automations are queued, not executed."}
    </p>
    <dl className="metrics" aria-label="Automation totals for this institution">
      <div><dt>Cases handled automatically</dt><dd>{handled}</dd></div>
      <div><dt>Notifications delivered</dt><dd>{notified}</dd></div>
      <div><dt>Waiting to run</dt><dd>{waiting}</dd></div>
      <div><dt>Needs attention</dt><dd>{overview.failures.length}</dd></div>
    </dl>
    <section className="panel stack" aria-labelledby="rules-title">
      <h2 id="rules-title">Rules</h2>
      <p className="meta">Each rule re-checks current records before acting, writes once per event, and records its outcome. Time saved is reported only after a measured manual baseline exists.</p>
      <ul className={styles.rules}>{overview.rules.map(rule => {
        const total = rule.succeeded + rule.skipped + rule.waiting + rule.dead;
        return <li key={rule.key} className={styles.rule}>
          <div className={styles.ruleHead}>
            <h3>{rule.title}</h3>
            <span className="tag">{rule.paused ? "Paused" : "Active"}</span>
          </div>
          <p className="meta">When <code>{rule.event_type}</code> · {rule.authority} {authority[rule.authority]} · {rule.last_run ? `last run ${when.format(rule.last_run)}` : "not run yet"}</p>
          <SegmentedBar label={`${rule.title} runs`} total={total} parts={[
            { label: "completed", value: rule.succeeded, tone: 1 },
            { label: "skipped (no longer applicable or paused)", value: rule.skipped, tone: 3 },
            { label: "waiting", value: rule.waiting, tone: 2 }]} rest="failed" />
          <p className="meta">{rule.baseline_minutes === null ? "Manual baseline: not measured yet" : `Manual baseline: ${rule.baseline_minutes} min per case`}</p>
          {current.role === "admin" && <ActionForm action={automation} context={current} operation={rule.paused ? "resume-rule" : "pause-rule"}
            label={rule.paused ? "Resume rule" : "Pause rule"} secondary>
            <input type="hidden" name="rule" value={rule.key} />
          </ActionForm>}
        </li>;
      })}</ul>
    </section>
    <section className="panel stack" aria-labelledby="failures-title">
      <h2 id="failures-title">Needs attention</h2>
      {overview.failures.length ? <ul className={styles.rules}>{overview.failures.map(job => <li key={job.id} className={styles.rule}>
        <p><strong>Job {job.id}</strong> · {job.rule_key} · stopped after {job.attempt} attempts · {job.last_error ?? "unknown error"}</p>
        {current.role === "admin" && <ActionForm action={automation} context={current} operation="retry-job" label="Retry" secondary>
          <input type="hidden" name="id" value={job.id} />
        </ActionForm>}
      </li>)}</ul> : <p>No failed jobs.</p>}
    </section>
  </Chrome>;
}
