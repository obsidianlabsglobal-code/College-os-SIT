"use server";

import { revalidatePath } from "next/cache";
import { WorkflowError } from "../../../lib/assignments";
import { changeResource } from "../../../lib/resource-booking";
import { resourceInput } from "../../../lib/resource-contracts";
import { scope } from "../../../lib/scope";
import type { ActionState } from "../../actions/workflow";

export async function resourceAction(_state:ActionState,form:FormData):Promise<ActionState> {
  const actor = await scope(form.get("institution"),form.get("role"));
  const parsed = resourceInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) return {error:"Check the required fields and try again."};
  try {
    await changeResource(actor,parsed.data);
  } catch (error) {
    if (error instanceof WorkflowError) return {error:error.message};
    console.error("Booking action failed",{code:(error as {code?:string}).code ?? "unknown"});
    return {error:"The change could not be confirmed. Refresh before retrying."};
  }
  revalidatePath("/clubverse","layout");
  return {message:"Saved."};
}
