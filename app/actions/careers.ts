"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { WorkflowError } from "../../lib/assignments";
import { recordOutcome, saveApplication, trackListing, withdrawApplication } from "../../lib/careers";
import { scope } from "../../lib/scope";
import type { ActionState } from "./workflow";

const messages: Record<string, string> = { track: "Saved to My applications.", draft: "Draft saved.", submit: "Application marked as submitted.",
  withdraw: "Application withdrawn.", outcome: "Outcome recorded." };

export async function careersAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const current = await scope(form.get("institution"), form.get("role"));
  const operation = String(form.get("operation"));
  const value = (name: string) => form.get(name) || undefined;
  try {
    if (operation === "track") await trackListing(current, value("listing"));
    else if (operation === "draft" || operation === "submit") await saveApplication(current, { listing: value("listing"), statement: String(form.get("statement") ?? ""), submit: operation === "submit" });
    else if (operation === "withdraw") await withdrawApplication(current, value("listing"));
    else if (operation === "outcome") await recordOutcome(current, { listing: value("listing"), student: value("student"), outcome: value("outcome"), note: value("note") });
    else return { error: "This action is unavailable." };
  } catch (error) {
    if (error instanceof WorkflowError) return { error: error.message };
    if (error instanceof z.ZodError) return { error: "Check the required fields." };
    console.error("Careers write failed", { code: (error as { code?: string }).code ?? "unknown" });
    return { error: "Could not confirm the change. Refresh to check the current record." };
  }
  revalidatePath("/", "layout");
  return { message: messages[operation] };
}
