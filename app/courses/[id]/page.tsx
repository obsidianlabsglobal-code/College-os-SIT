import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { assignments, offerings } from "../../../lib/assignments";
import { account, scope, workspaceQuery } from "../../../lib/scope";
import { Chrome } from "../../chrome";
import { PageHeader } from "../../page-header";
import { assignmentProgress } from "../../../lib/faculty";
import { assignmentStatus, href, plural } from "../../faculty/format";

export default async function CourseWorkspace({params, searchParams}: {
  params: Promise<{id: string}>;
  searchParams: Promise<{institution?: string; role?: string}>;
}) {
  const [{id}, selection, user] = await Promise.all([params, searchParams, account()]);
  if (!z.uuid().safeParse(id).success) notFound();
  const actor = await scope(selection.institution, selection.role);
  const [course] = await offerings(actor, id);
  if (!course) notFound();
  const [work, progress] = await Promise.all([
    assignments(actor, undefined, id),
    actor.role === "faculty" ? assignmentProgress(actor, { offering: id, limit: 200 }) : null,
  ]);
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
          return <p className="progress-line"><span>{row.submitted} of {plural(row.enrolled, "enrolled student")} submitted</span>
            {row.pending > 0 && <Link href={href("/grading", query, { status: "pending", assignment: row.id })}>{row.pending} awaiting evaluation</Link>}
            {row.awaiting > 0 && <Link href={href("/grading", query, { status: "awaiting", assignment: row.id })}>{row.awaiting} awaiting publication</Link>}</p>;
        })()}
      </li>)}</ul> : <p>No assignments are available for this course.</p>}
    </section>
  </Chrome>;
}
