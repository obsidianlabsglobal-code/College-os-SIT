"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { changeCatalog } from "../../lib/academics";
import { WorkflowError } from "../../lib/assignments";
import { scope } from "../../lib/scope";
import type { ActionState } from "./workflow";

const name = z.string().trim().min(1).max(120);
const uuid = z.uuid();
const roster = { offering: uuid, account: z.string().min(1).max(128), role: z.enum(["student", "faculty"]) };
const schema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("course"), name, department: uuid }),
  z.object({ operation: z.literal("section"), name }),
  z.object({ operation: z.literal("offering"), course: uuid, section: uuid, term: uuid }),
  z.object({ operation: z.literal("add-roster"), ...roster }),
  z.object({ operation: z.literal("end-roster"), ...roster }),
]);

export async function catalog(_state: ActionState, form: FormData): Promise<ActionState> {
  const current = await scope(form.get("institution"), form.get("role"));
  const data = schema.safeParse({ ...Object.fromEntries(form), role: form.get("roster-role") });
  if (!data.success) return { error: "Check the catalog selections and try again." };
  try {
    await changeCatalog(current,data.data);
  } catch (error) {
    if (error instanceof WorkflowError) return { error: error.message };
    const code = (error as { code?: string }).code;
    if (code === "23503") return { error: "A selected record is unavailable." };
    if (code === "23505") return { error: "This course offering already exists." };
    console.error("Catalog write failed", { code: code ?? "unknown" });
    return { error: "The service could not confirm the change. Refresh and try again." };
  }
  revalidatePath("/", "layout");
  return { message: "Saved." };
}
