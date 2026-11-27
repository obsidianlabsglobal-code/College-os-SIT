import { oneLine } from "./prepared-message";

/** The official-group template has no phone numbers, IDs, contact links or free-form reasons. */
export function attendanceGroupDraft(input:{
  course:string;section:string;date:string;time:string;timezone:string;faculty:string;
  roster:readonly {name:string;status:"present"|"absent"|null}[];
  fictionalPractice?:boolean;
}) {
  const absent=input.roster.filter(student=>student.status==="absent");
  const present=input.roster.filter(student=>student.status==="present").length;
  if (!input.roster.length || present+absent.length!==input.roster.length) return null;
  return [
    ...(input.fictionalPractice ? ["FICTIONAL PRACTICE — DO NOT POST"] : []),
    "Class attendance update",
    `Class: ${oneLine(input.course)} · ${oneLine(input.section)}`,
    `Date: ${oneLine(input.date)}`,
    `Time: ${oneLine(input.time)} (${oneLine(input.timezone)})`,
    `Faculty: ${oneLine(input.faculty)}`,
    `Roster: ${input.roster.length} · Present: ${present} · Absent: ${absent.length}`,
    ...(input.fictionalPractice ? [absent.length ? "Recorded absences:" : "Recorded absences: None"] : []),
    ...(input.fictionalPractice ? absent.map((row,i)=>`${i+1}. ${oneLine(row.name)}`) : []),
  ].join("\n");
}
