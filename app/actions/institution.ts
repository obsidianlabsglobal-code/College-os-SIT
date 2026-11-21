"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { scope } from "../../lib/scope";
import { changeInstitution, delegatedRoles } from "../../lib/institution";
import { WorkflowError } from "../../lib/assignments";
import type { ActionState } from "./workflow";

const name = z.string().trim().min(1).max(120);
const change = z.discriminatedUnion("operation",[
  z.object({ operation: z.enum(["department","scheme"]), name }),
  z.object({ operation: z.literal("term"), name, scheme: z.uuid() }),
  z.object({ operation: z.literal("grant"), account: z.string().min(1).max(128), role: z.enum(delegatedRoles), department: z.uuid().optional() }),
  z.object({ operation: z.literal("end"), membership: z.uuid() }),
]);

export async function institution(_state: ActionState, form: FormData): Promise<ActionState> {
  const current = await scope(form.get("institution"),form.get("role"));
  const input = change.safeParse({ ...Object.fromEntries(form), role: form.get("grant-role"), department: form.get("department") || undefined });
  if (!input.success) return { error: "Check the form and try again." };
  try {
    await changeInstitution(current,input.data);
  } catch (error) {
    if (error instanceof WorkflowError) return { error: error.message };
    const code = (error as { code?: string }).code;
    if (code === "23503") return { error: "A selected record is unavailable." };
    console.error("Institution setup write failed", { code: code ?? "unknown" });
    return { error: "The service could not confirm the change. Refresh to check its status." };
  }
  revalidatePath("/", "layout");
  return { message: "Saved." };
}
