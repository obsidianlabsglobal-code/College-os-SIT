"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { answerAcademic } from "../../lib/aura/academic-tools";
import { explainTopic } from "../../lib/aura/tutor";
import { scope, workspaces, workspaceQuery } from "../../lib/scope";
import { WorkflowError } from "../../lib/assignments";

export type AssistantReply = {heading?:string; lines?:string[]; href?:string; error?:string};
export async function academicAssistant(_previous:AssistantReply,form:FormData):Promise<AssistantReply> {
  const current=await scope(form.get("institution"),form.get("role"));
  try {
    if (form.get("operation")==="tutor") {
      const explanation=await explainTopic(current,form.get("topic"),form.get("request"));
      revalidatePath("/aura");
      return {heading:"Claude study explanation",lines:[explanation]};
    }
    const currentWorkspace=(await workspaces(current.account)).find(w=>w.id===current.institution && w.role===current.role);
    if (!currentWorkspace) throw new WorkflowError("This workspace is unavailable.");
    const result=await answerAcademic(current,z.string().parse(form.get("question")),currentWorkspace.timezone);
    return {heading:result.heading,lines:result.lines,href:result.path+"?"+workspaceQuery(current)};
  } catch(error) {
    if (error instanceof WorkflowError) return {error:error.message};
    if (error instanceof z.ZodError) return {error:"Choose a listed topic or enter a supported short academic question."};
    return {error:"The assistant could not confirm a response. Your academic records remain available through the workspace."};
  }
}
