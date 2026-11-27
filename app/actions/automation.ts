"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { WorkflowError } from "../../lib/assignments";
import { cancelJob, markNotificationRead, retryJob, setRuleState } from "../../lib/automation";
import { scope } from "../../lib/scope";
import type { ActionState } from "./workflow";

export async function automation(_state: ActionState, form: FormData): Promise<ActionState> {
  const current = await scope(form.get("institution"), form.get("role"));
  try {
    const operation = form.get("operation");
    if (operation === "read-notification") await markNotificationRead(current, z.uuid().parse(form.get("id")));
    else if (operation === "rule-state") await setRuleState(current, z.string().max(80).parse(form.get("rule")),
      z.enum(["active", "paused", "disabled"]).parse(form.get("state")));
    else if (operation === "retry-job" || operation === "cancel-job")
      await (operation === "retry-job" ? retryJob : cancelJob)(current, z.string().regex(/^\d{1,18}$/).parse(form.get("id")));
    else throw new WorkflowError("This action is unavailable.");
  } catch (error) {
    if (error instanceof WorkflowError) return { error: error.message };
    if (error instanceof z.ZodError) return { error: "Check the form and try again." };
    console.error("Automation write failed", { code: (error as { code?: string }).code ?? "unknown" });
    return { error: "The service could not confirm the change. Refresh to check its status." };
  }
  revalidatePath("/", "layout");
  return { message: "Saved." };
}
