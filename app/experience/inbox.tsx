import Link from "next/link";
import type { Scope } from "../../lib/scope";
import { ActionForm } from "../forms";
import { automation } from "../actions/automation";
import styles from "./inbox.module.css";

type Item = { id: string; kind: string; entity_id: string; title: string; created_at: Date; read_at: Date | null };
const target = (item: Item, query: string) =>
  ["assignment", "reminder", "result"].includes(item.kind) ? `/assignments/${item.entity_id}?${query}`
  : item.kind === "class" || item.kind === "attendance" ? `/timetable?${query}&session=${item.entity_id}#class-details`
  : item.kind === "case" ? `/cases?${query}`
  : item.kind === "correction" ? `/timetable?${query}#corrections`
  : item.kind === "escalation" ? `/automation?${query}` : `/requests?${query}`;

/** Automation inbox shared by every role. Items are already access-checked by `notifications()`. */
export function Inbox({ items, current, query, title, timezone, className }: {
  items: Item[]; current: Scope; query: string; title: string; timezone: string; className?: string;
}) {
  if (!items.length) return null;
  const unread = items.filter(item => !item.read_at).length;
  const format = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: timezone });
  return <section className={`${styles.inbox} ${className ?? ""}`} aria-labelledby="inbox-title">
    <div className={styles.head}>
      <h2 id="inbox-title">{title}</h2>
      <p>{unread ? `${unread} unread` : "All read"} · prepared automatically from current records</p>
    </div>
    <ul>{items.slice(0, 6).map(item => <li key={item.id} data-unread={!item.read_at || undefined}>
      <div>
        <Link href={target(item, query)}>{item.title}</Link>
        <p><time dateTime={item.created_at.toISOString()}>{format.format(item.created_at)}</time>{item.read_at ? " · Read" : ""}</p>
      </div>
      {!item.read_at && <ActionForm action={automation} context={current} operation="read-notification" label="Mark read" secondary>
        <input type="hidden" name="id" value={item.id} />
      </ActionForm>}
    </li>)}</ul>
  </section>;
}
