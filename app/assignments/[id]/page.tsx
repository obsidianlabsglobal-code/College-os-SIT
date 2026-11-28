import { recordTransition } from "../../experience/record-transition";
import { PageHeader } from "../../page-header";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { z } from "zod";
import { account, scope, workspaceQuery } from "../../../lib/scope";
import { assignments, files, submissionPreview, submissions } from "../../../lib/assignments";
import { ActionForm } from "../../forms";
import { Chrome } from "../../chrome";
import { workflow } from "../../actions/workflow";
import Link from "next/link";
import { assignmentProgress, evaluationLabels, evaluationState, nextAwaitingEvaluation } from "../../../lib/faculty";
import { actionLabels, href, plural } from "../../faculty/format";
import { ProgressLine } from "../../faculty/progress-line";
import { rubric, rubricScores } from "../../../lib/rubrics";

// Above this many submissions the faculty view lists submissions and grades one at a time.
const inlineGradingLimit = 20;

export default async function Detail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ institution?: string; role?: string; submission?: string }> }) {
  const [{ id }, selection, user] = await Promise.all([params, searchParams, account()]);
  if (!z.uuid().safeParse(id).success) notFound();
  const current = await scope(selection.institution, selection.role);
  const [assignment] = await assignments(current, id);
  if (!assignment) notFound();
  const isFaculty = current.role === "faculty";
  const focus = isFaculty && z.uuid().safeParse(selection.submission).success ? selection.submission : undefined;
  const [preview, progress, next] = await Promise.all([
    isFaculty && !focus ? submissionPreview(current, id, inlineGradingLimit + 1) : [],
    isFaculty ? assignmentProgress(current, { assignment: id }) : null,
    focus ? nextAwaitingEvaluation(current, id, focus) : null,
  ]);
  const [summary] = progress?.rows ?? [];
  const compact = preview.length > inlineGradingLimit;
  const selectedIds = focus ? [focus] : isFaculty ? preview.map(row => row.id) : undefined;
  const [received, attachments] = await Promise.all([
    compact ? [] : submissions(current, id, selectedIds),
    files(current, id, undefined, compact ? [] : selectedIds),
  ]);
  if (focus && !received.length) notFound();
  const [criteria, scoreRows] = await Promise.all([rubric(current, id), Promise.all(received.map(r => rubricScores(current, r.id).then(rows => [r.id, rows] as const)))]);
  const scores = new Map(scoreRows);
  const graded = (summary?.published ?? 0) > 0 || received.some(r => r.draft || r.published);
  const query = workspaceQuery(current);
  const deadline = new Intl.DateTimeFormat("en-IN", { dateStyle: "long", timeStyle: "short", timeZone: assignment.timezone }).format(assignment.deadline);
  const fileLinks = (submissionId: string | null) => attachments.filter(file => file.submission_id === submissionId).map(file =>
    <p key={file.id}><a download href={`/files/${file.id}?assignment=${id}&${query}`}>{file.filename}</a></p>);
  const assignmentField = <input type="hidden" name="assignment" value={id} />;

  return <Chrome user={user} current={current} section="/">
    <PageHeader title={assignment.title} context={`${assignment.course} · ${assignment.section}`}
      parent={{ href: `/?${query}`, label: "Assignments" }} />
    <div className="grid">
      <section className="panel stack" style={recordTransition(current,"assignment",id)} aria-label="Assignment details">
        <div><span className="tag">{assignment.published_at ? "Published" : "Draft"}</span></div>
        <dl><dt>Deadline</dt><dd>{deadline} ({assignment.timezone})</dd><dt>Maximum marks</dt><dd>{assignment.max_marks}</dd></dl>
        <div><h2>Instructions</h2><p className="prose-text">{assignment.description}</p></div>
        {assignment.rubric && <div><h2>Rubric</h2><p className="prose-text">{assignment.rubric}</p></div>}
        {criteria.length > 0 && <div className="stack"><h2>Rubric criteria</h2><table className="standings"><caption className="sr-only">Rubric criteria</caption>
          <thead><tr><th scope="col">Criterion</th><th scope="col">Points</th></tr></thead>
          <tbody>{criteria.map(c => <tr key={c.id}><th scope="row">{c.name}{c.descriptor && <span className="meta"> · {c.descriptor}</span>}</th><td>{c.points}</td></tr>)}</tbody></table></div>}
        {isFaculty && !graded && <details><summary>{criteria.length ? "Change rubric criteria" : "Add rubric criteria"}</summary>
          <ActionForm action={workflow} context={current} operation="rubric" label="Save criteria">{assignmentField}
            <p className="meta">One criterion per line: <code>Name | points | what earns full points</code>. Points must add up to {assignment.max_marks}. Leave empty to remove the rubric.</p>
            <label>Criteria<textarea name="criteria" rows={5} defaultValue={criteria.map(c => `${c.name} | ${c.points}${c.descriptor ? ` | ${c.descriptor}` : ""}`).join("\n")} /></label>
          </ActionForm></details>}
        {fileLinks(null)}
        {isFaculty && !assignment.published_at && <ActionForm action={workflow} context={current} operation="publish" label="Publish assignment">{assignmentField}</ActionForm>}
      </section>
      <section className="panel stack">
        <h2>{isFaculty ? "Submissions" : "Your submission"}</h2>
        {summary && <div className="stack">
          <ProgressLine row={summary} query={query} links={false} />
          {summary.published > 0 && <p className="meta">{summary.published} with a published result</p>}
          {summary.submitted > 0 && <p className="submission-nav">
            {focus && <Link href={href(`/assignments/${id}`, query)}>All submissions for this assignment</Link>}
            <Link href={href("/grading", query, { status: "all", assignment: id })}>Open in evaluation queue</Link>
          </p>}
        </div>}
        {isFaculty && !compact && !received.length && <p>No submissions yet.</p>}
        {compact && <>
          <p className="meta">Showing the first {inlineGradingLimit} submissions. Open the evaluation queue for all {plural(summary?.submitted ?? preview.length, "submission")}.</p>
          <ul className="items submission-list">{preview.slice(0, inlineGradingLimit).map(submission => {
            const state = evaluationState(submission);
            return <li key={submission.id} id={`submission-${submission.id}`}>
              <span>{submission.name}</span>
              <span className="row"><span className={state === "pending" ? "tag tag-attention" : "tag"}>{evaluationLabels[state]}</span>
                <Link href={href(`/assignments/${id}`, query, { submission: submission.id })}>{actionLabels[state]}<span className="sr-only"> submission by {submission.name}</span></Link></span>
            </li>;
          })}</ul>
        </>}
        {!isFaculty && !compact && !received.length && (assignment.accepting ?
          <ActionForm action={workflow} context={current} operation="submit" label="Submit assignment">
            {assignmentField}<input type="hidden" name="request" value={randomUUID()} />
            <p className="meta">Enter a response, attach a file, or do both. Submitted work is final.</p>
            <label>Response<textarea name="body" maxLength={20000} /></label>
            <label>File (PDF or TXT, 4 MiB)<input name="file" type="file" accept=".pdf,.txt" /></label>
          </ActionForm> : <p>The submission deadline has passed.</p>)}
        {!compact && received.map(submission => {
          const revision = submission.draft?.revision ?? submission.published?.revision ?? 0;
          const gradeFields = <>{assignmentField}<input type="hidden" name="submission" value={submission.id} /><input type="hidden" name="revision" value={revision} /><input type="hidden" name="is-draft" value={String(Boolean(submission.draft))} /></>;
          return <article className="stack" key={submission.id} id={`submission-${submission.id}`}>
            <div className="row"><h3>{isFaculty ? submission.name : "Submitted"}</h3>
              {isFaculty && <span className={evaluationState(submission) === "pending" ? "tag tag-attention" : "tag"}>{evaluationLabels[evaluationState(submission)]}</span>}</div>
            <p className="meta">{new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: assignment.timezone }).format(submission.submitted_at)}</p>
            {submission.body && <p className="prose-text">{submission.body}</p>}
            {fileLinks(submission.id)}
            {submission.published ? <div><h3>Published result · {submission.published.marks}/{assignment.max_marks}</h3><p className="prose-text">{submission.published.feedback}</p>
              {!isFaculty && (scores.get(submission.id) ?? []).length > 0 && <ul className="items" aria-label="Score by criterion">{scores.get(submission.id)!.map(c =>
                <li key={c.criterion_id}>{c.name} · {c.points}/{c.max}{c.comment ? ` · ${c.comment}` : ""}</li>)}</ul>}</div> : !isFaculty && <p className="meta">Feedback has yet to be published.</p>}
            {isFaculty && <>
              <ActionForm key={`draft-${revision}-${!!submission.draft}`} action={workflow} context={current} operation="grade" label={submission.published ? "Save correction draft" : "Save grade draft"}>
                {gradeFields}
                {criteria.length ? <fieldset><legend>Score by criterion</legend>{criteria.map(c => {
                  const prior = scores.get(submission.id)?.find(x => x.criterion_id === c.id);
                  return <div key={c.id} className="stack"><label>{c.name} (out of {c.points})<input name={`score:${c.id}`} type="number" min={0} max={c.points} defaultValue={prior?.points} required /></label>
                    <label>Comment on {c.name} (optional)<input name={`comment:${c.id}`} maxLength={1000} defaultValue={prior?.comment} /></label></div>;
                })}</fieldset>
                  : <label>Marks<input name="marks" type="number" min={0} max={assignment.max_marks} defaultValue={submission.draft?.marks ?? submission.published?.marks} required /></label>}
                <label>Feedback<textarea name="feedback" defaultValue={submission.draft?.feedback ?? submission.published?.feedback} maxLength={8000} required /></label>
                {submission.published && <label>Correction reason<input name="reason" defaultValue={submission.draft?.reason ?? ""} maxLength={1000} required /></label>}
              </ActionForm>
              {submission.draft && <ActionForm action={workflow} context={current} operation="publish-grade" label={submission.published ? "Publish correction" : "Publish feedback"} secondary>{gradeFields}</ActionForm>}
            </>}
          </article>;
        })}
        {focus && <p className="submission-nav">{next
          ? <Link href={href(`/assignments/${id}`, query, { submission: next.submission })}>Next awaiting evaluation: {next.student}</Link>
          : <span>No other submissions in this assignment are awaiting evaluation.</span>}</p>}
      </section>
    </div>
  </Chrome>;
}
