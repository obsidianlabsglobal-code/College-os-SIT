"use server";

import { revalidatePath } from "next/cache";
import { WorkflowError } from "../../lib/assignments";
import { addRelatedWords, removeRelatedWords } from "../../lib/search";
import { scope } from "../../lib/scope";
import type { ActionState } from "./workflow";

export async function searchAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const actor = await scope(form.get("institution"), form.get("role"));
  try {
    if (form.get("operation") === "related-add") await addRelatedWords(actor, form.get("words"));
    else if (form.get("operation") === "related-remove") await removeRelatedWords(actor, form.get("id"));
    else return { error: "This action is unavailable." };
  } catch (error) {
    if (error instanceof WorkflowError) return { error: error.message };
    if ((error as { name?: string }).name === "ZodError") return { error: "Enter 2 to 12 words separated by commas." };
    console.error("Search settings write failed", { code: (error as { code?: string }).code ?? "unknown" });
    return { error: "The change could not be confirmed. Refresh and try again." };
  }
  revalidatePath("/search");
  return { message: "Saved." };
}
