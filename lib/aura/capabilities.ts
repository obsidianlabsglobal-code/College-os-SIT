import { db } from "../db";
import { answerAcademic } from "./academic-tools";
import { z } from "zod";
import { studentAssignmentSummaries, assignments } from "../assignments";
import { evaluationTotals } from "../faculty";
import { notices, requests } from "../connected";
import { clubs } from "../club-views";
import type { Scope } from "../scope";

// The typed catalog of what AURA can actually do. Every entry wraps an existing role- and tenant-scoped domain
// service; AURA adds no authority of its own. Anything not listed here is reported as unsupported.

export type CapabilityItem = { title: string; detail: string; href?: string };
export type CapabilityResult = { summary: string; items: CapabilityItem[]; source: string; checkedAt: string };
type Role = "student" | "faculty";

type Capability = {
  name: string; label: string; description: string; roles: readonly Role[];
  risk: "read" | "confirm_write";
  input: z.ZodType<Record<string, never>>;
  run?: (scope: Scope & { role: Role }, query: string) => Promise<CapabilityResult>;
};

const none = z.object({}).strict() as z.ZodType<Record<string, never>>;
const limit = 10;
const dateText = (value: Date, timezone = "Asia/Kolkata") =>
  new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(value);
const result = (summary: string, items: CapabilityItem[], source: string): CapabilityResult =>
  ({ summary, items: items.slice(0, limit), source, checkedAt: new Date().toISOString() });

