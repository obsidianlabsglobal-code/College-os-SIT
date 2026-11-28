import styles from "./aura.module.css";
import type { AuraRequest } from "../../lib/aura/assistant";

// AURA action capsule: shows only states that the database has recorded for this request. No optimistic steps.
const writeSteps = ["Proposed", "Preview saved", "Your approval", "Saved"] as const;
const readSteps = ["Understood", "Checked records", "Answered"] as const;

export function ActionCapsule({ request }: { request: AuraRequest }) {
  const write = request.capability === "prepare_event_draft" || request.task_id !== null;
  const steps: readonly string[] = write ? writeSteps : readSteps;
  let reached: number;
  if (write) {
    reached = request.state === "succeeded" ? 3 : request.state === "awaiting_confirmation" ? (request.task_state === "awaiting_approval" ? 2 : 1) : request.state === "prepared" ? 0 : -1;
  } else {
    reached = request.state === "succeeded" ? 2 : request.state === "executing" ? 1 : request.state === "interpreting" || request.state === "created" ? 0 : -1;
  }
  const stopped = request.state === "failed" || request.state === "cancelled";
  return <ol className={styles.capsule} aria-label="Task progress" data-stopped={stopped || undefined}>
    {steps.map((step, index) => <li key={step} data-state={index < reached ? "done" : index === reached ? (index === steps.length - 1 ? "done" : "current") : "pending"}
      aria-current={index === reached && index < steps.length - 1 ? "step" : undefined}>
      <span aria-hidden="true" />{step}
    </li>)}
    {stopped && <li data-state="stopped"><span aria-hidden="true" />{request.state === "cancelled" ? "Cancelled" : "Stopped"}</li>}
  </ol>;
}
