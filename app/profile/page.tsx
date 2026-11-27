import { notFound } from "next/navigation";
import { PageHeader } from "../page-header";
import { Chrome } from "../chrome";
import { ActionForm } from "../forms";
import { planningAction } from "../actions/planning";
import { account, scope, workspaceQuery } from "../../lib/scope";
import { readProfile } from "../../lib/student-life";

export default async function ProfilePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [params, user] = await Promise.all([searchParams, account()]);
  const current = await scope(params.institution, params.role);
  const student = params.student ?? (current.role === "student" ? current.account : "");
  const own = current.role === "student" && student === current.account;
  const profile = student ? await readProfile(current, student) : null;
  if (!own && !profile) notFound();
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
  </Chrome>;
}
