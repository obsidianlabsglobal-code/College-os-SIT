import Link from "next/link";
import { PageHeader } from "../page-header";
import { Chrome } from "../chrome";
import { ActionForm } from "../forms";
import { planningAction } from "../actions/planning";
import { account, scope, workspaceQuery } from "../../lib/scope";
import { serviceCategories, supportServices } from "../../lib/support-services";

const categoryLabel: Record<(typeof serviceCategories)[number], string> = { accessibility: "Accessibility", counselling: "Counselling", health: "Health",
  financial: "Financial aid", academic: "Academic help", safety: "Safety" };

export default async function Support({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [params, user] = await Promise.all([searchParams, account()]);
  const current = await scope(params.institution, params.role);
  const services = await supportServices(current, params.category);
  const query = workspaceQuery(current);
  const chosen = serviceCategories.find(c => c === params.category);
  return <Chrome user={user} current={current} section="/support">
    <PageHeader title="Support services" parent={{ href: `/?${query}`, label: "Workspace" }}
      context="Services the office has approved for this institution. Contact them directly; NEXUS does not share your visit with anyone." />
    <nav aria-label="Service category" className="row">
      <Link href={`/support?${query}`} aria-current={!chosen ? "page" : undefined} className={!chosen ? "button" : "button secondary"}>All</Link>
      {serviceCategories.map(c => <Link key={c} href={`/support?${query}&category=${c}`} aria-current={c === chosen ? "page" : undefined}
        className={c === chosen ? "button" : "button secondary"}>{categoryLabel[c]}</Link>)}
    </nav>
    {current.role === "admin" && <section className="panel stack" aria-labelledby="publish-service">
      <h2 id="publish-service">Publish a service</h2>
      <ActionForm action={planningAction} context={current} operation="service-publish" label="Publish service">
        <label>Category<select name="category" required defaultValue="accessibility">{serviceCategories.map(c => <option key={c} value={c}>{categoryLabel[c]}</option>)}</select></label>
        <label>Service name<input name="name" required maxLength={120} /></label>
        <label>What it offers<textarea name="description" required maxLength={1000} /></label>
        <label>How to reach it<input name="contact" required maxLength={200} placeholder="e.g. Room 104, Admin block" /></label>
        <label>Hours<input name="hours" required maxLength={120} placeholder="e.g. Mon–Fri, 9:30–16:30" /></label>
      </ActionForm>
    </section>}
    <section className="panel stack" aria-labelledby="services-title">
      <h2 id="services-title">{chosen ? categoryLabel[chosen] : "All services"}</h2>
      {services.length ? <ul className="items">{services.map(s => <li key={s.id}><article aria-label={s.name} className="stack">
        <div className="row spread"><h3>{s.name}</h3><span className="tag">{categoryLabel[s.category]}</span></div>
        <p>{s.description}</p>
        <p className="meta">{s.contact} · {s.hours}</p>
        {current.role === "admin" && <ActionForm action={planningAction} context={current} operation="service-withdraw" label="Withdraw" secondary>
          <input type="hidden" name="id" value={s.id} /></ActionForm>}
      </article></li>)}</ul> : <p>No services listed{chosen ? " in this category" : ""} yet.</p>}
    </section>
  </Chrome>;
}
