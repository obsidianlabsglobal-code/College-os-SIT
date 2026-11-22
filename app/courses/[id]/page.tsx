import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { assignments, offerings } from "../../../lib/assignments";
import { account, scope, workspaceQuery } from "../../../lib/scope";
import { Chrome } from "../../chrome";
import { PageHeader } from "../../page-header";

export default async function CourseWorkspace({params, searchParams}: {
  params: Promise<{id: string}>;
  searchParams: Promise<{institution?: string; role?: string}>;
}) {
  const [{id}, selection, user] = await Promise.all([params, searchParams, account()]);
  if (!z.uuid().safeParse(id).success) notFound();
  const actor = await scope(selection.institution, selection.role);
  const [course] = await offerings(actor, id);
  if (!course) notFound();
  const work = await assignments(actor, undefined, id);
  const query = workspaceQuery(actor);
  const date = new Intl.DateTimeFormat("en-IN", {timeZone:course.timezone, dateStyle:"medium", timeStyle:"short"});
  return <Chrome user={user} current={actor}>
    <PageHeader title={course.course} context={`${course.section} · ${course.term} · ${course.scheme}`}
      parent={{href:`/?${query}`,label:"My courses"}} />
    <section className="panel">
      <h2>Course assignments</h2>
      {work.length ? <ul className="items">{work.map(item => <li key={item.id}>
        <div className="row"><Link href={`/assignments/${item.id}?${query}`}>{item.title}</Link>
          <span className="tag">{item.published_at ? "Published" : "Draft"}</span></div>
        <p className="meta">Due {date.format(item.deadline)} ({course.timezone})</p>
      </li>)}</ul> : <p>No assignments are available for this course.</p>}
    </section>
  </Chrome>;
}
