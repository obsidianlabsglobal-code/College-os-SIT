"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { WorkflowError } from "../../lib/assignments";
import { addProgrammeOutcome, decideCourseOutcome, proposeCourseOutcome, tagAssessment } from "../../lib/outcomes";
import { scope } from "../../lib/scope";
import type { ActionState } from "./workflow";

const messages: Record<string, string> = { programme: "Programme outcome added.", propose: "Sent to the department head.", decide: "Decision recorded.",
  tag: "Assessment tagged.", untag: "Tag removed." };

export async function outcomesAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const current = await scope(form.get("institution"), form.get("role"));
  const operation = String(form.get("operation"));
  const value = (name: string) => form.get(name) || undefined;
  try {
    if (operation === "programme") await addProgrammeOutcome(current, { code: value("code"), statement: value("statement") });
    else if (operation === "propose") await proposeCourseOutcome(current, { course: value("course"), code: value("code"), statement: value("statement"),
      mapping: form.getAll("po").map(String).filter(po => form.get(`level:${po}`)).map(po => ({ outcome: po, level: form.get(`level:${po}`) })) });
    else if (operation === "decide") await decideCourseOutcome(current, { outcome: value("outcome"), decision: value("decision"), reason: value("reason") });
    else if (operation === "tag" || operation === "untag") await tagAssessment(current, { assignment: value("assignment"), outcome: value("outcome"), tagged: operation === "tag" });
    else return { error: "This action is unavailable." };
  } catch (error) {
    if (error instanceof WorkflowError) return { error: error.message };
    if (error instanceof z.ZodError) return { error: "Check the code format (CO1, PO1), the statement and at least one mapped programme outcome." };
    console.error("Outcome write failed", { code: (error as { code?: string }).code ?? "unknown" });
    return { error: "Could not confirm the change. Refresh to check the current record." };
  }
  revalidatePath("/", "layout");
  return { message: messages[operation] };
}
