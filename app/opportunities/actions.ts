"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { changeOpportunity } from "../../lib/opportunities";
import { scope } from "../../lib/scope";
import { WorkflowError } from "../../lib/assignments";
import type { ActionState } from "../actions/workflow";

export async function opportunityAction(_state:ActionState,form:FormData):Promise<ActionState> {
  const current=await scope(form.get("institution"),form.get("role"));
  try {
    await changeOpportunity(current,Object.fromEntries(form));
  } catch(error) {
    if (error instanceof WorkflowError) return {error:error.message};
    if (error instanceof z.ZodError) return {error:"Check the required fields, official HTTPS link, deadline and verification."};
    return {error:"The change could not be confirmed. Reload the directory to check its current state."};
  }
  revalidatePath("/opportunities");
  return {message:form.get("operation")==="publish" ? "Listing published." : "Listing withdrawn."};
}
