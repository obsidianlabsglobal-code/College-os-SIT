import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "./actions/session";

export function Chrome({ name, children }: { name: string; children: ReactNode }) {
  return <div className="shell">
    <header className="top">
      <Link href="/" className="brand">NEXUS</Link>
      <div className="row"><span className="meta">{name}</span><form action={signOut}><button className="button secondary">Sign out</button></form></div>
    </header>
    <main id="main" tabIndex={-1}>{children}</main>
  </div>;
}
