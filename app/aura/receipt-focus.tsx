"use client";

import { useEffect } from "react";

// Client-side route changes can update the hash before the server-rendered receipt is mounted.
export function ReceiptFocus({latest}: {latest?: string}) {
  useEffect(() => {
    const focusReceipt = () => {
      const id = window.location.hash.slice(1);
      if (/^aura-request-[a-f0-9-]{36}$/.test(id)) document.getElementById(id)?.focus();
    };
    focusReceipt();
    window.addEventListener("hashchange", focusReceipt);
    return () => window.removeEventListener("hashchange", focusReceipt);
  }, [latest]);
  return null;
}
