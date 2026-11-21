"use client";

import { useActionState, useSyncExternalStore, type ReactNode } from "react";
import type { Scope } from "../lib/scope";
import type { ActionState } from "./actions/workflow";

const subscribe = () => () => undefined;
const clientReady = () => true;
const serverReady = () => false;

export function ActionForm({
  action, context, operation, children, label, secondary = false,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  context?: Pick<Scope, "institution" | "role">;
  operation?: string;
  children?: ReactNode;
  label: string;
  secondary?: boolean;
}) {
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady);
  const [state, invoke, pending] = useActionState(action, {});
  return (
    <form action={invoke} className="form">
      {context && <><input type="hidden" name="institution" value={context.institution} /><input type="hidden" name="role" value={context.role} /></>}
      {operation && <input type="hidden" name="operation" value={operation} />}
      <fieldset disabled={!ready || pending} className="form-fields">
        {children}
        <div><button className={secondary ? "button secondary" : "button"}>{pending ? "Saving…" : label}</button></div>
      </fieldset>
      {state.error && <p className="error" role="alert">{state.error}</p>}
      {state.message && <p className="success" role="status">{state.message}</p>}
    </form>
  );
}
