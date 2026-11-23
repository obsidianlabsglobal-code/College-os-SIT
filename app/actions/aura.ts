"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eventInput } from "../../lib/club-contracts";
import { scope } from "../../lib/scope";
import { decideEventPlan, prepareEventPlan } from "../../lib/aura/tasks";
import { askAura } from "../../lib/aura/assistant";
import { WorkflowError } from "../../lib/assignments";
import type { ActionState } from "./workflow";

export async function auraAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const actor = await scope(form.get("institution"),form.get("role"));
  const operation = form.get("operation");
  try {
    if (operation === "ask") {
      await askAura(actor,{ message:form.get("message") ?? "",nonce:form.get("nonce") ?? "",allowModel:form.get("allowModel")==="on" });
    } else if (operation === "preview" || operation === "proposal") {
      const fields = Object.fromEntries([...form].filter(([key]) => !["institution","role","operation","request"].includes(key)));
      await prepareEventPlan(actor,eventInput.parse(fields),operation === "proposal" ? z.uuid().parse(form.get("request")) : undefined);
    } else if (operation === "confirm" || operation === "cancel") {
      await decideEventPlan(actor,z.uuid().parse(form.get("id")),operation === "confirm" ? "confirmed" : "cancelled");
    } else {
      return { error: "This AURA operation is unavailable." };
    }
  } catch (error) {
    if (error instanceof WorkflowError) return { error: error.message };
    if (error instanceof z.ZodError) {
      return { error: operation === "ask" ? error.issues[0]?.message ?? "Type a request." : "Check the event details, schedule and capacity." };
    }
    console.error("AURA action failed", { operation: String(operation), code: (error as { code?:string }).code ?? "unknown" });
    return { error: "AURA could not finish this. Refresh to check its saved status." };
  }
  revalidatePath("/","layout");
  if (operation === "ask") return { message: "Done. The answer is at the top of your conversation." };
  return { message:operation === "preview" || operation === "proposal" ? "Preview saved for your confirmation." : operation === "confirm" ? "Event draft saved." : "Preview cancelled." };
}
