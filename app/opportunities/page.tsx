import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { account,scope,workspaceQuery,workspaces } from "../../lib/scope";
import { directoryFilters,kinds,opportunities } from "../../lib/opportunities";
import { Chrome } from "../chrome";
import { ActionForm } from "../forms";
import { ExperienceHeading } from "../experience/heading";
import { opportunityAction } from "./actions";

export default async function Directory({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}) {
  const [params,user]=await Promise.all([searchParams,account()]);
  const current=await scope(params.institution,params.role);
  const parsed=directoryFilters(params);
  if (!parsed.success || !["student","admin"].includes(current.role)) notFound();
  const {rows,more}=await opportunities(current,parsed.data);
  const zone=(await workspaces(user.id)).find(w=>w.id===current.institution && w.role===current.role)?.timezone;
  if (!zone) notFound();
  const date=new Intl.DateTimeFormat("en-IN",{dateStyle:"medium",timeZone:zone});
  const admin=current.role==="admin";
  const filters=new URLSearchParams(workspaceQuery(current));
  if (parsed.data.kind) filters.set("kind",parsed.data.kind);
  if (parsed.data.query) filters.set("query",parsed.data.query);
  const link=(page:number)=>`/opportunities?${filters}&page=${page}`;
  return <Chrome current={current} user={user} section="/opportunities">
    <ExperienceHeading title="Opportunities" context="Internships, scholarships and competitions" />
    {admin && <details className="panel"><summary>Publish a verified opportunity</summary>
      <ActionForm action={opportunityAction} context={current} label="Publish listing" operation="publish">
        <input name="id" type="hidden" value={randomUUID()}/>
        <label>Title<input name="title" maxLength={140} required/></label>
        <label>Organizer<input name="sponsor" maxLength={140} required/></label>
        <label>Opportunity type<select name="kind">{kinds.map(k=><option key={k}>{k}</option>)}</select></label>
        <label>Eligibility and requirements<textarea name="eligibility" maxLength={1500} required/></label>
        <label>Official source URL<input type="url" name="source" maxLength={2048} required/></label>
        <label>Last application day ({zone})<input type="date" name="deadline" required/></label>
        <label><input type="checkbox" name="verified" required/> I checked the requirements and deadline against the official source.</label>
      </ActionForm>
    </details>}
    <section className="panel stack" aria-labelledby="directory-title"><h2 id="directory-title">{admin?"Institution listings":"Open opportunities"}</h2>
      <form method="get" className="row"><input type="hidden" name="institution" value={current.institution}/><input type="hidden" name="role" value={current.role}/>
        <label>Search listings<input type="search" name="query" maxLength={120} defaultValue={parsed.data.query}/></label>
        <label>Filter by type<select name="kind" defaultValue={parsed.data.kind??""}><option value="">All types</option>{kinds.map(k=><option key={k}>{k}</option>)}</select></label>
        <button className="button secondary">Filter</button>
      </form>
      {!rows.length && <p>No listings match this page.</p>}
      {rows.map(row=><article key={row.id} className="club-record stack">
        <p className="meta">{row.kind} · {row.sponsor} · {row.status}</p><h3>{row.title}</h3><p className="prose-text">{row.eligibility}</p>
        <p>Apply by {row.deadline} · {zone}</p>
        <p className="meta">Source checked {date.format(row.verified_at)}</p>
        <a href={row.source_url} rel="noreferrer">Official source · {new URL(row.source_url).hostname}</a>
        {admin && (row.withdrawal_reason ? <p>Withdrawal reason · {row.withdrawal_reason}</p> : <details><summary>Withdraw listing</summary>
          <ActionForm action={opportunityAction} context={current} operation="withdraw" label="Confirm withdrawal">
            <input name="id" type="hidden" value={row.id}/><label>Reason<input name="reason" required maxLength={300}/></label>
          </ActionForm></details>)}
      </article>)}
      <nav className="row" aria-label="Directory pages">{parsed.data.page>1 && <Link href={link(parsed.data.page-1)}>Previous page</Link>}
        <span>Page {parsed.data.page}</span>{more && <Link href={link(parsed.data.page+1)}>Next page</Link>}</nav>
    </section>
  </Chrome>;
}
