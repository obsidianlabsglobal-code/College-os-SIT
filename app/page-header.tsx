import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({ title, context, parent }: {
  title: string;
  context?: ReactNode;
  parent?: { href: string; label: string };
}) {
  return <header className="hero">
    {parent && <nav aria-label="Breadcrumb" className="meta"><Link href={parent.href}>{parent.label}</Link></nav>}
    <h1>{title}</h1>
    {context && <p className="meta">{context}</p>}
  </header>;
}
