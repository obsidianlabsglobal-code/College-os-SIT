import type { AssignmentProgress, EvaluationState } from "../../lib/faculty";

export function formatDate(value: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(value);
}

/** Plain-language publication status. The second value explains what the status means for the professor. */
export function assignmentStatus(row: Pick<AssignmentProgress, "published_at" | "accepting">): { label: string; tone: "neutral" | "attention"; detail?: string } {
  if (!row.published_at && row.accepting) {
    return { label: "Not published", tone: "attention", detail: "Students cannot see this assignment until you publish it." };
  }
  if (!row.published_at) {
    return { label: "Deadline passed before publication", tone: "attention", detail: "Students never received it, and it can no longer be published. Create a new assignment with a future deadline if it is still needed." };
  }
  return { label: row.accepting ? "Open for submissions" : "Closed", tone: "neutral" };
}

export const actionLabels: Record<EvaluationState, string> = {
  pending: "Evaluate",
  draft: "Review draft",
  correction: "Review correction",
  published: "View result",
};

export function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

export function href(path: string, query: string, params: Record<string, string | number | undefined> = {}) {
  const search = new URLSearchParams(query);
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") search.set(key, String(value));
  return `${path}?${search.toString()}`;
}
