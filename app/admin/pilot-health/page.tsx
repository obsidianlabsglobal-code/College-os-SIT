import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "../../page-header";
import { Chrome, roleLabels } from "../../chrome";
import { account, scope, workspaceQuery } from "../../../lib/scope";
import { pilotHealth } from "../../../lib/pilot-health";

export default async function PilotHealth({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [params, user] = await Promise.all([searchParams, account()]);
  const current = await scope(params.institution, params.role);
  const health = await pilotHealth(current);
  if (!health) notFound();
  const query = workspaceQuery(current);
  const when = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
  const waiting = health.pending.reduce((n, p) => n + p.waiting, 0);
  return <Chrome user={user} current={current} section="/admin">
    <PageHeader title="Pilot health" parent={{ href: `/admin?${query}`, label: "Academic setup" }}
      context="Who is waiting, who has not accepted the privacy notice, who cannot sign in, and how many phones get bus alerts." />
    <section className="panel" aria-label="Pilot summary">
      <dl className="metrics">
        <div><dt>Waiting for approval</dt><dd>{waiting}</dd></div>
        <div><dt>Accepted the notice</dt><dd>{health.consent.required ? `${health.consent.accepted} of ${health.consent.members}` : "Not required"}</dd></div>
        <div><dt>Failed sign-ins · 24 h</dt><dd>{health.failures.reduce((n, f) => n + f.failures, 0)}</dd></div>
        <div><dt>Phones with bus alerts</dt><dd>{health.phones.phones}</dd></div>
      </dl>
    </section>
    <section className="panel stack" aria-labelledby="people-title">
      <h2 id="people-title">People</h2>
      {health.people.length ? <p>{health.people.map(p => `${roleLabels[p.role as keyof typeof roleLabels] ?? p.role}: ${p.n}`).join(" · ")}</p> : <p>No members yet.</p>}
      <p className="meta">Departments on: {health.departments.filter(d => d.active).map(d => d.name).join(", ") || "none"}. <Link href={`/admin?${query}#pilot-departments`}>Change</Link></p>
    </section>
    <section className="panel stack" aria-labelledby="waiting-title">
      <h2 id="waiting-title">Students waiting, by section</h2>
      {health.pending.length ? <ul className="items">{health.pending.map(p => <li key={p.section}><strong>{p.section}</strong> · {p.waiting} waiting · oldest {p.oldest_hours} h
        {p.oldest_hours >= 48 ? " · remind the section’s teachers" : ""}</li>)}</ul> : <p>No one is waiting.</p>}
    </section>
    <section className="panel stack" aria-labelledby="failures-title">
      <h2 id="failures-title">Trouble signing in · last 24 hours</h2>
      <p className="meta">Emails of this college’s members and applicants with failed sign-ins. Repeated failures usually mean a mistyped email or an expired code.</p>
      {health.failures.length ? <ul className="items">{health.failures.map(f => <li key={f.email}>{f.email} · {f.failures} {f.failures === 1 ? "failure" : "failures"} · last {when.format(f.last)}</li>)}</ul>
        : <p>No failed sign-ins.</p>}
    </section>
    <section className="panel stack" aria-labelledby="notice-title">
      <h2 id="notice-title">Privacy notice</h2>
      <p>{health.consent.required ? `${health.consent.members - health.consent.accepted} members have not accepted the current notice yet.` : "The notice is not required yet."} <Link href={`/admin?${query}#privacy-notice`}>Details</Link></p>
    </section>
  </Chrome>;
}
