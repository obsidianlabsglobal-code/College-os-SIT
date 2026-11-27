"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { savePlanningTarget } from "../../lib/attendance-planning";
import { changeClass } from "../../lib/academic-day";
import { decideCorrection, requestCorrection } from "../../lib/corrections";
import { WorkflowError } from "../../lib/assignments";
import { scope, workspaceQuery } from "../../lib/scope";
import type { ActionState } from "../actions/workflow";

export async function timetableAction(_state:ActionState, form:FormData):Promise<ActionState> {
  const current = await scope(form.get("institution"),form.get("role"));
  const operation = form.get("operation");
  let session: string;
  try {
    if (operation === "target") {
      const percent = form.get("percent");
      await savePlanningTarget(current,{
        offering:form.get("offering"), revision:Number(form.get("revision") ?? NaN),
        percent:percent === "" ? null : Number(percent), source:form.get("source"),
      });
      revalidatePath("/timetable");
      return {message:"Planning target saved."};
    }
    if (operation === "correction-request" || operation === "correction-decide") {
      if (operation === "correction-request") await requestCorrection(current,{session:form.get("session"),reason:form.get("reason")});
      else await decideCorrection(current,{correction:form.get("correction"),decision:form.get("decision"),reason:form.get("reason")});
      revalidatePath("/", "layout");
      return {message:operation === "correction-request" ? "Correction request sent to your teacher." : "Decision recorded."};
    }
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
  return {message:operation==="attendance" ? "Attendance saved." : operation==="move-room" ? "Room change published to the timetable. No external message was sent." : "Schedule updated."};
}
