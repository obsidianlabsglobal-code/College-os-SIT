"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { WorkflowError } from "../../lib/assignments";
import { addResource, decidePlan, recordDelivery, reviseResource, savePlan, submitPlan, withdrawResource } from "../../lib/course-delivery";
import { parseUpload } from "../../lib/files";
import { addMentoringRecord, agreeGoal, assignMentor } from "../../lib/mentoring";
import { scope } from "../../lib/scope";
import type { ActionState } from "./workflow";

const messages: Record<string, string> = {
  "resource-add": "Material published to the course.", "resource-revise": "New version published.", "resource-withdraw": "Material withdrawn.",
  "plan-save": "Plan draft saved.", "plan-submit": "Plan sent to the department head.", "plan-decide": "Decision recorded.",
  delivery: "Class delivery recorded.", "mentor-assign": "Mentor assigned.", "mentor-record": "Mentoring note recorded.", "goal-agree": "Goal marked agreed.",
};

/** Course delivery and mentoring writes. Authorization and validation live in the domain services. */
export async function courseAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const current = await scope(form.get("institution"), form.get("role"));
  const operation = String(form.get("operation"));
  const value = (name: string) => form.get(name) ?? undefined;
  try {
    const file = async () => { try { return await parseUpload(form.get("file")); } catch (error) { throw new WorkflowError((error as Error).message); } };
    switch (operation) {
      case "resource-add": await addResource(current, { offering: value("offering"), title: value("title"), note: value("note") || undefined }, await file()); break;
      case "resource-revise": await reviseResource(current, { resource: value("resource"), note: value("note") }, await file()); break;
      case "resource-withdraw": await withdrawResource(current, String(value("resource"))); break;
      case "plan-save": await savePlan(current, { offering: value("offering"),
        topics: String(value("topics") ?? "").split(/\r?\n/).map(line => line.trim()).filter(Boolean) }); break;
      case "plan-submit": await submitPlan(current, String(value("offering"))); break;
      case "plan-decide": await decidePlan(current, { offering: value("offering"), decision: value("decision"), reason: value("reason") }); break;
      case "delivery": await recordDelivery(current, { session: value("session"), item: value("item") || undefined, summary: value("summary") }); break;
      case "mentor-assign": await assignMentor(current, { student: value("student"), mentor: value("mentor") }); break;
      case "mentor-record": await addMentoringRecord(current, { assignment: value("assignment"), kind: value("kind"), body: value("body") }); break;
      case "goal-agree": await agreeGoal(current, value("record")); break;
      default: return { error: "This action is unavailable." };
    }
  } catch (error) {
    if (error instanceof WorkflowError) return { error: error.message };
    if (error instanceof z.ZodError) return { error: "Check the required fields." };
    console.error("Course write failed", { code: (error as { code?: string }).code ?? "unknown" });
    return { error: "Could not confirm the change. Refresh to check the current record." };
  }
  revalidatePath("/", "layout");
  return { message: messages[operation] };
}
