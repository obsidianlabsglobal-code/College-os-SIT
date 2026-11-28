import { notFound } from "next/navigation";
import { PageHeader } from "../page-header";
import { Chrome } from "../chrome";
import { ActionForm } from "../forms";
import { careersAction } from "../actions/careers";
import { account, scope, workspaceQuery } from "../../lib/scope";
import { myApplications, placementApplicants, placementOutcomes, resumeDraft } from "../../lib/careers";

const stateLabel: Record<string, string> = { saved: "Saved", submitted: "Submitted", shortlisted: "Shortlisted", offered: "Offer recorded", rejected: "Not selected", withdrawn: "Withdrawn" };

export default async function Careers({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [params, user] = await Promise.all([searchParams, account()]);
  const current = await scope(params.institution, params.role);
  if (!["student", "admin", "principal"].includes(current.role)) notFound();
  const [mine, applicants, outcomes, resume] = await Promise.all([myApplications(current), placementApplicants(current), placementOutcomes(current), resumeDraft(current)]);
  return <Chrome user={user} current={current} section="/careers">
    <PageHeader title="Careers" parent={{ href: `/?${workspaceQuery(current)}`, label: "Workspace" }}
      context={current.role === "student" ? "Track listings you saved from Opportunities. For outside listings, apply at the official source; placement drives are decided by the office."
        : "Placement-drive applicants and recorded outcomes. Only offers the office records are counted."} />

    {current.role === "student" && <section className="panel stack" aria-labelledby="apps-title">
      <h2 id="apps-title">My applications</h2>
      {mine.length ? <ul className="items">{mine.map(a => <li key={a.listing_id}><article aria-label={a.title} className="stack">
        <div className="row spread"><h3>{a.title}</h3><span className="tag">{stateLabel[a.state]}</span></div>
        <p className="meta">{a.kind} · {a.sponsor} · Apply by {a.deadline}{a.department ? ` · ${a.department} students` : ""}</p>
        {!a.eligible && <p className="meta">You do not meet this listing’s requirement: it needs a current {a.department} course. Ask the office if your enrolment is missing.</p>}
        {a.outcome_note && <p><strong>Office note:</strong> {a.outcome_note}</p>}
        {a.state === "saved" && <ActionForm action={careersAction} context={current} operation="draft" label="Save draft" secondary>
          <input type="hidden" name="listing" value={a.listing_id} />
          <label>Statement<textarea name="statement" maxLength={3000} defaultValue={a.statement} /></label></ActionForm>}
        {a.state === "saved" && a.open && a.eligible && <details><summary>Mark as submitted</summary>
          <ActionForm action={careersAction} context={current} operation="submit" label="Submit application">
            <input type="hidden" name="listing" value={a.listing_id} />
            <label>Final statement<textarea name="statement" required maxLength={3000} defaultValue={a.statement} /></label></ActionForm></details>}
        {a.state !== "saved" && a.statement && <p className="meta" style={{ whiteSpace: "pre-wrap" }}>{a.statement}</p>}
        {["saved", "submitted", "shortlisted"].includes(a.state) && <ActionForm action={careersAction} context={current} operation="withdraw" label="Withdraw" secondary>
          <input type="hidden" name="listing" value={a.listing_id} /></ActionForm>}
      </article></li>)}</ul> : <p>Nothing saved yet. Use “Track” on a listing in Opportunities.</p>}
    </section>}

    {resume !== null && <section className="panel stack" aria-labelledby="resume-title">
      <h2 id="resume-title">Résumé draft</h2>
      <p className="meta">Built from your profile interests and the verified records you chose for your portfolio. Copy and edit it; NEXUS does not send it anywhere.</p>
      <label>Résumé text<textarea readOnly rows={10} value={resume} /></label>
    </section>}

    {current.role === "admin" && <section className="panel stack" aria-labelledby="placements-title">
      <h2 id="placements-title">Placement-drive applicants</h2>
      {applicants.length ? <ul className="items">{applicants.map(a => <li key={`${a.listing_id}:${a.student_id}`}><article aria-label={`${a.name} · ${a.title}`} className="stack">
        <div className="row spread"><h3>{a.name} · {a.title}</h3><span className="tag">{stateLabel[a.state]}</span></div>
        <p className="meta" style={{ whiteSpace: "pre-wrap" }}>{a.statement}</p>
        {a.outcome_note && <p className="meta">Note: {a.outcome_note}</p>}
        {(a.state === "submitted" || a.state === "shortlisted") && <ActionForm action={careersAction} context={current} operation="outcome" label="Record outcome">
          <input type="hidden" name="listing" value={a.listing_id} /><input type="hidden" name="student" value={a.student_id} />
          <label>Outcome<select name="outcome" defaultValue={a.state === "submitted" ? "shortlisted" : "offered"}>
            {(a.state === "submitted" ? ["shortlisted", "rejected"] : ["offered", "rejected"]).map(o => <option key={o} value={o}>{stateLabel[o]}</option>)}</select></label>
          <label>Note<input name="note" required maxLength={500} /></label></ActionForm>}
      </article></li>)}</ul> : <p>No placement applications yet.</p>}
    </section>}

    {(current.role === "admin" || current.role === "principal") && <section className="panel stack" aria-labelledby="outcomes-title">
      <h2 id="outcomes-title">Placement outcomes by department</h2>
      <p className="meta">Students with an office-recorded placement offer, out of students who applied to a placement drive. A student counts in each department where they take a current course.</p>
      {outcomes.length ? <table className="standings"><thead><tr><th scope="col">Department</th><th scope="col">Applied</th><th scope="col">Offers</th></tr></thead>
        <tbody>{outcomes.map(o => <tr key={o.department}><th scope="row">{o.department}</th><td>{o.applicants}</td><td>{o.students_offered}</td></tr>)}</tbody></table> : <p>No placement applications yet.</p>}
    </section>}
  </Chrome>;
}
