import { eventInput, type EventInput } from "../club-contracts";

export interface EventPlanProvider {
  id: string;
  prepare(input: EventInput, signal: AbortSignal): Promise<unknown>;
}

const deterministicProvider: EventPlanProvider = {
  id: "deterministic",
  async prepare(input, signal) {
    signal.throwIfAborted();
    return input;
  },
};

export const eventPlanner = {
  id: "clubverse.event-planner",
  version: 1,
  roles: ["student","faculty"],
  tools: { prepare: "prepare_event_plan", execute: "create_event_draft" },
  input: eventInput.strict(),
  output: eventInput.strict(),
  timeoutMs: 1000,
  maxToolCalls: 2,
  maxModelCalls: 0,
  approval: "task_owner_confirmation",
  provider: deterministicProvider,
} as const;
