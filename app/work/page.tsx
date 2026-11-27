import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "../page-header";
import { Chrome } from "../chrome";
import { account, scope, workspaceQuery } from "../../lib/scope";
import { myWork } from "../../lib/work";

export default async function Work({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [params, user] = await Promise.all([searchParams, account()]);
  const current = await scope(params.institution, params.role);
  if (current.role === "student") notFound();
  const query = workspaceQuery(current);
  const items = await myWork(current, query);
  const when = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" });
  const groups = [...Map.groupBy(items, i => i.source)];
  return <Chrome user={user} current={current} section="/work">
    <PageHeader title="My work" parent={{ href: `/?${query}`, label: "Workspace" }}
      context="Everything waiting on you across requests, cases, approvals and reviews, oldest first. Each item opens in its own workflow." />
    <section className="panel stack" aria-labelledby="work-title">
      <h2 id="work-title">{items.length ? `${items.length} ${items.length === 1 ? "item needs" : "items need"} your action` : "Nothing is waiting on you"}</h2>
      {groups.map(([source, rows]) => <section key={source} aria-label={source} className="stack">
        <h3>{source} · {rows.length}</h3>
        <ul className="items">{rows.map((item, n) => <li key={n}><Link href={item.href}>{item.title}</Link>
          <p className="meta">{item.detail}{item.since && ` · since ${when.format(item.since)}`}</p></li>)}</ul>
      </section>)}
    </section>
  </Chrome>;
}
