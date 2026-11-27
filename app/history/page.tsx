import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "../page-header";
import { Chrome } from "../chrome";
import { account, scope, workspaceQuery } from "../../lib/scope";
import { assessmentHistory } from "../../lib/assignments";
import { SegmentedBar } from "../experience/segmented-bar";

export default async function AssessmentHistory({ searchParams }: { searchParams: Promise<{ institution?: string; role?: string }> }) {
  const [selection, user] = await Promise.all([searchParams, account()]);
  const current = await scope(selection.institution, selection.role);
  if (current.role !== "student") notFound();
  const records = await assessmentHistory(current);
  const query = workspaceQuery(current);
  const when = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" });
  const courses = [...new Set(records.map(r => r.course))].map(course => {
    const graded = records.filter(r => r.course === course && r.marks !== null);
    return { course, graded: graded.length, total: records.filter(r => r.course === course).length,
      marks: graded.reduce((n, r) => n + r.marks!, 0), max: graded.reduce((n, r) => n + r.max_marks, 0) };
  });
  return <Chrome user={user} current={current} section="/history">
    <PageHeader title="Assessment history" parent={{ href: `/?${query}`, label: "Workspace" }} />
    <section className="panel stack" aria-labelledby="by-course">
      <h2 id="by-course">By course</h2>
      <p className="meta">Totals use published results only. Unpublished evaluations are not shown until your teacher publishes them.</p>
      <p><a href={`/records/export?${query}`} download>Download my academic record (CSV)</a></p>
      {courses.length ? <ul className="items">{courses.map(row => <li key={row.course}>
        <p><strong>{row.course}</strong> · {row.graded} of {row.total} results published{row.max > 0 && ` · ${row.marks}/${row.max} marks`}</p>
        <SegmentedBar label={`${row.course} assessments`} total={row.total} rest="awaiting result or not submitted"
          parts={[{ label: "published", value: row.graded, tone: 1 }]} />
      </li>)}</ul> : <p>No submitted or closed assessments yet.</p>}
    </section>
    <section className="panel stack" aria-labelledby="timeline">
      <h2 id="timeline">All assessments, newest first</h2>
      {records.length ? <div className="table-scroll" role="region" aria-label="Assessment record" tabIndex={0}><table>
        <thead><tr><th scope="col">Assessment</th><th scope="col">Course</th><th scope="col">Submitted</th><th scope="col">Result</th></tr></thead>
        <tbody>{records.map(row => <tr key={row.id}>
          <th scope="row"><Link href={`/assignments/${row.id}?${query}`}>{row.title}</Link></th>
          <td>{row.course}</td>
          <td>{row.submitted_at ? when.format(row.submitted_at) : `Not submitted · closed ${when.format(row.deadline)}`}</td>
          <td>{row.marks !== null ? `${row.marks}/${row.max_marks}${row.corrected ? " · corrected" : ""}` : row.submitted_at ? "Awaiting result" : "—"}</td>
        </tr>)}</tbody>
      </table></div> : <p>No submitted or closed assessments yet.</p>}
    </section>
  </Chrome>;
}
