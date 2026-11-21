"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main className="shell hero" id="main"><h1>Workspace unavailable</h1><p>Check your connection and try again.</p><button className="button" onClick={reset}>Retry</button></main>;
}
