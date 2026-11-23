import { randomUUID } from "node:crypto";
import { topics, tutorActivity, tutorEnabled } from "../../lib/aura/tutor";
import { AcademicPanel } from "./academic-panel";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Chrome } from "../chrome";
import { ExperienceHeading, ExperienceStatus } from "../experience/heading";
import { ActionForm } from "../forms";
import { auraAction } from "../actions/aura";
import { account, scope, workspaceQuery } from "../../lib/scope";
import { clubView } from "../../lib/club-views";
import { eventPlans } from "../../lib/aura/tasks";
import { eventInput } from "../../lib/club-contracts";
import { EventFields } from "../clubverse/controls";

export default async function Aura({ searchParams }: { searchParams:Promise<Record<string,string | undefined>> }) {
  const [params,user] = await Promise.all([searchParams,account()]);
  const current = await scope(params.institution,params.role);
  if (current.role !== "student" && current.role !== "faculty") notFound();
  const club = z.uuid().safeParse(params.club);
  const [tasks,context,usage] = await Promise.all([eventPlans(current),club.success ? clubView(current,club.data) : null,tutorActivity(current)]);
  const query = workspaceQuery(current);
  return <Chrome user={user} current={current} section="/aura">
    <ExperienceHeading title="AURA activity" context="Academic assistance and event planning" />
    <AcademicPanel key={query} workspace={{role:current.role,institution:current.institution}} topics={tutorEnabled(current)?topics:{}} request={randomUUID()} />
    {usage.length>0 && <section className="panel stack"><h2>Your recent tutor usage</h2>
      <ul className="items">{usage.map(row=><li key={row.id}>
        <strong>{topics[row.topic]}</strong> · {row.state==="answered" ? "Answered" : row.state==="reserved" ? "Spend reserved" : "Charge unconfirmed"}
        <p className="meta">{row.state==="answered" ? `${row.input_tokens} input and ${row.output_tokens} output tokens · estimated cost` : "Reserved budget"} USD {(Number(row.budget_microusd)/1_000_000).toFixed(6)}</p>
      </li>)}</ul>
    </section>}
    <div className="grid">
      <section className="panel stack">
        <h2>Your event plans</h2>
        <p className="meta">Guided event planning · Deterministic mode</p>
        {!tasks.length && <p>No previews yet. Open a club you organize to start a plan.</p>}
        {tasks.map(task => {
          const plan = eventInput.safeParse(task.payload);
          if (!plan.success) return null;
          const awaiting = task.state === "awaiting_approval";
          return <article key={task.id} className="club-record stack">
            <div><h3>{plan.data.title}</h3><ExperienceStatus tone={awaiting && !task.expired ? "attention" : task.state === "succeeded" ? "complete" : "neutral"}>
              {awaiting ? task.expired ? "Expired" : "Awaiting your confirmation" : task.state === "succeeded" ? "Event draft saved" : "Cancelled"}
            </ExperienceStatus></div>
            <p>{plan.data.location} · {plan.data.capacity} places · {plan.data.audience === "club" ? "Club members" : "Eligible students"}</p>
            <p className="meta">Institution local time · {plan.data.starts.replace("T"," ")} to {plan.data.ends.replace("T"," ")}</p>
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
      </section>
      {context?.officer && <section className="panel stack">
        <h2>Prepare an event plan</h2><p className="meta">{context.club.name}</p>
        <ActionForm action={auraAction} context={current} label="Review event plan" operation="preview">
          <input name="club" type="hidden" value={context.club.id} />
          <EventFields timezone={context.club.timezone} />
        </ActionForm>
      </section>}
    </div>
  </Chrome>;
}
