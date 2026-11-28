import Link from "next/link";
import { PageHeader } from "../page-header";
import { Chrome } from "../chrome";
import { account, scope, workspaceQuery } from "../../lib/scope";
import { search } from "../../lib/search";

export default async function Search({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [params, user] = await Promise.all([searchParams, account()]);
  const current = await scope(params.institution, params.role);
  const q = (params.q ?? "").trim().slice(0, 120);
  const hits = q.length >= 2 ? await search(current, q) : [];
  const query = workspaceQuery(current);
  const link = (path: string) => { const [base, hash] = path.split("#"); return `${base}?${query}${hash ? `#${hash}` : ""}`; };
  return <Chrome user={user} current={current} section="/search">
    <PageHeader title="Search" parent={{ href: `/?${query}`, label: "Workspace" }}
      context="One search across notices and circulars, college dates, verified opportunities, approved policies and support services. You only see what you could open on each page." />
    <section className="panel stack" aria-labelledby="search-title">
      <h2 id="search-title" className="sr-only">Search</h2>
      <form method="get" className="row">
        <input type="hidden" name="institution" value={current.institution} /><input type="hidden" name="role" value={current.role} />
        <label>Search for<input type="search" name="q" maxLength={120} minLength={2} defaultValue={q} required /></label>
        <button className="button">Search</button>
      </form>
    </section>
    {q.length >= 2 && <section className="panel stack" aria-labelledby="results-title">
      <h2 id="results-title">{hits.length ? `${hits.length} ${hits.length === 1 ? "result" : "results"}` : "No results"}</h2>
      {hits.length > 0 && <ul className="items">{hits.map((h, i) => <li key={i}><article aria-label={h.title} className="stack">
        <div className="row spread"><h3><Link href={link(h.path)}>{h.title}</Link></h3><span className="tag">{h.kind}</span></div>
        <p className="meta">{h.detail}</p></article></li>)}</ul>}
    </section>}
  </Chrome>;
}
