import { notFound } from "next/navigation";
import { account, scope, workspaces } from "../../lib/scope";
import { Chrome, roleLabels } from "../chrome";
import { ExperienceHeading } from "../experience/heading";
import { LetterBuilder } from "./letter-builder";

export default async function Letters({searchParams}:{searchParams:Promise<{institution?:string;role?:string}>}) {
  const params=await searchParams;
  const [user,current]=await Promise.all([account(),scope(params.institution,params.role)]);
  const workspace=(await workspaces(user.id)).find(option=>option.id===current.institution && option.role===current.role);
  if(!workspace)notFound();
  return <Chrome user={user} current={current} section="/letters">
    <ExperienceHeading title="Letter drafts" context="Prepare a clear request to review, copy or submit to the office. A draft does not issue an official letter." />
    <LetterBuilder key={`${workspace.id}:${workspace.role}`} institution={workspace.name} person={user.name} affiliation={roleLabels[current.role]}
      context={current.role === "admin" || current.role === "principal" ? undefined : {institution:current.institution,role:current.role}}/>
  </Chrome>;
}
