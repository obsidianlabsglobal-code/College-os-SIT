"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eventInput } from "../../lib/club-contracts";
import { scope } from "../../lib/scope";
import { decideEventPlan, prepareEventPlan } from "../../lib/aura/tasks";
import { WorkflowError } from "../../lib/assignments";
import type { ActionState } from "./workflow";

export async function auraAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const actor = await scope(form.get("institution"),form.get("role"));
  const operation = form.get("operation");
  try {
    if (operation === "preview") {
      await prepareEventPlan(actor,eventInput.parse(Object.fromEntries(form)));
    } else if (operation === "confirm" || operation === "cancel") {
      await decideEventPlan(actor,z.uuid().parse(form.get("id")),operation === "confirm" ? "confirmed" : "cancelled");
    } else {
      return { error: "This AURA operation is unavailable." };
    }
  } catch (error) {
    if (error instanceof WorkflowError) return { error: error.message };
    if (error instanceof z.ZodError) return { error: "Check the event details, schedule and capacity." };
    console.error("AURA task write failed", { code: (error as { code?:string }).code ?? "unknown" });
    return { error: "The task could not be confirmed. Refresh to check its saved status." };
  }
  revalidatePath("/","layout");
  return { message:operation === "preview" ? "Preview saved for review." : operation === "confirm" ? "Event draft saved." : "Preview cancelled." };
}
