"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createAssignment, publishAssignment, submitAssignment, updateGrade, WorkflowError } from "../../lib/assignments";
import { parseUpload } from "../../lib/files";
import { scope, workspaceQuery } from "../../lib/scope";

export type ActionState = { error?: string; message?: string };

const id = z.uuid();
const required = (label: string, length: number) => z.string().trim().min(1, `Enter ${label}.`).max(length);
const integer = (label: string, min: number, max: number) => z.string().regex(/^\d+$/, `Enter valid ${label}.`)
  .transform(Number).pipe(z.number().int().min(min).max(max));

async function upload(value: FormDataEntryValue | null) {
  try {
    return await parseUpload(value);
  } catch (error) {
    throw new WorkflowError((error as Error).message);
  }
}

export async function workflow(_state: ActionState, form: FormData): Promise<ActionState> {
  const current = await scope(form.get("institution"), form.get("role"));
  let destination: string | undefined;

  try {
    const operation = form.get("operation");
    if (operation === "create") {
      const created = await createAssignment(current, {
        offering: id.parse(form.get("offering")),
        title: required("a title", 160).parse(form.get("title")),
        description: required("instructions", 10000).parse(form.get("description")),
        deadline: z.iso.datetime({ local: true, precision: -1 }).refine(value => !value.endsWith("Z")).parse(form.get("deadline")),
        marks: integer("maximum marks", 1, 10000).parse(form.get("marks")),
        rubric: z.string().trim().max(8000).parse(form.get("rubric")) || undefined,
        file: await upload(form.get("file")),
      });
      destination = `/assignments/${created}?${workspaceQuery(current)}`;
    } else {
      const assignment = id.parse(form.get("assignment"));
      if (operation === "publish") {
        await publishAssignment(current, assignment);
      } else if (operation === "submit") {
        await submitAssignment(current, assignment, id.parse(form.get("request")), z.string().trim().max(20000).parse(form.get("body")), await upload(form.get("file")));
      } else if (operation === "grade" || operation === "publish-grade") {
        await updateGrade(current, {
          assignment,
          submission: id.parse(form.get("submission")),
          expected: integer("revision", 0, 2147483646).parse(form.get("revision")),
          expectedDraft: z.enum(["true","false"]).parse(form.get("is-draft")) === "true",
          publish: operation === "publish-grade",
          ...(operation === "grade" && {
            marks: integer("marks", 0, 10000).parse(form.get("marks")),
            feedback: required("feedback", 8000).parse(form.get("feedback")),
            reason: z.string().trim().max(1000).parse(form.get("reason") ?? ""),
          }),
        });
      } else {
        throw new WorkflowError("This action is unavailable.");
      }
    }
  } catch (error) {
    if (error instanceof WorkflowError) return { error: error.message };
    if (error instanceof z.ZodError) return { error: error.issues[0]?.message ?? "Check the form and try again." };
    console.error("Assignment write failed", { code: (error as { code?: string }).code ?? "unknown" });
    return { error: "The service could not confirm the change. Retry or refresh to check the current status." };
  }

  revalidatePath("/", "layout");
  if (destination) redirect(destination);
  return { message: "Saved." };
}
