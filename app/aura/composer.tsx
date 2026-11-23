"use client";

import { useActionState, useRef, useSyncExternalStore } from "react";
import { auraAction } from "../actions/aura";
import styles from "./aura.module.css";

const subscribe = () => () => undefined;

export function Composer({ institution, role, nonce, suggestions }: {
  institution: string; role: string; nonce: string; suggestions: string[];
}) {
  const ready = useSyncExternalStore(subscribe, () => true, () => false);
  const [state, invoke, pending] = useActionState(auraAction, {});
  const input = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  return <form ref={form} action={invoke} className={styles.composer} aria-describedby="aura-composer-help">
    <input type="hidden" name="institution" value={institution} />
    <input type="hidden" name="role" value={role} />
    <input type="hidden" name="operation" value="ask" />
    <input type="hidden" name="nonce" value={nonce} />
    <label htmlFor="aura-message">Ask AURA</label>
    <div className={styles.composerRow}>
      <input ref={input} id="aura-message" name="message" type="text" required maxLength={600} autoComplete="off"
        enterKeyHint="send" placeholder="e.g. my assignments" disabled={!ready || pending} />
      <button className="button" disabled={!ready || pending}>{pending ? "Checking…" : "Ask"}</button>
    </div>
    <p id="aura-composer-help" className="meta">Simple requests are answered straight from NEXUS records. Anything that changes a record waits for your confirmation.</p>
    <div className={styles.chips} aria-label="Suggested requests">
      {suggestions.map(text => <button key={text} type="button" className={styles.chip} disabled={!ready || pending}
        onClick={() => { if (input.current) input.current.value = text; form.current?.requestSubmit(); }}>{text}</button>)}
    </div>
    <p role="status" className={state.error ? "error" : "meta"}>{state.error ?? (pending ? "AURA is checking…" : "")}</p>
  </form>;
}
