"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { WorkflowError } from "../../lib/assignments";
import { addCaseNote, assignCase, closeCase, openCase, startCase } from "../../lib/cases";
import { scope } from "../../lib/scope";
import type { ActionState } from "./workflow";

const messages: Record<string, string> = { open: "Case opened.", assign: "Case assigned.", start: "Case started.", note: "Note added.", close: "Case closed." };

export async function caseAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const current = await scope(form.get("institution"), form.get("role"));
  const operation = String(form.get("operation"));
  const value = (name: string) => form.get(name) ?? undefined;
  try {
    if (operation === "open") {
      const [student, department] = String(value("subject") ?? "").split("|");
      await openCase(current, { kind: value("kind"), student, department, title: value("title"), body: value("body") });
    } else if (operation === "assign") await assignCase(current, { case: value("case"), assignee: value("assignee") });
    else if (operation === "start") await startCase(current, value("case"));
    else if (operation === "note") await addCaseNote(current, { case: value("case"), body: value("body") });
    else if (operation === "close") await closeCase(current, { case: value("case"), outcome: value("outcome"), reason: value("reason") });
    else return { error: "This action is unavailable." };
  } catch (error) {
    if (error instanceof WorkflowError) return { error: error.message };
    if (error instanceof z.ZodError) return { error: "Check the required fields." };
    console.error("Case write failed", { code: (error as { code?: string }).code ?? "unknown" });
    return { error: "Could not confirm the change. Refresh to check the current record." };
  }
  revalidatePath("/", "layout");
  return { message: messages[operation] };
}
