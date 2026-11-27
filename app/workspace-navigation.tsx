"use client";

import { useClientReady } from "./experience/use-client-ready";

import { Icon } from "./experience/workspace-icon";
import type { ComponentProps } from "react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

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
  const ready = useClientReady();
  const [collapsed, setCollapsed] = useState(false);
  const sheet = useRef<HTMLDialogElement>(null);
  const palette = useRef<HTMLDialogElement>(null);
  const [search, setSearch] = useState("");
  const router = useRouter();
  const secondary = items.slice(4);
  const matches = items.filter(item => item.label.toLowerCase().includes(search.trim().toLowerCase()));
  const openPalette = () => { sheet.current?.close(); setSearch(""); palette.current?.showModal(); };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); openPalette(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return <aside className="app-sidebar" data-collapsed={collapsed}>
    <button className="button secondary sidebar-toggle" type="button" aria-controls="workspace-navigation"
      aria-expanded={!collapsed} disabled={!ready} onClick={() => setCollapsed(value => !value)}>
      {collapsed ? "Show navigation" : "Hide navigation"}
    </button>
    <button className="button secondary sidebar-toggle" type="button" aria-haspopup="dialog" aria-keyshortcuts="Control+K"
      disabled={!ready} onClick={openPalette}>Find a page <kbd>Ctrl K</kbd></button>
    <nav id="workspace-navigation" aria-label="Campus workflows">
      <p className="sidebar-role">{role} workspace</p>
      {items.map((item, index) => <DestinationLink key={item.href} item={item} secondary={index >= 4} />)}
      {secondary.length > 0 && <button type="button" className="more-trigger" aria-haspopup="dialog" disabled={!ready}
        data-current={secondary.some(item=>item.active)} onClick={() => sheet.current?.showModal()}>
        <span aria-hidden="true">•••</span>More
      </button>}
    </nav>
    <dialog ref={sheet} aria-labelledby="workspace-menu-title" className="workspace-sheet">
      <div className="row spread"><h2 id="workspace-menu-title">{role} workspace</h2>
        <form method="dialog"><button className="button secondary">Close</button></form></div>
      <nav aria-label="More workflows">{secondary.map(item =>
        <DestinationLink key={item.href} item={item} onNavigate={() => sheet.current?.close()} />)}</nav>
      <button type="button" className="button secondary" onClick={openPalette}>Find a page</button>
    </dialog>
    <dialog ref={palette} aria-labelledby="palette-title" className="workspace-sheet">
      <div className="row spread"><h2 id="palette-title">Find a page</h2>
        <form method="dialog"><button className="button secondary">Close</button></form></div>
      <form role="search" onSubmit={event => { event.preventDefault(); if (matches[0]) { palette.current?.close(); router.push(matches[0].href); } }}>
        <label>Page name<input type="search" value={search} autoFocus autoComplete="off" aria-controls="palette-results"
          onChange={event => setSearch(event.target.value)} /></label>
      </form>
      <nav id="palette-results" aria-label="Matching pages">{matches.length ? matches.map(item =>
        <DestinationLink key={item.href} item={item} onNavigate={() => palette.current?.close()} />) : <p>No page matches “{search}”.</p>}</nav>
    </dialog>
  </aside>;
}
