import { MissionControl } from "./faculty/mission-control";
import { account, scope, workspaces } from "../lib/scope";
import { AdminBoard, HodBoard, PrincipalBoard } from "./leadership/boards";
import { Suspense } from "react";
import { ExperienceHeading } from "./experience/heading";
import { StudentHome, StudentHomeLoading } from "./student/home";
import { cookies } from "next/headers";
import { Chrome, roleLabels } from "./chrome";

export default async function Home({ searchParams }: { searchParams: Promise<{ institution?: string; role?: string }> }) {
  const user = await account();
  const options = await workspaces(user.id);
  const params = await searchParams;
  const preferred = new URLSearchParams((await cookies()).get("nexus_workspace")?.value);
  const first = options.find(option => option.id === preferred.get("institution") && option.role === preferred.get("role")) ?? options[0];
  const current = first ? await scope(params.institution ?? first.id, params.role ?? first.role) : null;
  const workspace = options.find(option => option.id === current?.institution && option.role === current?.role);
  if (current?.role === "student") {
    return <Chrome user={user} current={current}>
      <Suspense fallback={<StudentHomeLoading />}>
        <StudentHome current={current} name={user.name} timezone={workspace?.timezone ?? "UTC"} />
      </Suspense>
    </Chrome>;
  }

  return <Chrome user={user} current={current}>
    <ExperienceHeading title={current ? roleLabels[current.role] : "Your workspace"}
      context={current?.role === "faculty" ? "Manage assignments for the courses you teach." :
        current?.role === "hod" ? "Review academic activity for your departments." :
        current?.role === "principal" ? "Institution reporting from published academic records and service requests." :
        current?.role === "admin" ? "Review service requests, configure courses and manage access." :
        current?.role === "transport" ? "Run routes, buses and transport reports for the departments that are switched on." :
        current?.role === "driver" ? "Your trips and transport reports." : undefined} />
    {!current && <p className="panel">Your account has no active institutional workspace.</p>}
    {current?.role === "principal" && <PrincipalBoard current={current} timezone={workspace?.timezone ?? "Asia/Kolkata"} />}
    {current?.role === "admin" && <AdminBoard current={current} timezone={workspace?.timezone ?? "Asia/Kolkata"} />}
    {current?.role === "hod" && <HodBoard current={current} />}
    {current?.role === "faculty" && <MissionControl current={current} timezone={workspace?.timezone ?? "Asia/Kolkata"} />}
  </Chrome>;
}
