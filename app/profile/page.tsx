import { notFound } from "next/navigation";
import { PageHeader } from "../page-header";
import { Chrome } from "../chrome";
import { ActionForm } from "../forms";
import { planningAction } from "../actions/planning";
import { account, scope, workspaceQuery } from "../../lib/scope";
import { portfolio, portfolioCandidates, readProfile } from "../../lib/student-life";
import { studentRecord } from "../../lib/student-records";
import Link from "next/link";

export default async function ProfilePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [params, user] = await Promise.all([searchParams, account()]);
  const current = await scope(params.institution, params.role);
  const student = params.student ?? (current.role === "student" ? current.account : "");
  const own = current.role === "student" && student === current.account;
  const profile = student ? await readProfile(current, student) : null;
  if (!own && !profile) notFound();
  const entries = own ? await portfolioCandidates(current) : (await portfolio(current, student)) ?? [];
  const record = own ? await studentRecord(current, current.account) : null;
  const query = workspaceQuery(current);
  return <Chrome user={user} current={current} section="/profile">
    <PageHeader title={own ? "My profile" : `${profile!.name}’s profile`} parent={{ href: `/?${query}`, label: "Workspace" }}
      context={own ? "Choose who can read this. Teachers include your current teachers and mentor; classmates are students in your current courses." : undefined} />
    <section className="panel stack" aria-labelledby="profile-title">
      <h2 id="profile-title">{own ? "Edit profile" : "About"}</h2>
      {own ? <ActionForm action={planningAction} context={current} operation="profile-save" label="Save profile">
        <label>About me<textarea name="bio" maxLength={1000} defaultValue={profile?.bio ?? ""} /></label>
        <label>Interests<input name="interests" maxLength={300} defaultValue={profile?.interests ?? ""} /></label>
        <label>Who can see this<select name="visibility" defaultValue={profile?.visibility ?? "private"}>
          <option value="private">Only me</option><option value="teachers">My teachers and mentor</option><option value="classmates">Teachers and classmates</option></select></label>
      </ActionForm> : <><p style={{ whiteSpace: "pre-wrap" }}>{profile!.bio || "No description."}</p>{profile!.interests && <p className="meta">Interests: {profile!.interests}</p>}</>}
    </section>
    {record && <section className="panel stack" aria-labelledby="record-title">
      <h2 id="record-title">My college record</h2>
      <p>{record.email} · USN {record.usn ?? "not recorded"} · Semester {record.semester ?? "not recorded"} · Phone {record.phone ?? "not recorded"} · {record.sections.join(", ") || "no current section"}</p>
      <p className="meta">Only you and the college office see this. If something is wrong, <Link href={`/requests?${query}`}>ask the office to correct it</Link>.</p>
    </section>}
    <section className="panel stack" aria-labelledby="portfolio-title">
      <h2 id="portfolio-title">{own ? "Portfolio" : "Portfolio highlights"}</h2>
      <p className="meta">{own ? "Choose verified records to include. Only issued certificates, accepted project milestones and published results can be added; readers follow the visibility above." : "Verified records the student chose to share."}</p>
      {entries.length ? <ul className="items">{entries.map(e => <li key={`${e.source}:${e.source_id}`}><div className="row spread">
        <span><strong>{e.title}</strong> · {e.detail}</span>
        {own && <ActionForm action={planningAction} context={current} operation={e.included ? "portfolio-remove" : "portfolio-add"} label={e.included ? "Remove" : "Include"} secondary>
          <input type="hidden" name="source" value={e.source} /><input type="hidden" name="id" value={e.source_id} /></ActionForm>}
      </div></li>)}</ul> : <p>{own ? "No verified records yet." : "Nothing shared yet."}</p>}
    </section>
  </Chrome>;
}
