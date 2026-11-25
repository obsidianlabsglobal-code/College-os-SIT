"use client";

import { Icon } from "./experience/workspace-icon";
import type { ComponentProps } from "react";
import Link from "next/link";
import { useRef, useState } from "react";

type Destination = { href: string; label: string; icon: ComponentProps<typeof Icon>["name"]; active: boolean };

function DestinationLink({ item, secondary = false, onNavigate }: {
  item: Destination; secondary?: boolean; onNavigate?: () => void;
}) {
  return <Link href={item.href} aria-current={item.active ? "page" : undefined}
    className={secondary ? "nav-secondary" : undefined} onNavigate={onNavigate}>
    <Icon name={item.icon} /><span>{item.label}</span>
  </Link>;
}

export function WorkspaceNavigation({ role, items }: { role: string; items: Destination[] }) {
  const [collapsed, setCollapsed] = useState(false);
  const sheet = useRef<HTMLDialogElement>(null);
  const secondary = items.slice(4);
  return <aside className="app-sidebar" data-collapsed={collapsed}>
    <button className="button secondary sidebar-toggle" type="button" aria-controls="workspace-navigation"
      aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}>
      {collapsed ? "Show navigation" : "Hide navigation"}
    </button>
    <nav id="workspace-navigation" aria-label="Campus workflows">
      <p className="sidebar-role">{role}</p>
      {items.map((item, index) => <DestinationLink key={item.href} item={item} secondary={index >= 4} />)}
      {secondary.length > 0 && <button type="button" className="more-trigger" aria-haspopup="dialog"
        data-current={secondary.some(item=>item.active)} onClick={() => sheet.current?.showModal()}>
        <span aria-hidden="true">•••</span>More
      </button>}
    </nav>
    <dialog ref={sheet} aria-labelledby="workspace-menu-title" className="workspace-sheet">
      <div className="row spread"><h2 id="workspace-menu-title">{role} workspace</h2>
        <form method="dialog"><button className="button secondary">Close</button></form></div>
      <nav aria-label="More workflows">{secondary.map(item =>
        <DestinationLink key={item.href} item={item} onNavigate={() => sheet.current?.close()} />)}</nav>
    </dialog>
  </aside>;
}
