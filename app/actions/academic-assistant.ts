"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { explainTopic } from "../../lib/aura/tutor";
import { scope } from "../../lib/scope";
import { WorkflowError } from "../../lib/assignments";

export type AssistantReply = {heading?:string; lines?:string[]; href?:string; error?:string};
export async function academicAssistant(_previous:AssistantReply,form:FormData):Promise<AssistantReply> {
  const current=await scope(form.get("institution"),form.get("role"));
  try {
    if (form.get("operation")!=="tutor") throw new WorkflowError("Choose a study topic.");
    const explanation=await explainTopic(current,form.get("topic"),form.get("request"));
    revalidatePath("/aura");
    return {heading:"Claude study explanation",lines:[explanation]};
  } catch(error) {
    if (error instanceof WorkflowError) return {error:error.message};
    if (error instanceof z.ZodError) return {error:"Choose a listed topic or enter a supported short academic question."};
    return {error:"The assistant could not confirm a response. Your academic records remain available through the workspace."};
  }
}
