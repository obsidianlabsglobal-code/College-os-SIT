import { PageHeader } from "../page-header";
import { notFound } from "next/navigation";
import { account, scope, workspaceQuery } from "../../lib/scope";
import { adminCatalog } from "../../lib/academics";
import { Chrome } from "../chrome";
import { ActionForm } from "../forms";
import { catalog } from "../actions/catalog";
import { institution } from "../actions/institution";
import { studentAdmission } from "../actions/student-admission";
import { studentAdmissions } from "../../lib/student-admission";
import { onboardingPreviewEnabled } from "../../lib/onboarding-preview";
import { delegatedRoles, institutionCatalog } from "../../lib/institution";
import { planningAction } from "../actions/planning";
import { catalogHistory } from "../../lib/academics";

type Option = { id: string; name: string };

function Choices({ label, field, options, required = true }: { label: string; field: string; options: Option[]; required?: boolean }) {
  return <label>{label}<select name={field} required={required} defaultValue=""><option value="" disabled={required}>{required ? `Select ${label.toLowerCase()}` : "None"}</option>
    {options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>;
}

export default async function Admin({ searchParams }: { searchParams: Promise<{ institution?: string; role?: string }> }) {
  const [selection,user] = await Promise.all([searchParams,account()]);
  const current = await scope(selection.institution,selection.role);
  if (current.role !== "admin") notFound();
  const preview = onboardingPreviewEnabled();
  const [data, setup, admissions, history] = await Promise.all([
    adminCatalog(current), institutionCatalog(current), preview ? studentAdmissions(current) : [], catalogHistory(current),
  ]);
  return <Chrome user={user} current={current} section="/admin">
    <PageHeader title="Academic setup" parent={{ href: `/?${workspaceQuery(current)}`, label: "Workspace" }} />
    <nav className="section-jumps" aria-label="Academic setup sections"><a href="#admin-catalog">Courses and sections</a><a href="#admin-rosters">Course rosters</a><a href="#admin-structure">Departments, schemes and terms</a><a href="#admin-access">Role assignments</a>{preview && <a href="#student-admission">Student admissions preview</a>}</nav>
    <div className="grid">
      <section className="panel stack">
        <h2 id="admin-catalog" tabIndex={-1}>Courses and sections</h2>
        <ActionForm action={catalog} context={current} operation="course" label="Add course">
          <Choices label="Department" field="department" options={data.departments} />
          <label>Course name<input name="name" maxLength={120} required /></label>
        </ActionForm>
        <ActionForm action={catalog} context={current} operation="section" label="Add section">
          <label>Section name<input name="name" maxLength={120} required /></label>
        </ActionForm>
        <ActionForm action={catalog} context={current} operation="offering" label="Add offering">
          <Choices label="Course" field="course" options={data.courses} />
          <Choices label="Section" field="section" options={data.sections} />
          <Choices label="Term" field="term" options={data.terms} />
        </ActionForm>
      </section>
      <section className="panel stack">
        <h2 id="admin-rosters" tabIndex={-1}>Course rosters</h2>
        <ActionForm action={catalog} context={current} operation="add-roster" label="Add to roster">
          <Choices label="Offering" field="offering" options={data.offerings} />
          <Choices label="Person" field="account" options={Array.from(new Map(data.people.map(person => [person.id,person])).values())} />
          <Choices label="Roster role" field="roster-role" options={[{ id: "student", name: "Student" }, { id: "faculty", name: "Faculty" }]} />
        </ActionForm>
        {!data.roster.length && <p>No roster entries yet.</p>}
        <ul className="items">{data.roster.map(entry => <li key={`${entry.offering_id}-${entry.account_id}-${entry.role}`}>
          <strong>{entry.person}</strong> · {entry.role}<p className="meta">{entry.offering}</p>
          {entry.ended_at ? <span className="tag">Ended</span> : <ActionForm action={catalog} context={current} operation="end-roster" confirmation={`End ${entry.person}’s ${entry.role} access to ${entry.offering}. The course history is retained.`} label="End access" secondary>
            <input type="hidden" name="offering" value={entry.offering_id} />
            <input type="hidden" name="account" value={entry.account_id} />
            <input type="hidden" name="roster-role" value={entry.role} />
          </ActionForm>}
        </li>)}</ul>
      </section>
      <section className="panel stack">
        <h2 id="admin-structure" tabIndex={-1}>Departments, schemes and terms</h2>
        <ActionForm action={institution} context={current} operation="department" label="Add department">
          <label>Department name<input name="name" maxLength={120} required /></label>
        </ActionForm>
        <ActionForm action={institution} context={current} operation="scheme" label="Add academic scheme">
          <label>Scheme name<input name="name" maxLength={120} required /></label>
        </ActionForm>
        <ActionForm action={institution} context={current} operation="term" label="Add term">
          <Choices label="Academic scheme" field="scheme" options={setup.schemes} />
          <label>Term name<input name="name" maxLength={120} required /></label>
        </ActionForm>
      </section>
      <section className="panel stack">
        <h2 id="admin-access" tabIndex={-1}>Role assignments</h2>
        <ActionForm action={institution} context={current} operation="grant" confirmation="Grant the selected person access to this workspace for the institution shown above." label="Assign role">
          <Choices label="Person" field="account" options={Array.from(new Map(setup.grants.map(grant => [grant.account_id,{ id: grant.account_id, name: grant.account_name }])).values())} />
          <Choices label="Role" field="grant-role" options={delegatedRoles.map(role => ({ id: role, name: role === "hod" ? "Department head" : role[0].toUpperCase() + role.slice(1) }))} />
          <Choices label="Department (HOD only)" field="department" options={data.departments} required={false} />
        </ActionForm>
        <ul className="items">{setup.grants.map(grant => <li key={grant.id}>
          <strong>{grant.account_name}</strong> · {grant.role}{grant.department && ` · ${grant.department}`}
          {grant.ended_at ? <span className="tag">Ended</span> : grant.role !== "admin" && <ActionForm action={institution} context={current} operation="end" confirmation={`End ${grant.account_name}’s ${grant.role} workspace access${grant.department ? " for "+grant.department : ""}.`} label="End role" secondary>
            <input type="hidden" name="membership" value={grant.id} />
          </ActionForm>}
        </li>)}</ul>
      </section>
      <section className="panel stack" aria-labelledby="rename-title">
        <h2 id="rename-title">Correct a course or section name</h2>
        <p className="meta">Corrections keep the previous name, the reason and who made the change.</p>
        <ActionForm action={planningAction} context={current} operation="rename" label="Save correction">
          <label>Record<select name="target" required defaultValue=""><option value="" disabled>Choose</option>
            {data.courses.map(c => <option key={c.id} value={`course|${c.id}`}>Course · {c.name}</option>)}
            {data.sections.map(c => <option key={c.id} value={`section|${c.id}`}>Section · {c.name}</option>)}</select></label>
          <label>Corrected name<input name="name" required maxLength={160} /></label>
          <label>Reason<input name="reason" required maxLength={500} /></label>
        </ActionForm>
        {history.length > 0 && <ul className="items">{history.map((h, n) => <li key={n} className="meta">{h.entity}: {h.old_name} → {h.new_name} · {h.reason} · {h.changed_by}</li>)}</ul>}
      </section>
      <section className="panel stack" aria-labelledby="offboard-title">
        <h2 id="offboard-title">Offboard a person</h2>
        <p className="meta">Ends every post, course roster and mentoring pairing the person holds in this institution, in one step. Their records and history are kept. Open cases and requests they own are reported for reassignment. Administrator posts are not offboarded here.</p>
        <ActionForm action={planningAction} context={current} operation="offboard" label="Review offboarding"
          confirmationTitle="Confirm offboarding" confirmationLabel="End all access"
          confirmation="All current posts, course rosters and mentoring pairings for the selected person in this institution will end now. This cannot be undone from this screen; access can be granted again later.">
          <Choices label="Person to offboard" field="account" options={Array.from(new Map(setup.grants.filter(grant => !grant.ended_at && grant.role !== "admin").map(grant => [grant.account_id,{ id: grant.account_id, name: grant.account_name }])).values())} />
        </ActionForm>
      </section>
      {preview && <section className="panel stack">
        <h2 id="student-admission" tabIndex={-1}>Student admissions preview</h2>
        <p>Record eligibility for fictional students only. This cannot create an account or grant workspace access.</p>
        <ActionForm action={studentAdmission} context={current} operation="approve" label="Save fictional approval">
          <label>Fictional student email<input name="email" type="email" maxLength={254} placeholder="example@nexus.example.invalid" required /></label>
          <Choices label="Admission section" field="section" options={data.sections} />
          <Choices label="Admission term" field="term" options={data.terms} />
        </ActionForm>
        {!admissions.length && <p>No fictional approvals yet.</p>}
        <ul className="items">{admissions.map(entry => <li key={entry.id}>
          <strong>{entry.email}</strong><p className="meta">{entry.section} · {entry.term}</p>
          {entry.revoked_at ? <span className="tag">Revoked</span> :
            <ActionForm action={studentAdmission} context={current} operation="revoke" label="Revoke approval" secondary
              confirmation="Revoke this fictional student's approval. This does not change any existing accounts.">
              <input type="hidden" name="admission" value={entry.id} />
            </ActionForm>}
        </li>)}</ul>
      </section>}
    </div>
  </Chrome>;
}
