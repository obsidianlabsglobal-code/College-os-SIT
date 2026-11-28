import Link from "next/link";
import { PageHeader } from "../../page-header";
import { Chrome } from "../../chrome";
import { account, scope, workspaceQuery, workspaces } from "../../../lib/scope";
import { askAura } from "../../../lib/aura/ask";

export default async function Ask({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [params, user] = await Promise.all([searchParams, account()]);
  const current = await scope(params.institution, params.role);
  const query = workspaceQuery(current);
  const zone = (await workspaces(user.id)).find(w => w.id === current.institution && w.role === current.role)?.timezone ?? "Asia/Kolkata";
  const question = (params.q ?? "").trim().slice(0, 200);
  const answers = question.length >= 2 ? await askAura(current, question, zone) : [];
  return <Chrome user={user} current={current} section="/aura">
    <PageHeader title="Ask AURA" parent={{ href: `/aura?${query}`, label: "AURA" }}
      context="Ask in plain words. Answers come only from records you are allowed to see and from approved policies, each with its source. No AI model is used here." />
    <section className="panel stack" aria-labelledby="ask-title">
      <h2 id="ask-title">Your question</h2>
      <form method="get" className="form">
        <input type="hidden" name="institution" value={current.institution} /><input type="hidden" name="role" value={current.role} />
        <label>Question<input name="q" maxLength={200} defaultValue={question} placeholder="What's due this week and where is my lab?" required minLength={2} /></label>
        <div><button className="button">Ask</button></div>
      </form>
    </section>
    {answers.map((a, i) => <section key={i} className="panel stack" aria-label={a.heading}>
      <h2>{a.heading}</h2>
      <ul className="items">{a.lines.map((line, j) => <li key={j}>{line}</li>)}</ul>
      <p className="meta">Source: {a.source} · <Link href={`${a.path}?${query}`}>Open</Link></p>
      {a.action && <div><Link className="button secondary" href={`${a.action.path}?${query}`}>{a.action.label}</Link></div>}
    </section>)}
  </Chrome>;
}
