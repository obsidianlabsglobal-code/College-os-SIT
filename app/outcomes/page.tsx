import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "../page-header";
import { Chrome } from "../chrome";
import { ActionForm } from "../forms";
import { outcomesAction } from "../actions/outcomes";
import { account, scope, workspaceQuery } from "../../lib/scope";
import { ATTAIN_PERCENT, courseOutcomes, myOutcomeEvidence, offeringAttainment, outcomeChoices, programmeAttainment, programmeOutcomes } from "../../lib/outcomes";

const rule = `A student attains an outcome when their published marks on its tagged assessments reach ${ATTAIN_PERCENT}% of the available marks. Level 3 when at least 70% of assessed students attain it, 2 at 60%, 1 at 50%, otherwise 0. Programme outcome levels are mapping-weighted means. Unpublished marks never count.`;

export default async function Outcomes({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [params, user] = await Promise.all([searchParams, account()]);
  const current = await scope(params.institution, params.role);
  const query = workspaceQuery(current);
  if (current.role === "student") {
    const mine = await myOutcomeEvidence(current);
    return <Chrome user={user} current={current} section="/outcomes">
      <PageHeader title="Learning outcomes" parent={{ href: `/?${query}`, label: "Workspace" }} context={rule} />
      <section className="panel stack" aria-labelledby="mine-title">
        <h2 id="mine-title">My outcome evidence</h2>
        <p className="meta">Only assessments your teachers tagged with an approved outcome count. It is evidence, not a grade.</p>
        {mine.length ? <ul className="items">{mine.map(e => <li key={`${e.course}:${e.code}`} className="row spread"><span><strong>{e.course} · {e.code}</strong> · {e.statement}</span>
          <span className={e.attained ? "tag" : "tag tag-attention"}>{e.percent}% · {e.attained ? "attained" : "not yet"}</span></li>)}</ul> : <p>No tagged evidence yet.</p>}
      </section>
    </Chrome>;
  }
  const [outcomes, pos, choices] = await Promise.all([courseOutcomes(current), programmeOutcomes(current), outcomeChoices(current)]);
  const chosen = choices.offerings.find(o => o.id === params.offering) ?? choices.offerings[0];
  const [attainment, poLevels] = chosen ? await Promise.all([offeringAttainment(current, chosen.id), programmeAttainment(current, chosen.id)]) : [null, null];
  if (!["faculty", "hod", "admin", "principal"].includes(current.role)) notFound();
  const courses = [...new Map(choices.offerings.map(o => [o.course_id, o.label.split(" · ")[0]])).entries()];
  return <Chrome user={user} current={current} section="/outcomes">
    <PageHeader title="Outcomes and attainment" parent={{ href: `/?${query}`, label: "Workspace" }} context={rule} />

    {current.role === "admin" && <section className="panel stack" aria-labelledby="po-title">
      <h2 id="po-title">Programme outcomes</h2>
      {pos.length ? <ul className="items">{pos.map(p => <li key={p.id}><strong>{p.code}</strong> · {p.statement}</li>)}</ul> : <p>None defined yet.</p>}
      <ActionForm action={outcomesAction} context={current} operation="programme" label="Add programme outcome">
        <label>Code<input name="code" required pattern="PS?O[0-9]{1,2}" placeholder="PO1" /></label>
        <label>Statement<textarea name="statement" required maxLength={500} /></label></ActionForm>
    </section>}

    {current.role === "faculty" && courses.length > 0 && pos.length > 0 && <section className="panel stack" aria-labelledby="propose-title">
      <h2 id="propose-title">Propose a course outcome</h2>
      <ActionForm action={outcomesAction} context={current} operation="propose" label="Send for approval">
        <label>Course<select name="course" required>{courses.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label>Code<input name="code" required pattern="CO[0-9]{1,2}" placeholder="CO1" /></label>
        <label>Statement<textarea name="statement" required maxLength={500} /></label>
        <fieldset><legend>Programme outcome mapping (leave blank if not mapped)</legend>
          {pos.map(p => <label key={p.id}>{p.code} · {p.statement}<input type="hidden" name="po" value={p.id} />
            <select name={`level:${p.id}`} defaultValue=""><option value="">Not mapped</option><option value="1">1 · Low</option><option value="2">2 · Medium</option><option value="3">3 · High</option></select></label>)}
        </fieldset>
      </ActionForm>
    </section>}

    <section className="panel stack" aria-labelledby="co-title">
      <h2 id="co-title">Course outcomes</h2>
      {outcomes.length ? <ul className="items">{outcomes.map(k => <li key={k.id}><article aria-label={`${k.course} ${k.code}`} className="stack">
        <div className="row spread"><h3>{k.course} · {k.code}</h3><span className={k.state === "proposed" ? "tag tag-attention" : "tag"}>{{ proposed: "Awaiting decision", approved: "Approved", returned: "Returned" }[k.state]}</span></div>
        <p>{k.statement}</p>
        <p className="meta">Maps to {k.mapping.map(m => `${m.code} (${m.level})`).join(", ")} · proposed by {k.proposer}{k.reason ? ` · ${k.reason}` : ""}</p>
        {k.can_decide && k.state === "proposed" && <ActionForm action={outcomesAction} context={current} operation="decide" label="Record decision">
          <input type="hidden" name="outcome" value={k.id} />
          <label>Decision<select name="decision" defaultValue="approved"><option value="approved">Approve</option><option value="returned">Return</option></select></label>
          <label>Reason<input name="reason" required maxLength={500} /></label></ActionForm>}
      </article></li>)}</ul> : <p>No course outcomes yet.</p>}
    </section>

    {current.role === "faculty" && choices.assessments.length > 0 && <section className="panel stack" aria-labelledby="tag-title">
      <h2 id="tag-title">Tag assessments</h2>
      <ul className="items">{choices.assessments.map(a => <li key={a.id}><article aria-label={a.title} className="stack"><h3>{a.title}</h3>
        <div className="row">{outcomes.filter(k => k.state === "approved" && k.course_id === a.course_id).map(k => {
          const tagged = a.tags.includes(k.id);
          return <ActionForm key={k.id} action={outcomesAction} context={current} operation={tagged ? "untag" : "tag"} label={tagged ? `Untag ${k.code}` : `Tag ${k.code}`} secondary>
            <input type="hidden" name="assignment" value={a.id} /><input type="hidden" name="outcome" value={k.id} /></ActionForm>;
        })}</div>
      </article></li>)}</ul>
    </section>}

    {current.role !== "admin" && chosen && <section className="panel stack" aria-labelledby="attain-title">
      <h2 id="attain-title">Attainment · {chosen.label}</h2>
      {choices.offerings.length > 1 && <nav aria-label="Offering" className="row">{choices.offerings.map(o =>
        <Link key={o.id} href={`/outcomes?${query}&offering=${o.id}`} aria-current={o.id === chosen.id ? "page" : undefined}>{o.label}</Link>)}</nav>}
      {attainment?.length ? <>
        <table className="standings"><caption className="sr-only">Course outcome attainment</caption>
          <thead><tr><th scope="col">Outcome</th><th scope="col">Assessed</th><th scope="col">Attained</th><th scope="col">%</th><th scope="col">Level</th></tr></thead>
          <tbody>{attainment.map(r => <tr key={r.outcome_id}><th scope="row">{r.code}</th><td>{r.assessed}</td><td>{r.attained}</td><td>{r.percent}</td><td>{r.level}</td></tr>)}</tbody></table>
        {attainment.some(r => r.level < 2) && <p className="meta">Needs support: {attainment.filter(r => r.level < 2).map(r => r.code).join(", ")}.</p>}
        {poLevels && poLevels.length > 0 && <p className="meta">Programme outcomes: {poLevels.map(p => `${p.code} ${p.level}`).join(" · ")}</p>}
      </> : <p>No published marks on tagged assessments yet.</p>}
    </section>}
  </Chrome>;
}
