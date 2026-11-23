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
  const [tasks,context] = await Promise.all([eventPlans(current),club.success ? clubView(current,club.data) : null]);
  const query = workspaceQuery(current);
  return <Chrome user={user} current={current} section="/aura">
    <ExperienceHeading title="AURA activity" context="Guided event planning · Deterministic mode" />
    <div className="grid">
      <section className="panel stack">
        <h2>Your event plans</h2>
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
