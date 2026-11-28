"use client";

import { useEffect, useState } from "react";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/** Registers the offline-page service worker and offers installation where the browser allows it. */
export function InstallApp() {
  const [install, setInstall] = useState<InstallEvent | null>(null);
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    const offer = (event: Event) => { event.preventDefault(); setInstall(event as InstallEvent); };
    const done = () => setInstall(null);
    window.addEventListener("beforeinstallprompt", offer);
    window.addEventListener("appinstalled", done);
    return () => { window.removeEventListener("beforeinstallprompt", offer); window.removeEventListener("appinstalled", done); };
  }, []);
  if (!install) return null;
  return <button type="button" className="button secondary" onClick={async () => { await install.prompt(); await install.userChoice; setInstall(null); }}>Install app</button>;
}
