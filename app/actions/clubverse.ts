"use server";

import { revalidatePath } from "next/cache";
import { clubInput } from "../../lib/club-contracts";
import { changeClub } from "../../lib/clubverse";
import { WorkflowError } from "../../lib/assignments";
import { scope } from "../../lib/scope";
import type { ActionState } from "./workflow";

export async function clubAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const actor = await scope(form.get("institution"),form.get("role"));
  const parsed = clubInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Check the required fields, event times and capacity." };
  try {
    await changeClub(actor,parsed.data);
  } catch (error) {
    if (error instanceof WorkflowError) return { error: error.message };
    const code = (error as { code?: string }).code;
    if (code === "23505") return { error: "This record already exists. Refresh to check its status." };
    if (code === "23503") return { error: "A selected record is unavailable." };
    console.error("CLUBVERSE write failed", { code: code ?? "unknown" });
    return { error: "The change could not be confirmed. Refresh and try again." };
  }
  revalidatePath("/clubverse","layout");
  return { message: "Saved." };
}
