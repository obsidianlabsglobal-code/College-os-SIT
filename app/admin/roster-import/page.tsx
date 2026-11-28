import { notFound } from "next/navigation";
import { PageHeader } from "../../page-header";
import { Chrome } from "../../chrome";
import { ActionForm } from "../../forms";
import { applyImportAction, applyStudentImportAction, previewImportAction, previewStudentImportAction } from "../../actions/onboarding";
import { account, scope, workspaceQuery } from "../../../lib/scope";
import { STUDENT_COLUMNS, TEACHER_COLUMNS, studentImport, teacherImport } from "../../../lib/roster-import";

export default async function RosterImport({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [params, user] = await Promise.all([searchParams, account()]);
  const current = await scope(params.institution, params.role);
  if (current.role !== "admin") notFound();
  const saved = params.import ? await teacherImport(current, params.import).catch(() => null) : null;
  const errors = saved?.rows.filter(r => r.errors.length).length ?? 0;
  const students = params.students ? await studentImport(current, params.students).catch(() => null) : null;
  const studentErrors = students?.rows.filter(r => r.errors.length).length ?? 0;
  return <Chrome user={user} current={current} section="/admin">
    <PageHeader title="Import teachers and students" parent={{ href: `/admin?${workspaceQuery(current)}`, label: "Academic setup" }}
      context="Upload the college's sheets as CSV. You see every row checked first; nothing is added until you confirm." />
    <section className="panel stack" aria-labelledby="upload-title">
      <h2 id="upload-title">Teachers</h2>
      <p className="meta">First line: <code>{TEACHER_COLUMNS.join(",")}</code>. Write classes as <code>Course / Section</code> separated by <code>;</code>, and mentor sections as names separated by <code>;</code>. Only switched-on departments are accepted.</p>
      <ActionForm action={previewImportAction} context={current} label="Check the sheet">
        <label>CSV file<input type="file" name="file" accept=".csv,text/csv" /></label>
        <label>Or paste the CSV<textarea name="csv" rows={6} /></label>
      </ActionForm>
    </section>
    {saved && <section className="panel stack" aria-labelledby="preview-title">
      <h2 id="preview-title">{saved.state === "applied" ? "Imported" : errors ? `${errors} of ${saved.rows.length} rows need fixing` : `${saved.rows.length} rows ready`}</h2>
      <div className="table-scroll" role="region" aria-label="Checked rows" tabIndex={0}><table className="standings">
        <thead><tr><th scope="col">Line</th><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Department</th><th scope="col">Classes</th><th scope="col">Mentor of</th><th scope="col">Check</th></tr></thead>
        <tbody>{saved.rows.map(r => <tr key={r.line}><td>{r.line}</td><th scope="row">{r.name}</th><td>{r.email}</td><td>{r.department}</td>
          <td>{r.teaches.map(t => `${t.course} / ${t.section}`).join("; ")}</td><td>{r.mentor_of.join("; ")}</td>
          <td>{r.errors.length ? r.errors.join(" ") : "OK"}</td></tr>)}</tbody>
      </table></div>
      {saved.state === "previewed" && !errors && <ActionForm action={applyImportAction} context={current} label={`Add ${saved.rows.length} teachers`}>
        <input type="hidden" name="import" value={saved.id} /></ActionForm>}
      {saved.state === "previewed" && errors > 0 && <p className="meta">Fix the rows above in the sheet and upload it again. Nothing has been added.</p>}
    </section>}
    <section className="panel stack" aria-labelledby="students-title">
      <h2 id="students-title">Students</h2>
      <p className="meta">First line: <code>{STUDENT_COLUMNS.join(",")}</code>. Sections must belong to a switched-on department. Choose whether section teachers check each student, or the office admits them now.</p>
      <ActionForm action={previewStudentImportAction} context={current} label="Check the student sheet">
        <label>How students are added<select name="mode" defaultValue="pending"><option value="pending">Section teachers approve each student</option>
          <option value="approved">Admit now on the office’s authority</option></select></label>
        <label>Student CSV file<input type="file" name="file" accept=".csv,text/csv" /></label>
        <label>Or paste the student CSV<textarea name="csv" rows={6} /></label>
      </ActionForm>
    </section>
    {students && <section className="panel stack" aria-labelledby="student-preview">
      <h2 id="student-preview">{students.state === "applied" ? "Students imported" : studentErrors ? `${studentErrors} of ${students.rows.length} student rows need fixing` : `${students.rows.length} student rows ready`}</h2>
      <p className="meta">{students.mode === "pending" ? "These become sign-up requests for their section teachers." : "These students are admitted on the office’s authority."}</p>
      <div className="table-scroll" role="region" aria-label="Checked student rows" tabIndex={0}><table className="standings">
        <thead><tr><th scope="col">Line</th><th scope="col">Name</th><th scope="col">Email</th><th scope="col">USN</th><th scope="col">Section</th><th scope="col">Check</th></tr></thead>
        <tbody>{students.rows.map(r => <tr key={r.line}><td>{r.line}</td><th scope="row">{r.name}</th><td>{r.email}</td><td>{r.usn}</td><td>{r.section}</td>
          <td>{r.errors.length ? r.errors.join(" ") : "OK"}</td></tr>)}</tbody>
      </table></div>
      {students.state === "previewed" && !studentErrors && <ActionForm action={applyStudentImportAction} context={current} label={`Add ${students.rows.length} students`}>
        <input type="hidden" name="import" value={students.id} /></ActionForm>}
      {students.state === "previewed" && studentErrors > 0 && <p className="meta">Fix the rows above in the sheet and upload it again. Nothing has been added.</p>}
    </section>}
  </Chrome>;
}
