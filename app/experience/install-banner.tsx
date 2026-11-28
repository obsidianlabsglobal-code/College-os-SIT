"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";

// ID-016: whenever College OS runs in a browser tab rather than the installed app, invite the person to install it.
// "Not now" hides it for this visit only (sessionStorage); it never shows inside the installed app.
const noSubscribe = () => () => {};
function inBrowserTab() {
  const installed = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  try { return !installed && sessionStorage.getItem("nexus-install-dismissed") !== "1"; } catch { return !installed; }
}
export function InstallBanner() {
  const eligible = useSyncExternalStore(noSubscribe, inBrowserTab, () => false);  // false on the server: no hydration mismatch
  const [closed, setClosed] = useState(false);
  const show = eligible && !closed;
  if (!show) return null;
  return <aside className="install-banner row" aria-label="Install College OS">
    <span>Get NEXUS as an app for alerts and one-tap access.</span>
    <Link className="button" href="/get-app">How to install</Link>
    <button type="button" className="button secondary" onClick={() => { try { sessionStorage.setItem("nexus-install-dismissed", "1"); } catch { /* ignore */ } setClosed(true); }}>Not now</button>
  </aside>;
}
