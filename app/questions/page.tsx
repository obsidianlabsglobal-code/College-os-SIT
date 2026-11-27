import { notFound } from "next/navigation";
import { PageHeader } from "../page-header";
import { Chrome } from "../chrome";
import { ActionForm } from "../forms";
import { planningAction } from "../actions/planning";
import { account, scope, workspaceQuery, workspaces } from "../../lib/scope";
import { bankDepartments, bankQuestions } from "../../lib/question-bank";
import { offerings } from "../../lib/assignments";

export default async function Questions({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [params, user] = await Promise.all([searchParams, account()]);
  const current = await scope(params.institution, params.role);
  if (current.role !== "faculty") notFound();
  const timezone = (await workspaces(user.id)).find(w => w.id === current.institution && w.role === current.role)?.timezone ?? "UTC";
  const [questions, departments, courses] = await Promise.all([bankQuestions(current), bankDepartments(current), offerings(current)]);
  const query = workspaceQuery(current);
  return <Chrome user={user} current={current} section="/questions">
    <PageHeader title="Question bank" parent={{ href: `/?${query}`, label: "Workspace" }}
      context="Your questions and those shared in departments you teach in. Editing adds a new version; earlier versions are kept." />
    <section className="panel stack" aria-labelledby="add-title">
      <h2 id="add-title">Add a question</h2>
      {departments.length ? <ActionForm action={planningAction} context={current} operation="question-save" label="Save question">
        <label>Department<select name="department" required defaultValue={departments[0].id}>{departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label>Topic<input name="topic" required maxLength={120} /></label>
        <label>Question<textarea name="prompt" required maxLength={4000} /></label>
        <label>Marks<input name="marks" type="number" min={1} max={100} required defaultValue={5} /></label>
        <label>Visibility<select name="visibility" defaultValue="private"><option value="private">Only me</option><option value="department">Share with my department</option></select></label>
      </ActionForm> : <p>You need a current teaching assignment to keep a question bank.</p>}
    </section>
    <section className="panel stack" aria-labelledby="bank-title">
      <h2 id="bank-title">Questions</h2>
      {questions.length ? <ul className="items">{questions.map(q => <li key={q.id}><article aria-label={`${q.topic} question`} className="stack">
        <div className="row spread"><h3>{q.topic}</h3><span className="tag">v{q.version} · {q.marks} marks · {q.visibility === "private" ? "Private" : `Shared · ${q.department}`}</span></div>
        <p>{q.prompt}</p>{!q.mine && <p className="meta">By {q.owner}</p>}
        {q.mine && <details><summary>New version</summary>
          <ActionForm action={planningAction} context={current} operation="question-save" label="Save new version">
            <input type="hidden" name="question" value={q.id} />
            <label>Question<textarea name="prompt" required maxLength={4000} defaultValue={q.prompt} /></label>
            <label>Marks<input name="marks" type="number" min={1} max={100} required defaultValue={q.marks} /></label>
            <label>Visibility<select name="visibility" defaultValue={q.visibility}><option value="private">Only me</option><option value="department">Share with my department</option></select></label>
          </ActionForm></details>}
      </article></li>)}</ul> : <p>No questions yet.</p>}
    </section>
    {questions.length > 0 && courses.length > 0 && <section className="panel stack" aria-labelledby="compose-title">
      <h2 id="compose-title">Build a draft assignment</h2>
      <p className="meta">Creates a private draft in the chosen course with the selected questions and their total marks. Publish it from the assignment page.</p>
      <ActionForm action={planningAction} context={current} operation="compose" label="Create draft assignment">
        <label>Course<select name="offering" required defaultValue="">{[<option key="" value="" disabled>Choose</option>, ...courses.map(c => <option key={c.id} value={c.id}>{c.label}</option>)]}</select></label>
        <label>Title<input name="title" required maxLength={160} /></label>
        <label>Deadline ({timezone})<input name="deadline" type="datetime-local" required /></label>
        <fieldset><legend>Questions</legend>{questions.map(q => <label key={q.id}><input type="checkbox" name="questions" value={q.id} /> {q.topic} · v{q.version} · {q.marks} marks</label>)}</fieldset>
      </ActionForm>
    </section>}
  </Chrome>;
}
