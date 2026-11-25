import { ReceiptFocus } from "./receipt-focus";
import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Chrome } from "../chrome";
import { ExperienceHeading, ExperienceStatus } from "../experience/heading";
import { ActionForm } from "../forms";
import { auraAction } from "../actions/aura";
import { account, scope, workspaceQuery, type Scope } from "../../lib/scope";
import { clubView } from "../../lib/club-views";
import { eventPlans } from "../../lib/aura/tasks";
import { auraRequests, spendSummary, type AuraRequest } from "../../lib/aura/assistant";
import { capabilitiesFor, type CapabilityItem } from "../../lib/aura/capabilities";
import { eventInput } from "../../lib/club-contracts";
import { EventFields } from "../clubverse/controls";
import { topics,tutorActivity,tutorEnabled } from "../../lib/aura/tutor";
import { AcademicPanel } from "./academic-panel";
import { Composer } from "./composer";
import styles from "./aura.module.css";

const suggestions = { student: ["My assignments", "My results", "Latest notices", "My requests"], faculty: ["Pending grading", "My assignments", "Latest notices", "Clubs"] };
const time = (value: Date | string) => new Intl.DateTimeFormat("en-IN", { timeStyle: "short", dateStyle: "medium", timeZone: "Asia/Kolkata" }).format(new Date(value));
const dollars = (micros: number) => `$${(micros / 1_000_000).toFixed(micros < 10_000 ? 4 : 2)}`;

function badge(request: AuraRequest) {
  const kind = request.result?.kind;
  if (request.state === "prepared" || request.state === "awaiting_confirmation") return { tone: "confirm", text: "Needs your confirmation" };
  if (request.route === "direct") return { tone: "direct", text: "Direct system action" };
  if (kind === "unsupported" || request.route === "unsupported") return { tone: "muted", text: "Unsupported" };
  if (request.route === "unavailable") return { tone: "muted", text: "Model assistance unavailable" };
  if (request.route === "model") return { tone: "model", text: "AI-assisted" };
  return { tone: "muted", text: request.state };
}

function stateText(request: AuraRequest) {
  if (request.state === "succeeded" && request.result?.eventId) return { tone: "done", text: "Confirmed: private event draft saved" };
  if (request.state === "succeeded") return { tone: "done", text: request.result?.kind === "explanation" ? "Answered" : "I checked the database" };
  if (request.state === "prepared") return { tone: "confirm", text: "I proposed this. Review and edit it" };
  if (request.state === "awaiting_confirmation") return { tone: "confirm", text: request.task_state === "awaiting_approval" ? "Awaiting your approval" : "Preview closed" };
  if (request.state === "cancelled") return { tone: "muted", text: "Cancelled" };
  if (request.state === "failed") return { tone: "muted", text: "I could not complete this" };
  return { tone: "muted", text: "In progress" };
}

function Evidence({ request }: { request: AuraRequest }) {
  const result = request.result ?? {};
  return <div className={styles.evidence}>
    {typeof result.source === "string" && <span>Source: {result.source}{typeof result.checkedAt === "string" ? ` · checked ${time(result.checkedAt)}` : ""}</span>}
    {request.capability && <span>Capability · <code>{request.capability}</code></span>}
    <span>Model calls {request.model_calls} · Tool operations {request.tool_calls}</span>
    {request.usage.map((call, index) => <span key={index}>
      {call.model} · {call.status}{call.input_tokens !== null ? ` · ${call.input_tokens} input / ${call.output_tokens} output tokens` : ""}
      {call.cost_micros !== null ? ` · ${dollars(Number(call.cost_micros))}${call.status === "indeterminate" ? " reserved (outcome unknown)" : ""}` : ""}
      {call.provider_request_id && <> · <code>{call.provider_request_id}</code></>}
    </span>)}
  </div>;
}

function Items({ items }: { items: CapabilityItem[] }) {
  if (!items.length) return null;
  return <ul className={styles.items}>{items.map((item, index) => <li key={index}>
    {item.href ? <Link href={item.href}>{item.title}</Link> : <strong>{item.title}</strong>}
    <span className="meta">{item.detail}</span>
  </li>)}</ul>;
}

