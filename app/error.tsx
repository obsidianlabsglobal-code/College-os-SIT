"use client";

export default function ErrorPage() {
  return <main className="shell hero" id="main"><h1>Workspace unavailable</h1><p>Check your connection and try again.</p><button className="button" onClick={() => window.location.reload()}>Retry</button></main>;
}
