import type { Scope } from "./scope";

const demoInstitution = "10000000-0000-4000-8000-000000000001";
const persona: Partial<Record<Scope["role"],string>> = {
  student:"student", hod:"hod", admin:"admin", principal:"principal",
};
export function feesPreviewAvailable(current:Scope, user:{id:string;email?:string}) {
  const alias = persona[current.role];
  return process.env.NEXUS_FEES_PREVIEW === "true" && current.institution === demoInstitution &&
    current.account === user.id && !!alias && user.email === `${alias}@nexus.example.invalid`;
}
export const studentExample = [
  {name:"College fees", billed:38000, paid:38000, due:null},
  {name:"Transport fees", billed:8000, paid:0, due:"20 December"},
  {name:"Hostel fees", billed:12000, paid:6000, due:"20 December"},
  {name:"Other fees", billed:1500, paid:1500, due:null},
] as const;
export const studentTotals = studentExample.reduce((sum,f)=>({billed:sum.billed+f.billed,paid:sum.paid+f.paid}),{billed:0,paid:0});
// Explicit fictional aggregate fixtures. They are not computed from a live ledger.
const departmentExamples = [
  {department:"Electronics and Communication Engineering", billed:566000, paid:489900},
  {department:"Mechanical Engineering", billed:440000, paid:398000},
] as const;
export function feesAggregateExample(role:"hod"|"admin"|"principal"): ReadonlyArray<{department:string;billed:number;paid:number}> {
  return role === "hod" ? departmentExamples.slice(0,1) : departmentExamples;
}
