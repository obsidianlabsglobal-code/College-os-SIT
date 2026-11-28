import { notFound } from "next/navigation";
import { PageHeader } from "../../page-header";
import { Chrome } from "../../chrome";
import { ActionForm } from "../../forms";
import { applyImportAction, previewImportAction } from "../../actions/onboarding";
import { account, scope, workspaceQuery } from "../../../lib/scope";
import { TEACHER_COLUMNS, teacherImport } from "../../../lib/roster-import";

export default async function RosterImport({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [params, user] = await Promise.all([searchParams, account()]);
  const current = await scope(params.institution, params.role);
  if (current.role !== "admin") notFound();
  const saved = params.import ? await teacherImport(current, params.import).catch(() => null) : null;
  const errors = saved?.rows.filter(r => r.errors.length).length ?? 0;
  return <Chrome user={user} current={current} section="/admin">
    <PageHeader title="Import teachers" parent={{ href: `/admin?${workspaceQuery(current)}`, label: "Academic setup" }}
      context="Upload the college's teacher sheet as CSV. You see every row checked first; nothing is added until you confirm." />
    <section className="panel stack" aria-labelledby="upload-title">
      <h2 id="upload-title">Upload a sheet</h2>
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
  </Chrome>;
}