export const capabilities = [
  ...(["timetable","attendance"] as const).map(tool=>({
    name:tool==="timetable" ? "list_my_timetable" as const : "list_my_attendance" as const,
    label:tool==="timetable" ? "My timetable" : "My attendance",
    description:tool==="timetable" ? "Read the next seven days of your class schedule." : "Read your current recorded attendance.",
    roles:tool==="timetable"?["student","faculty"] as const:["student"] as const, risk:"read" as const,input:none,
    async run(scope:Scope,query:string) {
      const {rows:[institution]}=await db.query<{timezone:string}>("SELECT timezone FROM institution WHERE id=$1",[scope.institution]);
      const answer=await answerAcademic(scope,tool,institution.timezone);
      return result(answer.lines.length ? answer.heading : "No matching records in your workspace.",
        answer.lines.map(line=>({title:line,detail:"Open timetable",href:answer.path+"?"+query})),answer.heading);
    },
  })),
  {
    name: "list_my_assignments", label: "My assignments",
    description: "List published assignments in the caller's active courses (faculty: assignments in courses they teach).",
    roles: ["student","faculty"], risk: "read", input: none,
    async run(scope, query) {
      if (scope.role === "student") {
        const rows = await studentAssignmentSummaries(scope);
        const open = rows.filter(row => row.accepting && !row.submitted);
        return result(
          rows.length ? `${rows.length} published assignment${rows.length === 1 ? "" : "s"}; ${open.length} open and not yet submitted.` : "You have no published assignments in your active courses.",
          [...open, ...rows.filter(row => !open.includes(row))].map(row => ({
            title: row.title,
            detail: `${row.course} · ${row.section} · Due ${dateText(row.deadline)} · ${row.submitted ? "Submitted" : row.accepting ? "Not submitted" : "Closed without submission"}`,
            href: `/assignments/${row.id}?${query}`,
          })), "Assignments in your active course rosters");
      }
      const rows = await assignments(scope);
      return result(rows.length ? `${rows.length} assignment${rows.length === 1 ? "" : "s"} in courses you teach.` : "No assignments in courses you currently teach.",
        rows.map(row => ({ title: row.title, detail: `${row.course} · ${row.section} · ${row.published_at ? "Published" : "Not published"} · Due ${dateText(row.deadline, row.timezone)}`, href: `/assignments/${row.id}?${query}` })),
        "Assignments in your active teaching rosters");
    },
  },
  {
    name: "list_published_feedback", label: "Published results",
    description: "List the caller's own assignments that have a published result and feedback.",
    roles: ["student"], risk: "read", input: none,
    async run(scope, query) {
      const rows = (await studentAssignmentSummaries(scope)).filter(row => row.result_published_at !== null);
      return result(rows.length ? `${rows.length} assignment${rows.length === 1 ? " has" : "s have"} a published result.` : "No results have been published for you yet.",
        rows.map(row => ({ title: row.title, detail: `${row.course} · ${row.section} · Result published`, href: `/assignments/${row.id}?${query}` })),
        "Your submissions with published grades");
    },
  },
  {
    name: "list_pending_evaluations", label: "Evaluation queue",
    description: "Count submissions awaiting evaluation or publication in courses the caller teaches.",
    roles: ["faculty"], risk: "read", input: none,
    async run(scope, query) {
      const totals = await evaluationTotals(scope);
      return result(`${totals.pending} submission${totals.pending === 1 ? "" : "s"} awaiting evaluation; ${totals.awaiting} feedback draft${totals.awaiting === 1 ? "" : "s"} awaiting publication.`,
        [
          { title: "Awaiting evaluation", detail: String(totals.pending), href: `/grading?${query}&status=pending` },
          { title: "Awaiting publication", detail: String(totals.awaiting), href: `/grading?${query}&status=awaiting` },
        ], "Submissions in your active teaching rosters");
    },
  },
  {
    name: "list_notices", label: "Notices",
    description: "List the latest published notices the caller is allowed to see.",
    roles: ["student","faculty"], risk: "read", input: none,
    async run(scope, query) {
      const rows = await notices(scope, "published", limit);
      return result(rows.length ? `Latest ${rows.length} published notice${rows.length === 1 ? "" : "s"} for you.` : "There are no published notices for you.",
        rows.map(row => ({ title: row.title, detail: `${row.audience} · ${row.author}${row.published_at ? ` · ${dateText(row.published_at)}` : ""}`, href: `/notices?${query}` })),
        "Notices addressed to your institution, departments or courses");
    },
  },
  {
    name: "list_my_requests", label: "My service requests",
    description: "List the caller's own service requests and their status.",
    roles: ["student"], risk: "read", input: none,
    async run(scope, query) {
      const rows = await requests(scope);
      return result(rows.length ? `${rows.length} service request${rows.length === 1 ? "" : "s"}; ${rows.filter(row => row.status === "open" || row.status === "in_progress").length} still open.` : "You have not raised any service requests.",
        rows.map(row => ({ title: row.description.slice(0, 120), detail: `Status: ${row.status.replaceAll("_", " ")}${row.outcome ? ` · ${row.outcome.slice(0, 120)}` : ""}`, href: `/requests?${query}` })),
        "Service requests you raised");
    },
  },
  {
    name: "list_clubs", label: "Clubs",
    description: "List recognized clubs the caller can see.",
    roles: ["student","faculty"], risk: "read", input: none,
    async run(scope, query) {
      const { recognized } = await clubs(scope, "", "");
      return result(recognized.length ? `${recognized.length} recognized club${recognized.length === 1 ? "" : "s"} you can browse.` : "No recognized clubs are visible to you.",
        recognized.map(row => ({ title: row.name, detail: row.category, href: `/clubverse/${row.id}?${query}` })),
        "Recognized clubs open to your role");
    },
  },
  {
    // Executed only through the existing preview -> owner confirmation -> saveEventDraft path in tasks.ts.
    name: "prepare_event_draft", label: "Plan a club event",
    description: "Prepare an editable private event draft for a club the caller officiates. Never books a room or publishes.",
    roles: ["student","faculty"], risk: "confirm_write", input: none,
  },
] as const satisfies readonly Capability[];

export type CapabilityName = typeof capabilities[number]["name"];
export const capabilityNames = capabilities.map(item => item.name) as [CapabilityName, ...CapabilityName[]];

export function capabilitiesFor(role: Scope["role"]) {
  return capabilities.filter(item => (item.roles as readonly string[]).includes(role));
}

export function findCapability(name: string, role: Scope["role"]) {
  return capabilitiesFor(role).find(item => item.name === name) ?? null;
}
