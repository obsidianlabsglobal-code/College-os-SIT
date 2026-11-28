import { z } from "zod";
import type { PoolClient } from "pg";
import { audit, WorkflowError } from "./assignments";
import { clubAccess, eligible, lockClubActor } from "./clubverse";
import { db, transaction } from "./db";
import type { Scope } from "./scope";

// CL-044 waitlist and withdrawal, CL-046 feedback. Same gate as registration: active club, eligible student,
// club-only events need active club membership.
const unavailable = () => new WorkflowError("This CLUBVERSE action is unavailable.");
const ids = z.object({ club: z.uuid(), event: z.uuid() });

async function gate(client: PoolClient, scope: Scope, club: string, event: string) {
  if (scope.role !== "student") throw unavailable();
  await lockClubActor(client, scope);
  const access = await clubAccess(client, scope, club);
  const { rows: [row] } = await client.query<{ state: string; capacity: number; audience: string; before_start: boolean }>(
    `SELECT state,capacity,audience,clock_timestamp()<starts_at AS before_start FROM club_event
     WHERE institution_id=$1 AND id=$2 AND club_id=$3 AND published_at IS NOT NULL FOR UPDATE`, [scope.institution, event, club]);
  if (!row || access.state !== "active" || !eligible(access.audience, scope.role) || (row.audience === "club" && !access.member)) throw unavailable();
  return row;
}

/** Joins the waitlist of a full event that is open for registration. */
export function joinWaitlist(scope: Scope, raw: unknown) {
  const input = ids.parse(raw);
  return transaction(async client => {
    const event = await gate(client, scope, input.club, input.event);
    if (event.state !== "registration_open" || !event.before_start) throw new WorkflowError("Registration is closed.");
    const key = [scope.institution, input.event, scope.account];
    const { rows: [n] } = await client.query<{ taken: number; mine: boolean }>(`SELECT count(*)::int AS taken,
      bool_or(account_id=$3) AS mine FROM club_registration WHERE institution_id=$1 AND event_id=$2`, key);
    if (n.mine) throw new WorkflowError("You are already registered.");
    if (n.taken < event.capacity) throw new WorkflowError("Seats are still open. Register instead.");
    const added = await client.query("INSERT INTO club_waitlist (institution_id,event_id,account_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", key);
    if (!added.rowCount) throw new WorkflowError("You are already on the waitlist.");
    await audit(client, scope, input.event, "club.event_waitlisted", undefined, scope.account);
  });
}

/** Leaves the waitlist, or gives up a seat before the event starts; the earliest waiting student still eligible takes it. */
export function withdraw(scope: Scope, raw: unknown) {
  const input = ids.parse(raw);
  return transaction(async client => {
    const event = await gate(client, scope, input.club, input.event);
    const key = [scope.institution, input.event, scope.account];
    if ((await client.query("DELETE FROM club_waitlist WHERE institution_id=$1 AND event_id=$2 AND account_id=$3", key)).rowCount) {
      await audit(client, scope, input.event, "club.event_waitlist_left", undefined, scope.account);
      return null;
    }
    if (!["registration_open", "registration_closed"].includes(event.state) || !event.before_start) throw new WorkflowError("You can withdraw only before the event starts.");
    const gone = await client.query("DELETE FROM club_registration WHERE institution_id=$1 AND event_id=$2 AND account_id=$3 AND verified_at IS NULL", key);
    if (!gone.rowCount) throw new WorkflowError("You are not registered for this event.");
    await audit(client, scope, input.event, "club.event_withdrawn", undefined, scope.account);
    const { rows: [next] } = await client.query<{ account_id: string }>(`DELETE FROM club_waitlist w WHERE (w.institution_id,w.event_id,w.account_id)=(
        SELECT q.institution_id,q.event_id,q.account_id FROM club_waitlist q JOIN club_event e ON (e.institution_id,e.id)=(q.institution_id,q.event_id)
        JOIN membership m ON m.institution_id=q.institution_id AND m.account_id=q.account_id AND m.role='student' AND m.ended_at IS NULL
        WHERE q.institution_id=$1 AND q.event_id=$2 AND (e.audience='eligible' OR EXISTS (SELECT 1 FROM club_member cm
          WHERE (cm.institution_id,cm.club_id,cm.account_id)=(e.institution_id,e.club_id,q.account_id) AND cm.state='active'))
        ORDER BY q.joined_at,q.account_id LIMIT 1) RETURNING w.account_id`, [scope.institution, input.event]);
    if (!next) return null;
    await client.query("INSERT INTO club_registration (institution_id,event_id,account_id) VALUES ($1,$2,$3)", [scope.institution, input.event, next.account_id]);
    await audit(client, scope, input.event, "club.event_waitlist_promoted", undefined, next.account_id);
    return next.account_id;
  });
}

