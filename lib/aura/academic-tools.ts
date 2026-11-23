import { z } from "zod";
import { attendancePercentage, attendanceSummary, timetable } from "../academic-day";
import { studentAssignmentSummaries, WorkflowError } from "../assignments";
import type { Scope } from "../scope";

const commands = {
  timetable:["timetable","my timetable","show my timetable","what is my timetable"],
  attendance:["attendance","my attendance","show my attendance","what is my attendance"],
  assignments:["assignments","my assignments","show my assignments","what are my assignments"],
} as const;
export function academicIntent(raw: string) {
  const normalized = raw.trim().toLowerCase().replace(/[?.!]$/,"").replace(/\s+/g," ");
  return (Object.keys(commands) as (keyof typeof commands)[])
    .find(key=>commands[key].some(phrase=>phrase===normalized));
}

export async function answerAcademic(scope: Scope, question: string, timezone: string) {
  const tool = academicIntent(z.string().max(120).parse(question));
  if (!tool) throw new WorkflowError("Try “my timetable”, “my attendance” or “my assignments”.");
  if (scope.role !== "student" && !(scope.role === "faculty" && tool === "timetable"))
    throw new WorkflowError("This academic lookup is unavailable in this workspace.");
  const day = new Intl.DateTimeFormat("sv-SE",{timeZone:timezone,dateStyle:"short"}).format(new Date());
  const format = new Intl.DateTimeFormat("en-IN",{timeZone:timezone,dateStyle:"medium",timeStyle:"short"});
  if (tool === "timetable") {
    const rows = await timetable(scope,day,7);
    return {heading:"Your next seven days",path:"/timetable",lines:rows.map(s=>`${format.format(s.start)} · ${s.course} · ${s.room} · ${s.state}`)};
  }
  if (tool === "attendance") {
    const rows = await attendanceSummary(scope);
    return {heading:"Your recorded attendance",path:"/timetable",lines:rows.map(r=>`${r.course} · ${r.term} · ${r.present} of ${r.recorded} (${attendancePercentage(r.present,r.recorded)}%)`)};
  }
  const rows = await studentAssignmentSummaries(scope);
  return {heading:"Your published assignments",path:"/",lines:rows.map(a=>`${a.title} · ${a.course} · due ${format.format(a.deadline)} · ${a.submitted?"Submitted":"Awaiting submission"}`)};
}
