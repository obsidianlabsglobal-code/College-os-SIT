import type { CapabilityName } from "./capabilities";

// Deterministic intent matching. A short request that names exactly one supported read is answered from the
// database with zero model calls. Anything longer, ambiguous or action-oriented is not guessed at here.

const patterns: { capability: CapabilityName; pattern: RegExp }[] = [
  { capability: "list_my_timetable", pattern: /\btimetable\b/ },
  { capability: "list_my_attendance", pattern: /\battendance\b/ },
  { capability: "list_published_feedback", pattern: /\b(feedback|results?|marks|grades?|scores?)\b/ },
  { capability: "list_pending_evaluations", pattern: /\b(pending (evaluations?|grading|submissions?)|evaluation queue|grading queue|to (grade|evaluate))\b/ },
  { capability: "list_my_assignments", pattern: /\b(assignments?|homework|due work|deadlines?)\b/ },
  { capability: "list_notices", pattern: /\b(notices?|announcements?|circulars?)\b/ },
  { capability: "list_my_requests", pattern: /\b(service requests?|my requests?|tickets?)\b/ },
  { capability: "list_clubs", pattern: /\b(clubs?|communities)\b/ },
];

const action = /\b(plan|organi[sz]e|create|book|reserve|schedule|write|draft|explain|why|how|help|compare|summari[sz]e|publish|delete|change|update|submit|cancel|approve)\b/;
const event = /\b(event|workshop|meetup|session|hackathon|seminar|talk)\b/;

export type Route =
  | { kind: "direct"; capability: CapabilityName }
  | { kind: "event" }
  | { kind: "interpret" };

export function routeMessage(message: string, allowed: readonly string[]): Route {
  const text = message.toLowerCase().replace(/\s+/g, " ").trim();
  const words = text.split(" ").length;
  if (action.test(text) && event.test(text)) return { kind: "event" };
  if (words > 12 || action.test(text)) return { kind: "interpret" };
  const matches = patterns.filter(entry => allowed.includes(entry.capability) && entry.pattern.test(text));
  // "pending grading" also contains "grading"; prefer the most specific single match for the caller's role.
  if (matches.length === 1) return { kind: "direct", capability: matches[0].capability };
  if (matches.length === 2 && matches.some(match => match.capability === "list_pending_evaluations")) {
    return { kind: "direct", capability: "list_pending_evaluations" };
  }
  return { kind: "interpret" };
}
