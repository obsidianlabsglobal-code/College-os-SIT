"use server";

import { revalidatePath } from "next/cache";
import { WorkflowError } from "../../lib/assignments";
import { giveFeedback, joinWaitlist, withdraw } from "../../lib/club-events";
import { postClubNotice, withdrawClubNotice } from "../../lib/club-notices";
import { addClubTask, completeClubTask } from "../../lib/club-tasks";
import { scope } from "../../lib/scope";
import type { ActionState } from "./workflow";

export async function clubEventAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const actor = await scope(form.get("institution"), form.get("role"));
  const input = Object.fromEntries(form);
  try {
    if (input.operation === "waitlist") await joinWaitlist(actor, input);
    else if (input.operation === "withdraw") await withdraw(actor, input);
    else if (input.operation === "feedback") await giveFeedback(actor, input);
    else if (input.operation === "notice") await postClubNotice(actor, input);
    else if (input.operation === "notice-withdraw") await withdrawClubNotice(actor, input);
    else if (input.operation === "task") await addClubTask(actor, input);
    else if (input.operation === "task-done") await completeClubTask(actor, input);
    else return { error: "This action is unavailable." };
  } catch (error) {
    if (error instanceof WorkflowError) return { error: error.message };
    if ((error as { name?: string }).name === "ZodError") return { error: "Check the required fields." };
    console.error("Club event write failed", { code: (error as { code?: string }).code ?? "unknown" });
    return { error: "The change could not be confirmed. Refresh and try again." };
  }
  revalidatePath("/clubverse", "layout");
  return { message: "Saved." };
}
