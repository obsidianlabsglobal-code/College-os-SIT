import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { assignments, offerings } from "../../../lib/assignments";
import { account, scope, workspaceQuery } from "../../../lib/scope";
import { Chrome } from "../../chrome";
import { PageHeader } from "../../page-header";
import { assignmentProgress } from "../../../lib/faculty";
import { assignmentStatus, href } from "../../faculty/format";
import { ProgressLine } from "../../faculty/progress-line";
import { ActionForm } from "../../forms";
import { courseAction } from "../../actions/courses";
import { coursePlan, courseResources, deliverySessions } from "../../../lib/course-delivery";

export default async function CourseWorkspace({params, searchParams}: {
  params: Promise<{id: string}>;
  searchParams: Promise<{institution?: string; role?: string}>;
}) {
  const [{id}, selection, user] = await Promise.all([params, searchParams, account()]);
  if (!z.uuid().safeParse(id).success) notFound();
  const actor = await scope(selection.institution, selection.role);
  const [course] = await offerings(actor, id);
  if (!course) notFound();
  const [work, progress, materials, plan, sessions] = await Promise.all([
    assignments(actor, undefined, id),
    actor.role === "faculty" ? assignmentProgress(actor, { offering: id, limit: 200 }) : null,
    courseResources(actor, id), coursePlan(actor, id), deliverySessions(actor, id),
  ]);
  const teacher = actor.role === "faculty";
  const planState = { none: "No plan yet", draft: "Draft", submitted: "Awaiting department approval", approved: "Approved", returned: "Returned for changes" };
  const topicOf = new Map(plan?.items.map(item => [item.id, `${item.sequence}. ${item.topic}`]));
  const stats = new Map(progress?.rows.map(row => [row.id, row]));
  const query = workspaceQuery(actor);
  const date = new Intl.DateTimeFormat("en-IN", {timeZone:course.timezone, dateStyle:"medium", timeStyle:"short"});
  return <Chrome user={user} current={actor}>
    <PageHeader title={course.course} context={`${course.section} · ${course.term} · ${course.scheme}`}
      parent={{href:`/?${query}`,label:"My courses"}} />
    <section className="panel">
      <div className="row spread"><h2>Course assignments</h2>
        {progress && <Link href={href("/grading", query, { status: "all", offering: id })}>Evaluation queue for this course</Link>}</div>
      {work.length ? <ul className="items">{work.map(item => <li key={item.id}>
        <div className="row"><Link href={`/assignments/${item.id}?${query}`}>{item.title}</Link>
          <span className="tag">{item.published_at ? "Published" : "Draft"}</span></div>
        <p className="meta">Due {date.format(item.deadline)} ({course.timezone})</p>
        {(() => {
          const row = stats.get(item.id);
          if (!row) return null;
          if (!row.published_at) return <p className="meta">{assignmentStatus(row).detail}</p>;
          return <ProgressLine row={row} query={query} />;
        })()}
      </li>)}</ul> : <p>No assignments are available for this course.</p>}
      {progress?.truncated && <p className="meta">Evaluation progress is shown for the first {progress.rows.length} assignments. Use the evaluation queue for the rest.</p>}
    </section>

    <section className="panel stack" aria-labelledby="materials-title">
      <h2 id="materials-title">Course materials</h2>
      <p className="meta">{teacher ? "Students on this course download the latest version. Earlier versions stay available to teachers." : "The latest version published by your teacher."}</p>
      {materials.length ? <ul className="items">{materials.map(item => <li key={item.id}>
        <div className="row spread"><a href={`/resources/${item.id}?${query}`} download>{item.title}</a><span className="tag">Version {item.version}</span></div>
        <p className="meta">{item.filename} · updated {date.format(item.uploaded_at)}{item.note && ` · ${item.note}`}</p>
        {teacher && <details><summary>Upload a new version or withdraw</summary>
          {item.version > 1 && <p className="meta">Earlier: {Array.from({ length: item.version - 1 }, (_, n) => n + 1).map(v =>
            <a key={v} href={`/resources/${item.id}?${query}&version=${v}`} download>v{v} </a>)}</p>}
          <ActionForm action={courseAction} context={actor} operation="resource-revise" label="Publish new version">
            <input type="hidden" name="resource" value={item.id} />
            <label>What changed<input name="note" required maxLength={500} /></label>
            <label>File (PDF or TXT, 4 MiB)<input name="file" type="file" accept=".pdf,.txt" required /></label>
          </ActionForm>
          <ActionForm action={courseAction} context={actor} operation="resource-withdraw" label="Withdraw material" secondary>
            <input type="hidden" name="resource" value={item.id} />
          </ActionForm>
        </details>}
      </li>)}</ul> : <p>No course materials yet.</p>}
      {teacher && <details><summary>Add course material</summary>
        <ActionForm action={courseAction} context={actor} operation="resource-add" label="Publish material">
          <input type="hidden" name="offering" value={id} />
          <label>Title<input name="title" required maxLength={160} /></label>
          <label>Note (optional)<input name="note" maxLength={500} /></label>
          <label>File (PDF or TXT, 4 MiB)<input name="file" type="file" accept=".pdf,.txt" required /></label>
        </ActionForm>
      </details>}
    </section>

    {plan && (teacher || plan.state === "approved") && <section className="panel stack" aria-labelledby="plan-title">
      <div className="row spread"><h2 id="plan-title">Course plan</h2><span className={plan.state === "returned" ? "tag tag-attention" : "tag"}>{planState[plan.state]}</span></div>
      {plan.decision_reason && teacher && <p className="meta">Department note: {plan.decision_reason}</p>}
      {plan.items.length ? <ol className="items">{plan.items.map(item => <li key={item.id}>
        {item.topic}{plan.state === "approved" && <span className="meta"> · {item.delivered ? `delivered in ${item.delivered} ${item.delivered === 1 ? "class" : "classes"}` : "not yet delivered"}</span>}
      </li>)}</ol> : <p>No topics yet.</p>}
      {teacher && (plan.state === "none" || plan.state === "draft" || plan.state === "returned") && <>
        <ActionForm action={courseAction} context={actor} operation="plan-save" label="Save plan draft">
          <input type="hidden" name="offering" value={id} />
          <label>Topics, one per line, in teaching order<textarea name="topics" required rows={6} defaultValue={plan.items.map(item => item.topic).join("\n")} /></label>
        </ActionForm>
        {plan.state === "draft" && plan.items.length > 0 && <ActionForm action={courseAction} context={actor} operation="plan-submit" label="Send for department approval" secondary>
          <input type="hidden" name="offering" value={id} />
        </ActionForm>}
      </>}
    </section>}

    {teacher && <section className="panel stack" aria-labelledby="delivery-title">
      <h2 id="delivery-title">Class delivery log</h2>
      <p className="meta">Record what each of your ended classes covered. Linking a topic counts it toward the approved plan.</p>
      {sessions.length ? <ul className="items">{sessions.map(session => <li key={session.id}>
        <p><strong>{date.format(session.start)}</strong>{session.summary ? ` · ${session.plan_item_id ? topicOf.get(session.plan_item_id) : "No plan topic"}` : " · Not recorded"}</p>
        {session.summary && <p className="meta">{session.summary}</p>}
        <details><summary>{session.summary ? "Correct this record" : "Record delivery"}</summary>
          <ActionForm action={courseAction} context={actor} operation="delivery" label="Save delivery record">
            <input type="hidden" name="session" value={session.id} />
            {plan?.state === "approved" && <label>Plan topic<select name="item" defaultValue={session.plan_item_id ?? ""}>
              <option value="">No plan topic</option>{plan.items.map(item => <option key={item.id} value={item.id}>{item.sequence}. {item.topic}</option>)}</select></label>}
            <label>What was covered<textarea name="summary" required maxLength={1000} defaultValue={session.summary ?? ""} /></label>
          </ActionForm>
        </details>
      </li>)}</ul> : <p>No ended classes yet.</p>}
    </section>}
  </Chrome>;
}
