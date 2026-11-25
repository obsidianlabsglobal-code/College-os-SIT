import type { Scope } from "../../lib/scope";

// Match only a validated record in the same institutional workspace in both documents.
export function recordTransition(scope: Scope, entity: "session" | "assignment", id: string) {
  return { viewTransitionName: `record-${scope.institution}-${scope.role}-${entity}-${id}` };
}
