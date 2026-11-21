"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { advanceRequest, createRequest, draftNotice, publishNotice } from "../../lib/connected";
import { WorkflowError } from "../../lib/assignments";
import { scope } from "../../lib/scope";
import type { ActionState } from "./workflow";

export async function connected(_state: ActionState, form: FormData): Promise<ActionState> {
  const current = await scope(form.get("institution"),form.get("role"));
  try {
    switch (form.get("operation")) {
      case "draft-notice":
        await draftNotice(current,z.string().trim().min(1).max(160).parse(form.get("title")),
          z.string().trim().min(1).max(8000).parse(form.get("body")),
          z.uuid().optional().parse(form.get("target") ?? undefined));
        break;
      case "publish-notice":
        await publishNotice(current,z.uuid().parse(form.get("id")));
        break;
      case "create-request":
        await createRequest(current,z.string().trim().min(1).max(4000).parse(form.get("description")));
        break;
      case "advance-request":
        await advanceRequest(current,z.uuid().parse(form.get("id")),
          z.enum(["in_progress","resolved","declined"]).parse(form.get("status")),
          z.string().trim().max(4000).optional().parse(form.get("outcome") ?? undefined));
        break;
      default:
        throw new WorkflowError("This action is unavailable.");
    }
  } catch (error) {
    if (error instanceof WorkflowError) return { error: error.message };
    if (error instanceof z.ZodError) return { error: "Check the form and try again." };
    console.error("Campus workflow write failed", { code: (error as { code?: string }).code ?? "unknown" });
    return { error: "The service could not confirm the change. Refresh to check its status." };
  }
  revalidatePath("/", "layout");
  return { message: "Saved." };
}
