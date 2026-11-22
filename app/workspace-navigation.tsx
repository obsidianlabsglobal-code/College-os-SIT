"use client";

import Link from "next/link";
import { useState } from "react";

export function WorkspaceNavigation({ role, items }: {
  role: string;
  items: { href: string; label: string; active: boolean }[];
}) {
  const [collapsed, setCollapsed] = useState(false);
  return <aside className="app-sidebar" data-collapsed={collapsed}>
    <button className="button secondary sidebar-toggle" type="button" aria-controls="workspace-navigation"
      aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}>
      {collapsed ? "Show navigation" : "Hide navigation"}
    </button>
    <nav id="workspace-navigation" aria-label="Campus workflows">
      <p className="sidebar-role">{role}</p>
      {items.map(item => <Link key={item.href} href={item.href}
        aria-current={item.active ? "page" : undefined}>{item.label}</Link>)}
    </nav>
  </aside>;
}
