"use client";

import { useActionState, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Scope } from "../lib/scope";
import type { ActionState } from "./actions/workflow";

const subscribe = () => () => undefined;
const clientReady = () => true;
const serverReady = () => false;

export function ActionForm({
  action, context, operation, children, label, secondary = false, confirmation,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  context?: Pick<Scope, "institution" | "role">;
  operation?: string;
  children?: ReactNode;
  label: string;
  secondary?: boolean;
  confirmation?: string;
}) {
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady);
  const [state, invoke, pending] = useActionState(action, {});
  const review = useRef<HTMLDialogElement>(null);
  const authorizedSubmit = useRef(false);
  const [values,setValues] = useState<string[]>([]);
  const reviewId = useId();
  return (
    <form action={invoke} className="form" aria-busy={pending} onSubmit={event => {
      if (!confirmation || authorizedSubmit.current) {
        authorizedSubmit.current = false;
        return;
      }
      event.preventDefault();
      const selections = Array.from(event.currentTarget.querySelectorAll("select"))
        .filter(select => select.value).map(select => select.selectedOptions[0].text);
      setValues(selections);
      review.current?.showModal();
    }}>
      {context && <><input type="hidden" name="institution" value={context.institution} /><input type="hidden" name="role" value={context.role} /></>}
      {operation && <input type="hidden" name="operation" value={operation} />}
      <fieldset disabled={!ready || pending} className="form-fields">
        {children}
        <div><button className={secondary ? "button secondary" : "button"}>{pending ? "Saving…" : label}</button></div>
      </fieldset>
      {confirmation && <dialog className="review-dialog" ref={review} aria-labelledby={reviewId}>
        <h2 id={reviewId}>Review access change</h2>
        <p>{confirmation}</p>
        {values.length > 0 && <p className="review-selection">{values.join(" · ")}</p>}
        <div className="row">
          <button className="button secondary" type="button" onClick={() => review.current?.close()}>Cancel</button>
          <button className="button" type="button" onClick={event => {
            const form = event.currentTarget.form;
            review.current?.close();
            if (!form || !form.reportValidity()) return;
            authorizedSubmit.current = true;
            form.requestSubmit();
          }}>Confirm change</button>
        </div>
      </dialog>}
      {!pending && state.error && <p className="error" role="alert">{state.error}</p>}
      {!pending && state.message && <p className="success" role="status">{state.message}</p>}
    </form>
  );
}
