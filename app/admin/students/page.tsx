import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "../../page-header";
import { Chrome } from "../../chrome";
import { ActionForm } from "../../forms";
import { correctRecordAction } from "../../actions/onboarding";
import { account, scope, workspaceQuery } from "../../../lib/scope";
import { findStudents, studentRecord } from "../../../lib/student-records";

const fieldLabel: Record<string, string> = { usn: "USN", semester: "Semester", phone: "Phone" };

export default async function StudentRecords({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [params, user] = await Promise.all([searchParams, account()]);
  const current = await scope(params.institution, params.role);
  if (current.role !== "admin") notFound();
  const query = workspaceQuery(current);
  const q = (params.q ?? "").trim().slice(0, 80);
  const [found, chosen] = await Promise.all([q.length >= 2 ? findStudents(current, q) : [], params.student ? studentRecord(current, params.student) : null]);
  const when = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
  return <Chrome user={user} current={current} section="/admin">
    <PageHeader title="Student records" parent={{ href: `/admin?${query}`, label: "Academic setup" }}
      context="Find a student by name, email or USN. Corrections need a reason and keep the previous value." />
    <section className="panel stack" aria-labelledby="find-title">
      <h2 id="find-title" className="sr-only">Find a student</h2>
      <form method="get" className="row"><input type="hidden" name="institution" value={current.institution} /><input type="hidden" name="role" value={current.role} />
        <label>Name, email or USN<input type="search" name="q" minLength={2} maxLength={80} defaultValue={q} required /></label><button className="button">Find</button></form>
      {q.length >= 2 && (found.length ? <ul className="items">{found.map(s => <li key={s.account_id}>
        <Link href={`/admin/students?${query}&q=${encodeURIComponent(q)}&student=${s.account_id}`}>{s.name}</Link> · {s.usn ?? "no USN"} · {s.sections.join(", ") || "no current section"}{s.current ? "" : " · former student"}
      </li>)}</ul> : <p>No student matches.</p>)}
    </section>
    {chosen && <section className="panel stack" aria-labelledby="record-title">
      <h2 id="record-title">{chosen.name}</h2>
      <dl className="metrics">
        <div><dt>Email</dt><dd>{chosen.email}</dd></div><div><dt>USN</dt><dd>{chosen.usn ?? "—"}</dd></div>
        <div><dt>Semester</dt><dd>{chosen.semester ?? "—"}</dd></div><div><dt>Phone</dt><dd>{chosen.phone ?? "—"}</dd></div>
      </dl>
      <p className="meta">Sections: {chosen.sections.join(", ") || "none current"} · {chosen.current ? "Current student" : "Former student"} · Privacy notice {chosen.consented ? "accepted" : "not accepted"}</p>
      <details><summary>Correct a detail</summary>
        <ActionForm action={correctRecordAction} context={current} label="Save correction">
          <input type="hidden" name="account" value={chosen.account_id} />
          <label>Detail<select name="field" defaultValue="usn">{Object.entries(fieldLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Correct value<input name="value" required maxLength={20} /></label>
          <label>Reason<input name="reason" required maxLength={300} placeholder="e.g. USN typed wrongly at sign-up" /></label>
        </ActionForm></details>
      <h3>History</h3>
      {chosen.history.length ? <ul className="items">{chosen.history.map((h, i) => <li key={i}>{fieldLabel[h.field]}: {h.old_value ?? "—"} → {h.new_value ?? "—"} · {h.reason} · {h.by} · {when.format(h.changed_at)}</li>)}</ul>
        : <p className="meta">No corrections yet.</p>}
    </section>}
  </Chrome>;
}
