"use client";

import { useClientReady } from "./use-client-ready";

import { useId, useRef, type ReactNode } from "react";

export function ContextSheet({label, title, children}: {label: string; title: string; children: ReactNode}) {
  const ready = useClientReady();
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useId();
  return <>
    <button className="button secondary" type="button" aria-haspopup="dialog" disabled={!ready} onClick={() => ref.current?.showModal()}>{label}</button>
    <dialog className="context-sheet" ref={ref} aria-labelledby={heading}>
      <div className="row spread"><h2 id={heading}>{title}</h2>
        <form method="dialog"><button className="button secondary">Close</button></form></div>
      {children}
    </dialog>
  </>;
}
