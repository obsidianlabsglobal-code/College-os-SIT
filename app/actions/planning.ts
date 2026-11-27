"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { WorkflowError } from "../../lib/assignments";
import { cancelExam, draftExam, publishExam } from "../../lib/exams";
import { createAction, updateAction } from "../../lib/improvement";
import { scope } from "../../lib/scope";
import type { ActionState } from "./workflow";

const messages: Record<string, string> = { "exam-draft": "Sitting drafted.", "exam-publish": "Sitting published.", "exam-cancel": "Sitting cancelled.",
  "action-create": "Action created.", "action-update": "Progress recorded." };

export async function planningAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const current = await scope(form.get("institution"), form.get("role"));
  const operation = String(form.get("operation"));
  const value = (name: string) => form.get(name) || undefined;
  try {
    if (operation === "exam-draft") await draftExam(current, { offering: value("offering"), kind: value("kind"), title: value("title"), start: value("start"),
      end: value("end"), room: value("room"), invigilator: value("invigilator"), source: value("source") });
    else if (operation === "exam-publish") await publishExam(current, { exam: value("exam"), revision: Number(value("revision")) });
    else if (operation === "exam-cancel") await cancelExam(current, { exam: value("exam"), reason: value("reason") });
    else if (operation === "action-create") {
      const [owner, department] = String(value("owner") ?? "").split("|");
      await createAction(current, { title: value("title"), measure: value("measure"), owner, department: department || undefined, due: value("due") });
    } else if (operation === "action-update") await updateAction(current, { action: value("action"), progress: value("progress"), note: value("note"), close: value("close") });
    else return { error: "This action is unavailable." };
  } catch (error) {
    if (error instanceof WorkflowError) return { error: error.message };
    if (error instanceof z.ZodError) return { error: error.issues.find(i => !i.message.startsWith("Invalid") && !i.message.startsWith("Too"))?.message ?? "Check the required fields." };
    console.error("Planning write failed", { code: (error as { code?: string }).code ?? "unknown" });
    return { error: "Could not confirm the change. Refresh to check the current record." };
  }
  revalidatePath("/", "layout");
  return { message: messages[operation] };
}
