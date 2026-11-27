import { allocationProposals } from "./allocation";
import { caseKinds, cases, officeKinds } from "./cases";
import { corrections } from "./corrections";
import { departmentDelivery } from "./course-delivery";
import { requests } from "./connected";
import { developmentRecords, researchProjects } from "./faculty-records";
import { policyVersions } from "./policies";
import type { Scope } from "./scope";

// AD-018: one queue of records that need an action from the caller, drawn from each workflow's own read model and
// authority rules. Nothing here grants access; an item appears only if its source would already show it as actionable.
export type WorkItem = { source: string; title: string; detail: string; href: string; since: Date | null };

export async function myWork(scope: Scope, query: string): Promise<WorkItem[]> {
  const items: WorkItem[] = [];
  const caseItems = async () => {
    for (const kind of caseKinds[scope.role]) {
      for (const c of await cases(scope, kind)) {
        if (c.state !== "open" && c.state !== "in_progress") continue;
        const coordinator = officeKinds.includes(kind) ? scope.role === "admin" : scope.role === "hod";
        if (c.assigned_to === scope.account || (coordinator && !c.assigned_to))
          items.push({ source: "Case", title: c.title, detail: c.assigned_to ? `Assigned to you · ${c.state === "open" ? "not started" : "in progress"}` : "Needs an owner",
            href: `/cases?${query}&kind=${kind}`, since: c.created_at });
      }
    }
  };
  if (scope.role === "admin") {
    for (const r of await requests(scope, "all"))
      if ((r.status === "submitted" || r.status === "in_progress") && (r.assigned_to === scope.account || !r.assigned_to))
        items.push({ source: "Service request", title: r.description.slice(0, 80), detail: r.assigned_to ? "Assigned to you" : "Needs an owner",
          href: `/requests?${query}&view=${r.assigned_to ? "mine" : "unassigned"}`, since: r.created_at });
    for (const p of await allocationProposals(scope)) if (p.state === "proposed")
      items.push({ source: "Teaching allocation", title: `${p.faculty} → ${p.offering}`, detail: `Proposed by ${p.proposed_by}`, href: `/?${query}`, since: p.created_at });
    await caseItems();
  }
  if (scope.role === "hod") {
    for (const d of await departmentDelivery(scope)) if (d.plan === "submitted")
      items.push({ source: "Course plan", title: `${d.course} · ${d.section}`, detail: "Awaiting your approval", href: `/?${query}`, since: null });
    for (const r of await developmentRecords(scope)) if (r.state === "submitted")
      items.push({ source: "Development record", title: r.title, detail: `${r.faculty} · ${r.hours} h`, href: `/growth?${query}`, since: null });
    for (const p of await researchProjects(scope)) if (p.state === "proposed")
      items.push({ source: "Research proposal", title: p.title, detail: `Lead ${p.lead}`, href: `/growth?${query}`, since: null });
    await caseItems();
  }
  if (scope.role === "principal") {
    for (const v of await policyVersions(scope)) if (v.state === "draft")
      items.push({ source: "Policy", title: `${v.title} · version ${v.version}`, detail: "Awaiting your approval", href: `/policies?${query}`, since: null });
  }
  if (scope.role === "faculty") {
    for (const c of await corrections(scope))
      items.push({ source: "Attendance correction", title: `${c.course} · ${c.section}`, detail: c.student, href: `/timetable?${query}#corrections`, since: c.created_at });
    await caseItems();
  }
  return items.sort((a, b) => (a.since?.getTime() ?? 0) - (b.since?.getTime() ?? 0));
}
