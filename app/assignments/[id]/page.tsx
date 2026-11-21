import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { account, scope, workspaceQuery } from "../../../lib/scope";
import { assignments, files, submissions } from "../../../lib/assignments";
import { ActionForm } from "../../forms";
import { Chrome } from "../../chrome";
import { workflow } from "../../actions/workflow";

export default async function Detail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ institution?: string; role?: string }> }) {
  const [{ id }, selection, user] = await Promise.all([params, searchParams, account()]);
  if (!z.uuid().safeParse(id).success) notFound();
  const current = await scope(selection.institution, selection.role);
  const [assignment] = await assignments(current, id);
  if (!assignment) notFound();
  const [received, attachments] = await Promise.all([submissions(current, id), files(current, id)]);
  const query = workspaceQuery(current);
  const deadline = new Intl.DateTimeFormat("en-IN", { dateStyle: "long", timeStyle: "short", timeZone: assignment.timezone }).format(assignment.deadline);
  const isFaculty = current.role === "faculty";
  const fileLinks = (submissionId: string | null) => attachments.filter(file => file.submission_id === submissionId).map(file =>
    <p key={file.id}><a download href={`/files/${file.id}?assignment=${id}&${query}`}>{file.filename}</a></p>);
  const assignmentField = <input type="hidden" name="assignment" value={id} />;

  return <Chrome name={user.name}>
    <div className="hero">
      <Link href={`/?${query}`}>Assignments</Link>
      <h1>{assignment.title}</h1>
      <p className="meta">{assignment.course} · {assignment.section}</p>
    </div>
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
        {isFaculty && !received.length && <p>No submissions yet.</p>}
        {!isFaculty && !received.length && (assignment.accepting ?
          <ActionForm action={workflow} context={current} operation="submit" label="Submit assignment">
            {assignmentField}<input type="hidden" name="request" value={randomUUID()} />
            <p className="meta">Enter a response, attach a file, or do both. Submitted work is final.</p>
            <label>Response<textarea name="body" maxLength={20000} /></label>
            <label>File (PDF or TXT, 4 MiB)<input name="file" type="file" accept=".pdf,.txt" /></label>
          </ActionForm> : <p>The submission deadline has passed.</p>)}
        {received.map(submission => {
          const revision = submission.draft?.revision ?? submission.published?.revision ?? 0;
          const gradeFields = <>{assignmentField}<input type="hidden" name="submission" value={submission.id} /><input type="hidden" name="revision" value={revision} /><input type="hidden" name="is-draft" value={String(Boolean(submission.draft))} /></>;
          return <article className="stack" key={submission.id}>
            <h3>{isFaculty ? submission.name : "Submitted"}</h3>
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
      </section>
    </div>
  </Chrome>;
}
