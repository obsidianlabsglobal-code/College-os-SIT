import { notFound } from "next/navigation";
import { PageHeader } from "../page-header";
import { Chrome } from "../chrome";
import { ActionForm } from "../forms";
import { planningAction } from "../actions/planning";
import { account, scope, workspaceQuery } from "../../lib/scope";
import { certificateStudents, certificates, kindLabel } from "../../lib/certificates";

export default async function Certificates({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [params, user] = await Promise.all([searchParams, account()]);
  const current = await scope(params.institution, params.role);
  if (current.role !== "admin" && current.role !== "student") notFound();
  const [rows, students] = await Promise.all([certificates(current), certificateStudents(current)]);
  const query = workspaceQuery(current);
  const when = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" });
  return <Chrome user={user} current={current} section="/certificates">
    <PageHeader title="Certificates" parent={{ href: `/?${query}`, label: "Workspace" }}
      context={current.role === "admin" ? "Drafts are prepared from current records and list their sources. Issuing creates a verification code anyone can check at /verify."
        : "Certificates the office has issued to you. Share the verification code with whoever needs to confirm it."} />
    {current.role === "admin" && <section className="panel stack" aria-labelledby="draft-title">
      <h2 id="draft-title">Prepare a certificate</h2>
      <ActionForm action={planningAction} context={current} operation="certificate-draft" label="Prepare draft">
        <label>Student<select name="student" required defaultValue=""><option value="" disabled>Choose</option>{students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label>Type<select name="kind" defaultValue="bonafide">{Object.entries(kindLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      </ActionForm>
    </section>}
    <section className="panel stack" aria-labelledby="list-title">
      <h2 id="list-title">{current.role === "admin" ? "All certificates" : "Issued to you"}</h2>
      {rows.length ? <ul className="items">{rows.map(c => <li key={c.id}><article aria-label={`${kindLabel[c.kind]} for ${c.student}`} className="stack">
        <div className="row spread"><h3>{kindLabel[c.kind]} · {c.student}</h3><span className={c.state === "draft" ? "tag tag-attention" : "tag"}>
          {c.state === "draft" ? "Draft" : c.state === "issued" ? `Issued ${c.issued_at ? when.format(c.issued_at) : ""}` : "Revoked"}</span></div>
        <pre style={{ whiteSpace: "pre-wrap", font: "inherit" }}>{c.body}</pre>
        {c.verification_code && <p className="meta">Verification code <strong>{c.verification_code}</strong></p>}
        {c.revoke_reason && <p className="meta">Revoked: {c.revoke_reason}</p>}
        {current.role === "admin" && <details><summary>Sources ({c.sources.length})</summary><p className="meta">{c.sources.join(" · ") || "None"}</p></details>}
        {current.role === "admin" && c.state === "draft" && <ActionForm action={planningAction} context={current} operation="certificate-issue" label="Issue certificate"
          confirmationTitle="Issue certificate" confirmationLabel="Issue" confirmation="This becomes an official, verifiable certificate. Check the text and sources first.">
          <input type="hidden" name="certificate" value={c.id} /></ActionForm>}
        {current.role === "admin" && c.state === "issued" && <details><summary>Revoke</summary>
          <ActionForm action={planningAction} context={current} operation="certificate-revoke" label="Revoke certificate" secondary>
            <input type="hidden" name="certificate" value={c.id} /><label>Reason<input name="reason" required maxLength={500} /></label></ActionForm></details>}
      </article></li>)}</ul> : <p>No certificates yet.</p>}
    </section>
  </Chrome>;
}
