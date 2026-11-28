import { notFound } from "next/navigation";
import { PageHeader } from "../page-header";
import { Chrome } from "../chrome";
import { ActionForm } from "../forms";
import { planningAction } from "../actions/planning";
import { account, scope, workspaceQuery, workspaces } from "../../lib/scope";
import { meetingInvitees, meetings } from "../../lib/meetings";

export default async function Meetings({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [params, user] = await Promise.all([searchParams, account()]);
  const current = await scope(params.institution, params.role);
  if (current.role === "student") notFound();
  const timezone = (await workspaces(user.id)).find(w => w.id === current.institution && w.role === current.role)?.timezone ?? "UTC";
  const [rows, invitees] = await Promise.all([meetings(current), meetingInvitees(current)]);
  const query = workspaceQuery(current);
  const when = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: timezone });
  return <Chrome user={user} current={current} section="/meetings">
    <PageHeader title="Meetings" parent={{ href: `/?${query}`, label: "Workspace" }}
      context="Meetings you organize or were invited to. The organizer records minutes and assigns actions; each owner closes their own." />
    <section className="panel stack" aria-labelledby="schedule-title">
      <h2 id="schedule-title">Schedule a meeting</h2>
      <ActionForm action={planningAction} context={current} operation="meeting-schedule" label="Schedule meeting">
        <label>Title<input name="title" required maxLength={160} /></label>
        <label>Starts ({timezone})<input name="start" type="datetime-local" required /></label>
        <label>Agenda<textarea name="agenda" required maxLength={4000} /></label>
        <fieldset><legend>Participants</legend>{invitees.map(p => <label key={p.id}><input type="checkbox" name="participants" value={p.id} /> {p.name}</label>)}</fieldset>
      </ActionForm>
    </section>
    <section className="panel stack" aria-labelledby="meetings-title">
      <h2 id="meetings-title">Your meetings</h2>
      {rows.length ? <ul className="items">{rows.map(m => <li key={m.id}><article aria-label={m.title} className="stack">
        <div className="row spread"><h3>{m.title}</h3><span className="tag">{when.format(m.starts_at)}</span></div>
        <p className="meta">Organizer {m.organizer} · {m.participants.map(p => p.name).join(", ")}</p>
        <p style={{ whiteSpace: "pre-wrap" }}>{m.agenda}</p>
        {m.minutes && <><h4>Minutes</h4><p style={{ whiteSpace: "pre-wrap" }}>{m.minutes}</p></>}
        {m.actions.length > 0 && <ul className="items">{m.actions.map(a => <li key={a.id}><div className="row spread">
          <span>{a.title} · {a.owner} · due {a.due_on} · {a.done_at ? "done" : "open"}</span>
          {a.owner_id === current.account && !a.done_at && <ActionForm action={planningAction} context={current} operation="meeting-done" label="Mark done" secondary>
            <input type="hidden" name="action" value={a.id} /></ActionForm>}</div></li>)}</ul>}
        {m.organizer_id === current.account && <details><summary>Minutes and actions</summary>
          <ActionForm action={planningAction} context={current} operation="meeting-minutes" label="Save minutes">
            <input type="hidden" name="meeting" value={m.id} /><label>Minutes<textarea name="minutes" required maxLength={8000} defaultValue={m.minutes ?? ""} /></label></ActionForm>
          <ActionForm action={planningAction} context={current} operation="meeting-action" label="Assign action">
            <input type="hidden" name="meeting" value={m.id} />
            <label>Owner<select name="owner" required defaultValue="">{[<option key="" value="" disabled>Choose</option>, ...m.participants.map(p => <option key={p.id} value={p.id}>{p.name}</option>)]}</select></label>
            <label>Action<input name="title" required maxLength={200} /></label><label>Due<input name="due" type="date" required /></label></ActionForm>
        </details>}
      </article></li>)}</ul> : <p>No meetings yet.</p>}
    </section>
  </Chrome>;
}
