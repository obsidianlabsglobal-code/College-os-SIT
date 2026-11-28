import { z } from "zod";
import { attendancePercentage, attendanceSummary, timetable } from "../academic-day";
import { studentAssignmentSummaries } from "../assignments";
import { publishedPolicies } from "../policies";
import type { Scope } from "../scope";

// AI-017 / AI-011 (local, no model): a plain-language question is routed by keywords to readers that already enforce the
// asker's membership and roster, and to the latest approved policy versions the asker's role may read, quoted with a
// citation. Nothing is generated: every line is a record or a quoted sentence, and every answer names its source.
export type AskAnswer = { heading: string; lines: string[]; source: string; path: string; action?: { label: string; path: string } };

const words = (text: string) => text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
const STOP = new Set(["a", "an", "the", "is", "are", "my", "me", "i", "do", "does", "how", "what", "when", "where", "which", "to", "of", "for", "and",
  "or", "in", "on", "at", "this", "that", "can", "get", "it", "be", "with", "about", "week", "today", "tomorrow", "please", "show", "tell", "next"]);
const topics = {
  due: ["due", "deadline", "deadlines", "assignment", "assignments", "homework", "submit", "submission", "lab3", "work"],
  where: ["where", "room", "lab", "class", "classes", "timetable", "schedule", "lecture"],
  attendance: ["attendance", "absent", "present", "shortage"],
  process: ["letter", "bonafide", "certificate", "enrollment", "enrolment", "request", "apply", "process", "policy", "rule", "rules", "leave", "fee", "fees"],
};
const matches = (tokens: string[], topic: keyof typeof topics) => tokens.some(t => (topics[topic] as readonly string[]).includes(t));

export async function askAura(scope: Scope, raw: string, timezone = "Asia/Kolkata"): Promise<AskAnswer[]> {
  const question = z.string().trim().min(2).max(200).parse(raw);
  const tokens = words(question);
  const format = new Intl.DateTimeFormat("en-IN", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" });
  const answers: AskAnswer[] = [];
  const now = Date.now(), week = now + 7 * 86400000;

  if (matches(tokens, "due") && scope.role === "student") {
    const due = (await studentAssignmentSummaries(scope)).filter(a => !a.submitted && +a.deadline >= now && +a.deadline <= week);
    answers.push({ heading: "Due in the next seven days", source: "Your published assignments", path: "/",
      lines: due.length ? due.map(a => `${a.title} · ${a.course} · due ${format.format(a.deadline)}`) : ["Nothing unsubmitted is due in the next seven days."] });
  }
  if (matches(tokens, "where") && (scope.role === "student" || scope.role === "faculty")) {
    const day = new Intl.DateTimeFormat("sv-SE", { timeZone: timezone, dateStyle: "short" }).format(new Date());
    const upcoming = (await timetable(scope, day, 7)).filter(s => +s.finish >= now && s.state !== "cancelled").slice(0, 3);
    answers.push({ heading: "Your next classes and rooms", source: "Your published timetable", path: "/timetable",
      lines: upcoming.length ? upcoming.map(s => `${format.format(s.start)} · ${s.course} · ${s.room}`) : ["No published classes in the next seven days."] });
  }
  if (matches(tokens, "attendance") && scope.role === "student") {
    const rows = await attendanceSummary(scope);
    answers.push({ heading: "Your recorded attendance", source: "Your attendance records", path: "/timetable",
      lines: rows.length ? rows.map(r => `${r.course} · ${r.present} of ${r.recorded} (${attendancePercentage(r.present, r.recorded)}%)`) : ["No attendance has been recorded yet."] });
  }
  if (matches(tokens, "process") || !answers.length) {
    const terms = tokens.filter(t => !STOP.has(t) && t.length > 2);
    const cited = (await publishedPolicies(scope)).map(p => {
      const sentences = p.body.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(Boolean);
      const hits = sentences.filter(s => terms.some(t => s.toLowerCase().includes(t)));
      const titleHit = terms.some(t => p.title.toLowerCase().includes(t));
      return { p, hits: hits.length ? hits : titleHit ? sentences.slice(0, 2) : [] };
    }).filter(x => x.hits.length).slice(0, 2);
    for (const { p, hits } of cited) answers.push({ heading: p.title, lines: hits.slice(0, 3), path: "/policies",
      source: `${p.title}, version ${p.version}, approved ${new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: timezone }).format(p.approved_at)}`,
      action: /letter|bonafide|enrol|certificate/.test(question.toLowerCase()) && scope.role === "student" ? { label: "Request a letter", path: "/requests" } : undefined });
    if (!cited.length && matches(tokens, "process"))
      answers.push({ heading: "No approved guidance found", source: "Published policies you can read", path: "/policies",
        lines: ["No approved policy you can read answers this. The office handles requests and letters."],
        action: scope.role === "student" ? { label: "Open service requests", path: "/requests" } : undefined });
  }
  if (!answers.length) answers.push({ heading: "I could not match that", source: "AURA local lookup", path: "/aura",
    lines: ["Try “what is due this week”, “where is my next class”, “my attendance” or “how do I get a bonafide letter”."] });
  return answers;
}
