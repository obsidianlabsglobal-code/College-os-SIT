"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { WorkflowError } from "../../lib/assignments";
import { applyTeacherImport, previewTeacherImport } from "../../lib/roster-import";
import { decideJoinRequests, requestToJoin } from "../../lib/student-admission";
import { acceptNotice, setConsentRequired } from "../../lib/consent";
import { account, scope, workspaceQuery } from "../../lib/scope";
import type { ActionState } from "./workflow";

const fail = (error: unknown, fallback = "Check the required fields."): ActionState => {
  if (error instanceof WorkflowError) return { error: error.message };
  if (error instanceof z.ZodError) return { error: fallback };
  console.error("Onboarding write failed", { code: (error as { code?: string }).code ?? "unknown" });
  return { error: "Could not confirm the change. Refresh to check the current record." };
};

/** ID-012: preview a teacher CSV (a file or pasted text); nothing but the preview is stored. */
export async function previewImportAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const current = await scope(form.get("institution"), form.get("role"));
  const file = form.get("file");
  const text = file instanceof File && file.size ? await file.text() : String(form.get("csv") ?? "");
  let id: string;
  try { id = (await previewTeacherImport(current, text)).id; } catch (error) { return fail(error, "The file could not be read as CSV."); }
  redirect(`/admin/roster-import?${workspaceQuery(current)}&import=${id}`);
}

export async function applyImportAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const current = await scope(form.get("institution"), form.get("role"));
  try {
    const added = await applyTeacherImport(current, form.get("import"));
    revalidatePath("/", "layout");
    return { message: `${added} ${added === 1 ? "teacher" : "teachers"} added. They can now sign in with an email code.` };
  } catch (error) { return fail(error); }
}

export async function requestJoinAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const user = await account();
  const value = (name: string) => { const v = form.get(name); return typeof v === "string" && v.trim() ? v : undefined; };
  try {
    await requestToJoin({ id: user.id, email: user.email, emailVerified: !!(user as { emailVerified?: boolean }).emailVerified, name: user.name },
      { institution: value("institution"), name: value("name"), usn: value("usn"), semester: value("semester"), section: value("section"), phone: value("phone") });
  } catch (error) { return fail(error, "Check your USN (letters and digits), semester, section and phone."); }
  revalidatePath("/join/student");
  return { message: "Request sent. Your class mentor or a teacher of your section will check it." };
}

export async function decideJoinAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const current = await scope(form.get("institution"), form.get("role"));
  const requests = form.getAll("request").map(String);
  const decision = form.get("decision") === "rejected" ? "rejected" : "approved";
  if (!requests.length) return { error: "Select at least one request." };
  try {
    const count = await decideJoinRequests(current, { requests, decision, reason: String(form.get("reason") ?? "").trim() || undefined });
    revalidatePath("/", "layout");
    return { message: `${count} ${count === 1 ? "request" : "requests"} ${decision}.` };
  } catch (error) { return fail(error); }
}

export async function acceptNoticeAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const current = await scope(form.get("institution"), form.get("role"));
  try { await acceptNotice(current, form.get("version")); } catch (error) { return fail(error); }
  redirect(`/?${workspaceQuery(current)}`);
}

export async function consentRequiredAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const current = await scope(form.get("institution"), form.get("role"));
  try { await setConsentRequired(current, form.get("required") === "true"); } catch (error) { return fail(error); }
  revalidatePath("/", "layout");
  return { message: "Saved." };
}
