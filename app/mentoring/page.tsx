import { notFound } from "next/navigation";
import { PageHeader } from "../page-header";
import { Chrome } from "../chrome";
import { ActionForm } from "../forms";
import { courseAction } from "../actions/courses";
import { account, scope, workspaceQuery } from "../../lib/scope";
import { mentorOptions, mentorships } from "../../lib/mentoring";

export default async function Mentoring({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [params, user] = await Promise.all([searchParams, account()]);
  const current = await scope(params.institution, params.role);
  if (!["student", "faculty", "admin"].includes(current.role)) notFound();
  const [pairs, options] = await Promise.all([mentorships(current), mentorOptions(current)]);
  const query = workspaceQuery(current);
  const when = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" });
  return <Chrome user={user} current={current} section="/mentoring">
    <PageHeader title="Mentoring" parent={{ href: `/?${query}`, label: "Workspace" }}
      context={current.role === "admin" ? "Assign each student one current faculty mentor. Earlier pairings and their notes are kept."
        : current.role === "faculty" ? "Your current mentees. Goals and follow-ups you record are visible to the student."
        : "Your mentor’s goals and follow-ups. Mark a goal agreed once you have discussed it."} />
    {options && <section className="panel stack" aria-labelledby="assign-title">
      <h2 id="assign-title">Assign a mentor</h2>
      <ActionForm action={courseAction} context={current} operation="mentor-assign" label="Assign mentor">
        <label>Student<select name="student" required defaultValue=""><option value="" disabled>Choose a student</option>
          {options.students.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>Faculty mentor<select name="mentor" required defaultValue=""><option value="" disabled>Choose a faculty member</option>
          {options.faculty.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      </ActionForm>
      <h3>Current pairings</h3>
      {options.pairs.length ? <ul className="items">{options.pairs.map(p => <li key={p.id}>{p.student} · mentored by {p.mentor}</li>)}</ul> : <p>No mentors assigned yet.</p>}
    </section>}
    {current.role !== "admin" && (pairs.length ? pairs.map(pair => <section key={pair.id} className="panel stack" aria-label={current.role === "faculty" ? pair.student : "Your mentor"}>
      <h2>{current.role === "faculty" ? pair.student : `Mentor: ${pair.mentor}`}</h2>
      <p className="meta">Since {when.format(pair.started_at)}</p>
      {pair.records.length ? <ul className="items">{pair.records.map(record => <li key={record.id}>
        <div className="row spread"><strong>{record.kind === "goal" ? "Goal" : "Follow-up"}</strong>
          {record.kind === "goal" && <span className={record.agreed_at ? "tag" : "tag tag-attention"}>{record.agreed_at ? `Agreed ${when.format(record.agreed_at)}` : "Not yet agreed"}</span>}</div>
        <p>{record.body}</p>
        <p className="meta">{when.format(record.created_at)}</p>
        {current.role === "student" && record.kind === "goal" && !record.agreed_at && <ActionForm action={courseAction} context={current} operation="goal-agree" label="Mark goal agreed" secondary>
          <input type="hidden" name="record" value={record.id} /></ActionForm>}
      </li>)}</ul> : <p>No goals or follow-ups yet.</p>}
      {current.role === "faculty" && <ActionForm action={courseAction} context={current} operation="mentor-record" label="Save note">
        <input type="hidden" name="assignment" value={pair.id} />
        <label>Type<select name="kind" defaultValue="goal"><option value="goal">Goal</option><option value="followup">Follow-up</option></select></label>
        <label>Note<textarea name="body" required maxLength={1000} /></label>
      </ActionForm>}
    </section>) : <p className="panel">{current.role === "faculty" ? "No students are currently assigned to you for mentoring." : "No mentor is currently assigned to you."}</p>)}
  </Chrome>;
}