const feedbackInput = ids.extend({ rating: z.coerce.number().int().min(1).max(5), comment: z.string().trim().max(1000).default("") });
/** One response per registered student, once the event is completed. */
export function giveFeedback(scope: Scope, raw: unknown) {
  const input = feedbackInput.parse(raw);
  return transaction(async client => {
    const event = await gate(client, scope, input.club, input.event);
    if (event.state !== "completed") throw new WorkflowError("Feedback opens when the event is completed.");
    const key = [scope.institution, input.event, scope.account];
    if (!(await client.query("SELECT 1 FROM club_registration WHERE institution_id=$1 AND event_id=$2 AND account_id=$3", key)).rowCount) throw unavailable();
    const added = await client.query(`INSERT INTO club_event_feedback (institution_id,event_id,account_id,rating,comment)
      VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [...key, input.rating, input.comment]);
    if (!added.rowCount) throw new WorkflowError("You have already given feedback.");
    await audit(client, scope, input.event, "club.event_feedback_given", undefined, scope.account);
  });
}

export type EventExtras = { event_id: string; taken: number; waiting: number; my_place: number | null; my_feedback: boolean; responses: number; average: number | null; comments: string[] };
/** For each event of a club the caller can see: waitlist size and place, whether they gave feedback, and for officers an anonymous summary. */
export async function eventExtras(scope: Scope, club: string, events: string[], officer: boolean): Promise<Map<string, EventExtras>> {
  if (!events.length) return new Map();
  const { rows } = await db.query<EventExtras>(`SELECT e.id AS event_id,
      (SELECT count(*)::int FROM club_registration r WHERE (r.institution_id,r.event_id)=(e.institution_id,e.id)) AS taken,
      (SELECT count(*)::int FROM club_waitlist w WHERE (w.institution_id,w.event_id)=(e.institution_id,e.id)) AS waiting,
      (SELECT p.place FROM (SELECT w.account_id,row_number() OVER (ORDER BY w.joined_at,w.account_id)::int AS place FROM club_waitlist w
        WHERE (w.institution_id,w.event_id)=(e.institution_id,e.id)) p WHERE p.account_id=$3) AS my_place,
      EXISTS (SELECT 1 FROM club_event_feedback f WHERE (f.institution_id,f.event_id,f.account_id)=(e.institution_id,e.id,$3)) AS my_feedback,
      CASE WHEN $5 THEN (SELECT count(*)::int FROM club_event_feedback f WHERE (f.institution_id,f.event_id)=(e.institution_id,e.id)) ELSE 0 END AS responses,
      CASE WHEN $5 THEN (SELECT round(avg(rating),1)::float FROM club_event_feedback f WHERE (f.institution_id,f.event_id)=(e.institution_id,e.id)) END AS average,
      CASE WHEN $5 THEN ARRAY(SELECT f.comment FROM club_event_feedback f WHERE (f.institution_id,f.event_id)=(e.institution_id,e.id) AND f.comment<>''
        ORDER BY f.given_at DESC LIMIT 20) ELSE '{}' END AS comments
    FROM club_event e WHERE e.institution_id=$1 AND e.club_id=$2 AND e.id=ANY($4::uuid[])`, [scope.institution, club, scope.account, events, officer]);
  return new Map(rows.map(r => [r.event_id, r]));
}
