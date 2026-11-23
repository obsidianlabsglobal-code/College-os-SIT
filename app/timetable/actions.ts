"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { changeClass } from "../../lib/academic-day";
import { WorkflowError } from "../../lib/assignments";
import { scope, workspaceQuery } from "../../lib/scope";
import type { ActionState } from "../actions/workflow";

export async function timetableAction(_state:ActionState, form:FormData):Promise<ActionState> {
  const current = await scope(form.get("institution"),form.get("role"));
  const operation = form.get("operation");
  let session: string;
  try {
    const [offering,faculty] = String(form.get("teaching") ?? "").split("|");
    const marks = [...form.entries()].filter(([name])=>name.startsWith("mark:"))
      .map(([name,value])=>({student:name.slice(5),status:value}));
    session = await changeClass(current,{
      operation,offering,faculty,room:form.get("room"),session:form.get("session"),
      start:form.get("start"),end:form.get("end"),weeks:Number(form.get("weeks")),
      revision:Number(form.get("revision") ?? NaN),reason:form.get("reason") ?? "",marks,
    });
  } catch (error) {
    if (error instanceof WorkflowError) return {error:error.message};
    if (error instanceof z.ZodError) return {error:"Check the required fields and attendance marks."};
    console.error("Class write failed",{code:(error as {code?:string}).code ?? "unknown"});
    return {error:"Could not confirm the change. Refresh to check the current record."};
  }
  revalidatePath("/", "layout");
  if (operation==="draft" || operation==="move") redirect(`/timetable?${workspaceQuery(current)}&session=${session}`);
  return {message:operation==="attendance" ? "Attendance saved." : "Schedule updated."};
}