function ProposalForm({ request, current }: { request: AuraRequest; current: Scope }) {
  const result = request.result as { clubId: string; clubName: string; timezone: string; notes: string[];
    draft: { title: string; location: string; starts: string; ends: string; capacity: number | ""; audience: string; requirements: string } };
  const draft = result.draft;
  return <div className="stack">
    <p className="meta">For {result.clubName}. Edit anything before saving a preview. Nothing is saved, booked or published yet.</p>
    <ul className={styles.notes}>{result.notes.map(note => <li key={note}>{note}</li>)}</ul>
    <ActionForm action={auraAction} context={current} operation="proposal" label="Save preview for confirmation">
      <input type="hidden" name="request" value={request.id} />
      <input type="hidden" name="club" value={result.clubId} />
      <label>Event title<input name="title" maxLength={140} required defaultValue={draft.title} /></label>
      <label>Location<input name="location" maxLength={180} required defaultValue={draft.location} placeholder="Type a venue you have arranged" /></label>
      <label>Starts ({result.timezone})<input name="starts" type="datetime-local" required defaultValue={draft.starts} /></label>
      <label>Ends ({result.timezone})<input name="ends" type="datetime-local" required defaultValue={draft.ends} /></label>
      <label>Capacity<input name="capacity" type="number" min={1} max={10000} required defaultValue={draft.capacity} /></label>
      <label>Event audience<select name="audience" defaultValue={draft.audience}><option value="club">Club members</option><option value="eligible">Eligible students</option></select></label>
      <label>Requirements and event plan<textarea name="requirements" maxLength={4000} required defaultValue={draft.requirements} /></label>
    </ActionForm>
  </div>;
}

function RequestCard({ request, current, query }: { request: AuraRequest; current: Scope; query: string }) {
  const result = request.result ?? {};
  const kind = result.kind;
  const route = badge(request);
  const state = stateText(request);
  const reply = typeof result.reply === "string" && result.reply ? result.reply : null;
  return <li id={`aura-request-${request.id}`} tabIndex={-1} className={styles.card} aria-label={`Request: ${request.message}`}>
    <p className={styles.ask}>“{request.message}”</p>
    <div className={styles.badges}>
      <span className={styles.badge} data-tone={route.tone}>{route.text}</span>
      <span className={styles.badge} data-tone={state.tone}>{state.text}</span>
      <span className="meta">{time(request.created_at)}</span>
    </div>
    {kind === "read" && <><p>{String(result.summary)}</p><Items items={result.items as CapabilityItem[]} /></>}
    {reply && <figure className="stack" style={{ margin: 0 }}>
      <figcaption className="meta">AI-generated {kind === "explanation" ? "explanation. Educational help, not an official statement" : "note"}</figcaption>
      <p className={styles.reply}>{reply}</p>
    </figure>}
    {typeof result.uncertainty === "string" && result.uncertainty && <p className="meta">Assumptions: {result.uncertainty}</p>}
    {request.state === "failed" && <p>{request.failure}</p>}
    {(kind === "unsupported" || kind === "unavailable") && Array.isArray(result.suggestions) && <p className="meta">
      AURA can currently do: {(result.suggestions as string[]).join(", ")}.</p>}
    {kind === "unavailable" && result.eventForm === true && <p className="meta">You can still plan an event without model assistance: open a club you organize and choose “Plan an event with AURA”.</p>}
    {request.state === "prepared" && kind === "event_proposal" && <ProposalForm request={request} current={current} />}
    {request.state === "awaiting_confirmation" && request.task_state === "awaiting_approval" && request.task_id && <div className="stack">
      <ActionForm action={auraAction} context={current} label="Confirm and save event draft" operation="confirm">
        <input name="id" type="hidden" value={request.task_id} />
        <p className="meta">Saves a private event draft. Approval, publication and room booking are separate club actions.</p>
      </ActionForm>
      <ActionForm action={auraAction} context={current} label="Cancel preview" operation="cancel" secondary>
        <input name="id" type="hidden" value={request.task_id} />
      </ActionForm>
    </div>}
    {request.event_id && request.club_id && <p><Link href={`/clubverse/${request.club_id}?${query}#event-${request.event_id}`}>Open saved event draft</Link> · record <code>{request.event_id}</code></p>}
    <Evidence request={request} />
  </li>;
}

