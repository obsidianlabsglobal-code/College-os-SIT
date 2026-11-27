import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "../page-header";
import { Chrome } from "../chrome";
import { ActionForm } from "../forms";
import { planningAction } from "../actions/planning";
import { account, scope, workspaceQuery } from "../../lib/scope";
import { studyGroups } from "../../lib/student-life";
import { offerings } from "../../lib/assignments";

export default async function Groups({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [params, user] = await Promise.all([searchParams, account()]);
  const current = await scope(params.institution, params.role);
  if (current.role !== "student") notFound();
  const [groups, courses] = await Promise.all([studyGroups(current), offerings(current)]);
  const query = workspaceQuery(current);
  return <Chrome user={user} current={current} section="/groups">
    <PageHeader title="Study groups" parent={{ href: `/?${query}`, label: "Workspace" }}
      context="Opt-in groups for your courses. Members' names are shown to classmates in the same course." />
    {courses.length > 0 && <section className="panel stack" aria-labelledby="new-group">
      <h2 id="new-group">Start a group</h2>
      <ActionForm action={planningAction} context={current} operation="group-create" label="Create group">
        <label>Course<select name="offering" required defaultValue={courses[0].id}>{courses.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
        <label>Group name<input name="name" required maxLength={80} /></label>
        <label>Maximum members<input name="capacity" type="number" min={2} max={30} defaultValue={6} required /></label>
      </ActionForm>
    </section>}
    <section className="panel stack" aria-labelledby="groups-title">
      <h2 id="groups-title">Groups in your courses</h2>
      {groups.length ? <ul className="items">{groups.map(g => <li key={g.id}><article aria-label={g.name} className="stack">
        <div className="row spread"><h3>{g.name}</h3><span className="tag">{g.members.length} of {g.capacity}</span></div>
        <p className="meta">{g.course} · {g.members.map(m => m.id === current.account ? "You" : m.name).join(", ")}</p>
        {g.joined ? <ActionForm action={planningAction} context={current} operation="group-leave" label="Leave group" secondary><input type="hidden" name="group" value={g.id} /></ActionForm>
          : g.members.length < g.capacity && <ActionForm action={planningAction} context={current} operation="group-join" label="Join group"><input type="hidden" name="group" value={g.id} /></ActionForm>}
        <p className="meta">{g.members.filter(m => m.id !== current.account).map(m => <Link key={m.id} href={`/profile?${query}&student=${m.id}`}>{m.name}’s profile </Link>)}</p>
      </article></li>)}</ul> : <p>No groups yet.</p>}
    </section>
  </Chrome>;
}
