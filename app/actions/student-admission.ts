"use server";

import { revalidatePath } from "next/cache";
import { WorkflowError } from "../../lib/assignments";
import { onboardingPreviewEnabled } from "../../lib/onboarding-preview";
import { scope } from "../../lib/scope";
import { approvePreviewStudent, revokePreviewStudent } from "../../lib/student-admission";
import type { ActionState } from "./workflow";

export async function studentAdmission(_state: ActionState, form: FormData): Promise<ActionState> {
  if (!onboardingPreviewEnabled()) return { error: "Onboarding preview is unavailable." };
  const current = await scope(form.get("institution"),form.get("role"));
  try {
    switch (form.get("operation")) {
      case "approve":
        await approvePreviewStudent(current,{ email: form.get("email"), section: form.get("section"), term: form.get("term") });
        break;
      case "revoke":
        await revokePreviewStudent(current,form.get("admission"));
        break;
      default:
        return { error: "Check the form and try again." };
    }
  } catch (error) {
    if (error instanceof WorkflowError) return { error: error.message };
    console.error("Student admission preview change failed", { code: (error as { code?: string }).code ?? "unknown" });
    return { error: "The service could not confirm the change. Refresh to check its status." };
  }
  revalidatePath("/admin");
  return { message: form.get("operation") === "approve" ? "Fictional approval saved." : "Fictional approval revoked." };
}