export default async function Aura({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [params, user] = await Promise.all([searchParams, account()]);
  const current = await scope(params.institution, params.role);
  if (current.role !== "student" && current.role !== "faculty") notFound();
  const club = z.uuid().safeParse(params.club);
  const [requests, spend, tasks, context, usage] = await Promise.all([
    auraRequests(current), spendSummary(current), eventPlans(current), club.success ? clubView(current, club.data) : null,tutorActivity(current),
  ]);
  const query = workspaceQuery(current);
  const catalog = capabilitiesFor(current.role);
  const linked = new Set(requests.map(request => request.task_id).filter(Boolean));
  return <Chrome user={user} current={current} section="/aura">
    <ExperienceHeading title="AURA" context="Ask about your coursework, notices and clubs. AURA reads NEXUS records directly and uses a language model only when a request needs interpretation." />
    <div className={styles.layout}>
      <div className="stack">
        <Composer institution={current.institution} role={current.role} nonce={randomUUID()} suggestions={[...suggestions[current.role],"My timetable",...(current.role==="student"?["My attendance"]:[])]} modelEnabled={!spend.gate} />
        {tutorEnabled(current) && <AcademicPanel workspace={{institution:current.institution,role:current.role}} topics={topics} request={randomUUID()}/>}
        {usage.length>0 && <section className="panel"><h2>Your recent tutor usage</h2>
          {usage.map(r=><p key={r.id}>{topics[r.topic]} · {r.state} · {r.input_tokens ?? "Unknown"} input and {r.output_tokens ?? "unknown"} output tokens · {r.state==="answered"?"Estimated":"Reserved"} USD {(Number(r.budget_microusd)/1_000_000).toFixed(6)}</p>)}</section>}
        <section aria-labelledby="aura-conversation" className="stack">
          <h2 id="aura-conversation">AURA activity</h2>
          {!requests.length && <p className="meta">No requests yet. Try one of the suggestions above.</p>}
          <ReceiptFocus latest={requests[0]?.id} />
          <ol className={styles.thread}>{requests.map(request => <RequestCard key={request.id} request={request} current={current} query={query} />)}</ol>
        </section>
        {tasks.some(task => !linked.has(task.id)) && <section className="panel stack" aria-labelledby="aura-event-plans">
          <h2 id="aura-event-plans">Event plans from club pages</h2>
          {tasks.filter(task => !linked.has(task.id)).map(task => {
            const plan = eventInput.safeParse(task.payload);
            if (!plan.success) return null;
            const awaiting = task.state === "awaiting_approval";
            return <article key={task.id} className="club-record stack">
              <div><h3>{plan.data.title}</h3><ExperienceStatus tone={awaiting && !task.expired ? "attention" : task.state === "succeeded" ? "complete" : "neutral"}>
                {awaiting ? task.expired ? "Expired" : "Awaiting your confirmation" : task.state === "succeeded" ? "Event draft saved" : "Cancelled"}
              </ExperienceStatus></div>
              <p>{plan.data.location} · {plan.data.capacity} places · {plan.data.audience === "club" ? "Club members" : "Eligible students"}</p>
              <p className="meta">Institution local time · {plan.data.starts.replace("T", " ")} to {plan.data.ends.replace("T", " ")}</p>
              <p className="prose-text">{plan.data.requirements}</p>
              <p className="meta">Tools recorded {task.tools?.length ?? 0} · Model calls 0</p>
              {awaiting && !task.expired && <ActionForm action={auraAction} context={current} label="Confirm and save event draft" operation="confirm">
                <input name="id" type="hidden" value={task.id} />
                <p className="meta">Saves a private event draft. Approval and publication are separate club actions.</p>
              </ActionForm>}
              {awaiting && <ActionForm action={auraAction} context={current} label="Cancel preview" operation="cancel" secondary>
                <input name="id" type="hidden" value={task.id} />
              </ActionForm>}
              {task.event_id && <Link href={`/clubverse/${task.club_id}?${query}#event-${task.event_id}`}>Open saved event draft</Link>}
            </article>;
          })}
        </section>}
        {context?.officer && <section className="panel stack" aria-labelledby="aura-manual-plan">
          <h2 id="aura-manual-plan">Prepare an event plan</h2><p className="meta">{context.club.name} </p><p className="meta">Guided event planning · Deterministic mode</p>
          <ActionForm action={auraAction} context={current} label="Review event plan" operation="preview">
            <input name="club" type="hidden" value={context.club.id} />
            <EventFields timezone={context.club.timezone} />
          </ActionForm>
        </section>}
      </div>
      <aside className="stack" aria-label="AURA status and capabilities">
        <section className="panel stack" aria-labelledby="aura-model-status">
          <h2 id="aura-model-status">Model assistance</h2>
          {spend.gate ? <p><span className={styles.badge} data-tone="muted">Unavailable</span> {spend.gate}</p>
            : <p><span className={styles.badge} data-tone="model">Configured</span> Routine requests use {spend.routineModel}.</p>}
          <p className="meta">Today for this institution: {dollars(Math.round(spend.todayUsd * 1_000_000))} across {spend.callsToday} model call{spend.callsToday === 1 ? "" : "s"}
            {spend.dailyCapUsd !== null ? ` · limit $${spend.dailyCapUsd.toFixed(2)}` : ""}. Software limits; actual provider charges are billed by the provider.</p>
          <p className="meta">Direct requests never call a model.</p>
        </section>
        <section className="panel stack" aria-labelledby="aura-capabilities">
          <h2 id="aura-capabilities">What AURA can do</h2>
          <ul className={styles.capabilities}>{catalog.map(item => <li key={item.name}>
            <span>{item.label}</span>
            <span className={styles.badge} data-tone={item.risk === "read" ? "direct" : "confirm"}>{item.risk === "read" ? "Reads records" : "Needs confirmation"}</span>
          </li>)}</ul>
          <p className="meta">Not yet available: venue booking status and club event listings. AURA says so instead of guessing.</p>
        </section>
      </aside>
    </div>
  </Chrome>;
}
