import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "../page-header";
import { Chrome } from "../chrome";
import { account, scope, workspaceQuery } from "../../lib/scope";
import { auditEvents, parseAuditFilter } from "../../lib/reporting";

type Params = { institution?: string; role?: string; action?: string; actor?: string; from?: string; to?: string; page?: string };

// Audit viewer: metadata only. Records are linked by identifier; their contents stay behind each workflow's own checks.
export default async function AuditLog({ searchParams }: { searchParams: Promise<Params> }) {
  const [selection, user] = await Promise.all([searchParams, account()]);
  const current = await scope(selection.institution, selection.role);
  if (current.role !== "admin") notFound();
  const parsed = parseAuditFilter({ action: selection.action, actor: selection.actor, from: selection.from, to: selection.to, page: selection.page });
  const filter = parsed.success ? parsed.data : { action: "", actor: "", page: 1 };
  const result = await auditEvents(current, filter);
  if (!result) notFound();
  const query = workspaceQuery(current);
  const when = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Kolkata" });
  const pageLink = (page: number) => `/audit?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(query)),
    ...Object.fromEntries(Object.entries(filter).filter(([key, value]) => key !== "page" && value)), page: String(page) })}`;
  return <Chrome user={user} current={current} section="/audit">
    <PageHeader title="Audit log" parent={{ href: `/?${query}`, label: "Workspace" }} />
    <section className="panel stack" aria-labelledby="audit-filter">
      <h2 id="audit-filter">Search events</h2>
      <p className="meta">Shows who changed which record and when. Record contents, marks, messages and files are never shown here.</p>
      {!parsed.success && <p role="alert">Some filters were invalid and have been cleared.</p>}
      <form className="row" method="get">
        <input type="hidden" name="institution" value={current.institution} /><input type="hidden" name="role" value={current.role} />
        <label>Action starts with<input name="action" defaultValue={filter.action} placeholder="service_request." pattern="[a-z_.]*" maxLength={80} /></label>
        <label>Actor name<input name="actor" defaultValue={filter.actor} maxLength={120} /></label>
        <label>From<input type="date" name="from" defaultValue={filter.from} /></label>
        <label>To<input type="date" name="to" defaultValue={filter.to} /></label>
        <div><button className="button">Search</button></div>
      </form>
    </section>
    <section className="panel stack" aria-labelledby="audit-results">
      <h2 id="audit-results">Events{result.page > 1 ? ` · page ${result.page}` : ""}</h2>
      {result.rows.length ? <div className="table-scroll" role="region" aria-label="Audit events" tabIndex={0}><table>
        <thead><tr><th scope="col">When</th><th scope="col">Action</th><th scope="col">Actor</th><th scope="col">Record</th></tr></thead>
        <tbody>{result.rows.map(row => <tr key={row.id}>
          <td>{when.format(row.occurred_at)}</td><td><code>{row.action}</code></td>
          <td>{row.actor}{row.actor_role && <span className="meta"> · {row.actor_role}</span>}</td>
          <td><code>{row.entity_id.slice(0, 8)}</code>{row.revision !== null && <span className="meta"> · revision {row.revision}</span>}{row.ref && <span className="meta"> · {row.ref}</span>}</td>
        </tr>)}</tbody>
      </table></div> : <p>No events match these filters.</p>}
      <nav className="row" aria-label="Audit pages">
        {result.page > 1 && <Link href={pageLink(result.page - 1)}>Newer events</Link>}
        {result.more && <Link href={pageLink(result.page + 1)}>Older events</Link>}
      </nav>
    </section>
  </Chrome>;
}
