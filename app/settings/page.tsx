import { PageHeader } from "../page-header";
import { Chrome } from "../chrome";
import { ActionForm } from "../forms";
import { planningAction } from "../actions/planning";
import { account, scope, workspaceQuery } from "../../lib/scope";
import { preferences } from "../../lib/preferences";
import { roleKinds } from "../../lib/automation";

const kindLabel: Record<string, string> = { assignment: "New assignments", reminder: "Due-date reminders", result: "Published results", class: "Class changes",
  correction: "Attendance corrections", case: "Cases and requests", attendance: "Attendance to record", request: "Service requests", followup: "Request follow-ups", escalation: "Escalations" };

export default async function Settings({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [params, user] = await Promise.all([searchParams, account()]);
  const current = await scope(params.institution, params.role);
  const saved = await preferences(current);
  return <Chrome user={user} current={current} section="/settings">
    <PageHeader title="Settings" parent={{ href: `/?${workspaceQuery(current)}`, label: "Workspace" }}
      context="Your own choices for this institution. They change what you see, never what others can do." />
    <section className="panel stack" aria-labelledby="settings-title">
      <h2 id="settings-title">Display, discovery and notifications</h2>
      <ActionForm action={planningAction} context={current} operation="preferences-save" label="Save preferences">
        <fieldset><legend>Display</legend>
          <label><input type="checkbox" name="large_text" defaultChecked={saved.large_text} /> Larger text</label>
          <label><input type="checkbox" name="reduced_motion" defaultChecked={saved.reduced_motion} /> Reduce motion</label>
        </fieldset>
        {current.role === "student" && <fieldset><legend>Discovery</legend>
          <label><input type="checkbox" name="discoverable" defaultChecked={saved.discoverable} /> Show my name to classmates in study groups</label>
        </fieldset>}
        {current.role !== "student" && <input type="hidden" name="discoverable" value={saved.discoverable ? "on" : ""} />}
        <fieldset><legend>Mute in-app notifications</legend>
          {roleKinds[current.role].map(kind => <label key={kind}><input type="checkbox" name="muted" value={kind} defaultChecked={saved.muted_kinds.includes(kind)} /> {kindLabel[kind] ?? kind}</label>)}
        </fieldset>
      </ActionForm>
      <p className="meta">Muted notifications are hidden from your inbox; the records themselves are unchanged. Email and text messages are not sent by NEXUS yet.</p>
    </section>
  </Chrome>;
}
