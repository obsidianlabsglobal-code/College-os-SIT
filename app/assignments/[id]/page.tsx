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
  const query = workspaceQuery(current);
  const deadline = new Intl.DateTimeFormat("en-IN", { dateStyle: "long", timeStyle: "short", timeZone: assignment.timezone }).format(assignment.deadline);
  const fileLinks = (submissionId: string | null) => attachments.filter(file => file.submission_id === submissionId).map(file =>
    <p key={file.id}><a download href={`/files/${file.id}?assignment=${id}&${query}`}>{file.filename}</a></p>);
  const assignmentField = <input type="hidden" name="assignment" value={id} />;

  return <Chrome user={user} current={current} section="/">
    <PageHeader title={assignment.title} context={`${assignment.course} · ${assignment.section}`}
      parent={{ href: `/?${query}`, label: "Assignments" }} />
    <div className="grid">
      <section className="panel stack" aria-label="Assignment details">
        <div><span className="tag">{assignment.published_at ? "Published" : "Draft"}</span></div>
        <dl><dt>Deadline</dt><dd>{deadline} ({assignment.timezone})</dd><dt>Maximum marks</dt><dd>{assignment.max_marks}</dd></dl>
        <div><h2>Instructions</h2><p className="prose-text">{assignment.description}</p></div>
        {assignment.rubric && <div><h2>Rubric</h2><p className="prose-text">{assignment.rubric}</p></div>}
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
            {submission.published ? <div><h3>Published result · {submission.published.marks}/{assignment.max_marks}</h3><p className="prose-text">{submission.published.feedback}</p></div> : !isFaculty && <p className="meta">Feedback has yet to be published.</p>}
            {isFaculty && <>
              <ActionForm key={`draft-${revision}-${!!submission.draft}`} action={workflow} context={current} operation="grade" label={submission.published ? "Save correction draft" : "Save grade draft"}>
                {gradeFields}
                <label>Marks<input name="marks" type="number" min={0} max={assignment.max_marks} defaultValue={submission.draft?.marks ?? submission.published?.marks} required /></label>
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
