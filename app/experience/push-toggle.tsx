"use client";

import { useEffect, useState } from "react";
import { subscribePush, unsubscribePush } from "../actions/push";

const keyBytes = (key: string) => Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((key.length + 3) % 4)), c => c.charCodeAt(0));

/** Turns phone notifications on or off for this device. Without browser support the in-app view still shows alerts. */
export function PushToggle({ publicKey, context }: { publicKey: string; context: { institution: string; role: string } }) {
  const [state, setState] = useState<"checking" | "unsupported" | "off" | "on" | "blocked">("checking");
  const [error, setError] = useState("");
  useEffect(() => {
    // Browser capabilities are only known on the client; resolve them asynchronously after mount.
    Promise.resolve().then(async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported" as const;
      if (Notification.permission === "denied") return "blocked" as const;
      return (await (await navigator.serviceWorker.ready).pushManager.getSubscription()) ? "on" as const : "off" as const;
    }).then(setState, () => setState("unsupported"));
  }, []);
  const turnOn = async () => {
    setError("");
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
      const saved = await subscribePush(context, subscription.endpoint);
      if (!saved.ok) { await subscription.unsubscribe(); setError(saved.error); return; }
      setState("on");
    } catch {
      setState(Notification.permission === "denied" ? "blocked" : "off");
      setError("Notifications were not turned on.");
    }
  };
  const turnOff = async () => {
    const subscription = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
    await subscription?.unsubscribe();
    await unsubscribePush(context);
    setState("off");
  };
  return <div className="stack" aria-live="polite">
    {state === "unsupported" && <p className="meta">This browser cannot show phone notifications. On iPhone, add NEXUS to the home screen first. Alerts still appear inside the app.</p>}
    {state === "blocked" && <p className="meta">Notifications are blocked for this site in the browser settings. Alerts still appear inside the app.</p>}
    {state === "off" && <div><button type="button" className="button secondary" onClick={turnOn}>Turn on bus alerts on this phone</button></div>}
    {state === "on" && <div className="row"><span className="tag">Phone alerts on</span><button type="button" className="button secondary" onClick={turnOff}>Turn off</button></div>}
    {error && <p role="alert" className="error">{error}</p>}
  </div>;
}
