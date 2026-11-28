"use client";

import { useEffect, useRef } from "react";

// ID-014: the search bar in every workspace header. "/" focuses it from anywhere except while typing (Ctrl/Cmd+K stays the page palette).
export function GlobalSearch({ institution, role }: { institution: string; role: string }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = !!target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if (event.key === "/" && !typing && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return <form method="get" action="/search" role="search" className="global-search">
    <input type="hidden" name="institution" value={institution} /><input type="hidden" name="role" value={role} />
    <input ref={input} type="search" name="q" minLength={2} maxLength={120} required aria-label="Search College OS"
      placeholder="Search anything  ( / )" aria-keyshortcuts="/" />
  </form>;
}
