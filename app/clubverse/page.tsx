import Link from "next/link";
import { notFound } from "next/navigation";
import { Chrome } from "../chrome";
import { PageHeader } from "../page-header";
import { account, scope, workspaceQuery } from "../../lib/scope";
import { catalogOptions, clubs } from "../../lib/club-views";
import { ClubForm, ProposalFields, stateText } from "./controls";

export default async function Clubverse({ searchParams }: { searchParams: Promise<Record<string,string | undefined>> }) {
  const [params,user] = await Promise.all([searchParams,account()]);
  const current = await scope(params.institution,params.role);
  if (!["student","faculty","admin"].includes(current.role)) notFound();
  const search = typeof params.q === "string" ? params.q.slice(0,120) : "";
  const category = typeof params.category === "string" ? params.category.slice(0,40) : "";
  const [options,{ recognized,proposals }] = await Promise.all([catalogOptions(),clubs(current,search,category)]);
  const query = workspaceQuery(current);
  const admin = current.role === "admin";
  return <Chrome user={user} current={current} section="/clubverse">
    <PageHeader title="CLUBVERSE" context="Recognized campus communities, membership and club proposals." />
    <nav className="section-jumps" aria-label="Community operations"><a href="#community-directory">Discover clubs</a><a href="#community-proposals">Proposals</a><Link href={`/clubverse/booking?${query}`}>Resource bookings</Link></nav>
    <div className="grid">
      <section className="panel stack">
        <h2 id="community-directory" tabIndex={-1}>Explore communities</h2>
        <form className="form">
          <input type="hidden" name="institution" value={current.institution} /><input type="hidden" name="role" value={current.role} />
          <label>Search clubs<input name="q" type="search" defaultValue={search} maxLength={120} /></label>
          <label>Filter by category<select name="category" defaultValue={category}><option value="">All categories</option>
            {options.categories.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <div><button className="button secondary">Apply filters</button></div>
        </form>
        {!recognized.length && <p>No recognized clubs match this view.</p>}
        <ul className="record-cards">{recognized.map(club => <li key={club.id}>
          <div className="row"><Link href={`/clubverse/${club.id}?${query}`}>{club.name}</Link><span className="tag">{club.club_state}</span></div>
          <p className="meta">{club.category}</p><p className="prose-text">{club.purpose}</p>
        </li>)}</ul>
      </section>
      <div className="stack">
        {!admin && <section className="panel"><h2>Create club</h2>
          <ClubForm current={current} operation="draft" label="Save club draft"><ProposalFields options={options} /></ClubForm>
        </section>}
        <section className="panel stack"><h2 id="community-proposals" tabIndex={-1}>{admin ? "Proposal review" : "Your proposals"}</h2>
          {!proposals.length && <p>No proposals to display.</p>}
          {proposals.map(proposal => {
            const values = { id:proposal.id,revision:proposal.revision };
            const editable = !admin && ["draft","changes_requested"].includes(proposal.state);
            return <article className="stack" key={proposal.id}>
              <div><h3>{proposal.name}</h3><span className="tag">{stateText(proposal.state)}</span></div>
              <p className="prose-text">{proposal.purpose}</p>
              <p className="prose-text">{proposal.rules}</p>
              {proposal.review_note && <p>Review note · {proposal.review_note}</p>}
              {editable && <><details><summary>Edit draft</summary><ClubForm current={current} operation="revise" values={values} label="Update draft">
                <ProposalFields options={options} draft={proposal} />
              </ClubForm></details><ClubForm current={current} operation="proposal" label="Submit proposal" values={{ ...values,next:"submitted" }} /></>}
              {admin && proposal.state === "submitted" && <ClubForm current={current} operation="proposal" label="Start review" values={{ ...values,next:"under_review" }} />}
              {admin && proposal.state === "under_review" && <ClubForm current={current} operation="proposal" label="Record decision" values={values}>
                <label>Decision<select name="next"><option value="approved">Approve club</option><option value="changes_requested">Request changes</option><option value="rejected">Reject proposal</option></select></label>
                <label>Review note<textarea name="note" maxLength={2000} /></label>
              </ClubForm>}
            </article>;
          })}
        </section>
      </div>
    </div>
  </Chrome>;
}
