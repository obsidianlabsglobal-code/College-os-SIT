import Link from "next/link";
import { PageHeader } from "../page-header";
import { Chrome, transportBuilt } from "../chrome";
import { ActionForm } from "../forms";
import { searchAction } from "../actions/search";
import { account, scope, workspaceQuery } from "../../lib/scope";
import { feesPreviewAvailable } from "../../lib/fees-preview";
import { recentSearches, relatedWords, rememberSearch, RELATED, search, type Intent, type SearchHit } from "../../lib/search";

export default async function Search({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [params, user] = await Promise.all([searchParams, account()]);
  const current = await scope(params.institution, params.role);
  const q = (params.q ?? "").trim().slice(0, 120);
  const extra: Intent[] = [
    ...(transportBuilt ? [{ words: ["bus", "transport", "route", "stop", "my bus"], title: "My bus and stop", path: "/transport" }] : []),
    ...(feesPreviewAvailable(current, user) ? [{ words: ["fee", "fees", "payment"], title: "Fees", path: "/fees" }] : []),
  ];
  const result = q.length >= 2 ? await search(current, q, extra) : null;
  if (result) await rememberSearch(current, q);
  const [recent, own] = await Promise.all([recentSearches(current), relatedWords(current)]);
  const query = workspaceQuery(current);
  const link = (path: string) => { const [base, hash] = path.split("#"); return `${base}${base.includes("?") ? "&" : "?"}${query}${hash ? `#${hash}` : ""}`; };
  const groups = new Map<string, SearchHit[]>();
  for (const hit of result?.hits ?? []) groups.set(hit.kind, [...(groups.get(hit.kind) ?? []), hit]);
  const total = result?.hits.length ?? 0;
  return <Chrome user={user} current={current} section="/search">
    <PageHeader title="Search" parent={{ href: `/?${query}`, label: "Workspace" }}
      context="Find notices, dates, events, courses, assignments, people, cases, policies and services. Typos and related words still match. You only see what you could open on each page." />
    <section className="panel stack" aria-labelledby="search-title">
      <h2 id="search-title" className="sr-only">Search</h2>
      <form method="get" className="row" role="search">
        <input type="hidden" name="institution" value={current.institution} /><input type="hidden" name="role" value={current.role} />
        <label>Search for<input type="search" name="q" maxLength={120} minLength={2} defaultValue={q} required /></label>
        <button className="button">Search</button>
      </form>
      {!q && recent.length > 0 && <nav aria-label="Recent searches" className="row">
        <span className="meta">Recent:</span>{recent.map(r => <Link key={r} href={`/search?${query}&q=${encodeURIComponent(r)}`}>{r}</Link>)}</nav>}
    </section>
    {result && <section className="panel stack" aria-labelledby="results-title">
      <h2 id="results-title">{total ? `${total} ${total === 1 ? "result" : "results"}` : "No results"}</h2>
      {result.didYouMean && <p>Did you mean <Link href={`/search?${query}&q=${encodeURIComponent(result.didYouMean)}`}>{result.didYouMean}</Link>?</p>}
      {[...groups].map(([kind, hits]) => <section key={kind} aria-label={kind} className="stack">
        <h3>{kind}</h3>
        <ul className="items">{hits.map((h, i) => <li key={i}><article aria-label={h.title} className="stack">
          <div className="row spread"><h4><Link href={link(h.path)}>{h.title}</Link></h4><span className="tag">{h.kind}</span></div>
          <p className="meta">{h.detail}</p></article></li>)}</ul>
      </section>)}
    </section>}
    {current.role === "admin" && <section className="panel stack" aria-labelledby="related-title">
      <h2 id="related-title">Related words</h2>
      <p className="meta">Words that should find each other in search. Built in: {RELATED.map(g => g.join(" / ")).join("; ")}.</p>
      {own.length > 0 && <ul className="items">{own.map(g => <li key={g.id}>{g.words.join(" / ")}
        <ActionForm action={searchAction} context={current} operation="related-remove" label="Remove" secondary><input type="hidden" name="id" value={g.id} /></ActionForm></li>)}</ul>}
      <ActionForm action={searchAction} context={current} operation="related-add" label="Add related words">
        <label>Words, separated by commas<input name="words" required maxLength={400} placeholder="e.g. seminar hall, auditorium" /></label>
      </ActionForm>
    </section>}
  </Chrome>;
}
