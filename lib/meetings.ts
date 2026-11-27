import { z } from "zod";
import { audit, WorkflowError } from "./assignments";
import { db, transaction } from "./db";
import type { Scope } from "./scope";

// FC-027: staff meetings. The organizer invites current staff, records minutes and assigns follow-up actions to
// participants; each owner closes their own action. Only participants (and the organizer) see a meeting.
const unavailable = () => new WorkflowError("This action is unavailable.");
const staff = `('faculty','hod','admin','principal')`;
const meStaff = `EXISTS (SELECT 1 FROM membership me WHERE me.institution_id=$1 AND me.account_id=$2 AND me.role=$3 AND me.role IN ${staff} AND me.ended_at IS NULL)`;
const participant = `EXISTS (SELECT 1 FROM meeting_participant mp WHERE (mp.institution_id,mp.meeting_id)=(mt.institution_id,mt.id) AND mp.account_id=$2)`;

export type Meeting = { id: string; title: string; starts_at: Date; agenda: string; minutes: string | null; organizer: string; organizer_id: string;
  participants: { id: string; name: string }[]; actions: { id: string; title: string; owner: string; owner_id: string; due_on: string; done_at: string | null }[] };

export async function meetings(scope: Scope) {
  return (await db.query<Meeting>(`SELECT mt.id,mt.title,mt.starts_at,mt.agenda,mt.minutes,u.name AS organizer,mt.organizer_id,
      coalesce((SELECT json_agg(json_build_object('id',pu.id,'name',pu.name) ORDER BY pu.name) FROM meeting_participant mp JOIN "user" pu ON pu.id=mp.account_id
        WHERE (mp.institution_id,mp.meeting_id)=(mt.institution_id,mt.id)),'[]') AS participants,
      coalesce((SELECT json_agg(json_build_object('id',a.id,'title',a.title,'owner',au.name,'owner_id',a.owner_id,'due_on',to_char(a.due_on,'YYYY-MM-DD'),'done_at',a.done_at) ORDER BY a.due_on)
        FROM meeting_action a JOIN "user" au ON au.id=a.owner_id WHERE (a.institution_id,a.meeting_id)=(mt.institution_id,mt.id)),'[]') AS actions
    FROM meeting mt JOIN "user" u ON u.id=mt.organizer_id
    WHERE mt.institution_id=$1 AND ${meStaff} AND (mt.organizer_id=$2 OR ${participant})
    ORDER BY mt.starts_at DESC LIMIT 50`, [scope.institution, scope.account, scope.role])).rows;
}

export async function meetingInvitees(scope: Scope) {
  return (await db.query<{ id: string; name: string }>(`SELECT DISTINCT u.id,u.name FROM membership m JOIN "user" u ON u.id=m.account_id
    WHERE m.institution_id=$1 AND m.role IN ${staff} AND m.ended_at IS NULL AND m.account_id<>$2 AND ${meStaff} ORDER BY u.name`,
  [scope.institution, scope.account, scope.role])).rows;
}

const wall = z.iso.datetime({ local: true, precision: -1 }).refine(v => !v.endsWith("Z"));
const createInput = z.object({ title: z.string().trim().min(1).max(160), start: wall, agenda: z.string().trim().min(1).max(4000),
  participants: z.array(z.string().min(1).max(100)).min(1).max(40) });
export function scheduleMeeting(scope: Scope, raw: unknown) {
  const input = createInput.parse(raw);
  return transaction(async client => {
    const people = [...new Set(input.participants.filter(p => p !== scope.account))];
    const { rows: valid } = await client.query<{ account_id: string }>(`SELECT DISTINCT account_id FROM membership
      WHERE institution_id=$1 AND role IN ${staff} AND ended_at IS NULL AND account_id=ANY($2)`, [scope.institution, people]);
    if (valid.length !== people.length || !people.length) throw new WorkflowError("Invite current staff members only.");
    const { rows: [row] } = await client.query<{ id: string }>(`INSERT INTO meeting (institution_id,organizer_id,title,starts_at,agenda)
      SELECT $1,$2,$4,$5::timestamp AT TIME ZONE i.timezone,$6 FROM institution i WHERE i.id=$1 AND ${meStaff} RETURNING id`,
    [scope.institution, scope.account, scope.role, input.title, input.start, input.agenda]);
    if (!row) throw unavailable();
    await client.query("INSERT INTO meeting_participant (institution_id,meeting_id,account_id) SELECT $1,$2,unnest($3::text[])",
      [scope.institution, row.id, [scope.account, ...people]]);
    await audit(client, scope, row.id, "meeting.scheduled");
    return row.id;
  });
}

export function recordMinutes(scope: Scope, raw: unknown) {
  const input = z.object({ meeting: z.uuid(), minutes: z.string().trim().min(1).max(8000) }).parse(raw);
  return transaction(async client => {
    const { rowCount } = await client.query(`UPDATE meeting mt SET minutes=$4 WHERE mt.institution_id=$1 AND mt.id=$5 AND mt.organizer_id=$2 AND ${meStaff}
      AND mt.starts_at <= clock_timestamp()`, [scope.institution, scope.account, scope.role, input.minutes, input.meeting]);
    if (!rowCount) throw new WorkflowError("Only the organizer records minutes, after the meeting has started.");
    await audit(client, scope, input.meeting, "meeting.minuted");
  });
}

export function addMeetingAction(scope: Scope, raw: unknown) {
  const input = z.object({ meeting: z.uuid(), owner: z.string().min(1).max(100), title: z.string().trim().min(1).max(200), due: z.iso.date() }).parse(raw);
  return transaction(async client => {
    const { rows: [row] } = await client.query<{ id: string }>(`INSERT INTO meeting_action (institution_id,meeting_id,owner_id,title,due_on)
      SELECT mt.institution_id,mt.id,$5,$6,$7 FROM meeting mt WHERE mt.institution_id=$1 AND mt.id=$4 AND mt.organizer_id=$2 AND ${meStaff}
        AND EXISTS (SELECT 1 FROM meeting_participant mp WHERE (mp.institution_id,mp.meeting_id)=(mt.institution_id,mt.id) AND mp.account_id=$5) RETURNING id`,
    [scope.institution, scope.account, scope.role, input.meeting, input.owner, input.title, input.due]);
    if (!row) throw new WorkflowError("Only the organizer assigns actions, to a participant.");
    await audit(client, scope, input.meeting, "meeting.action_assigned", undefined, input.owner);
  });
}

export function completeMeetingAction(scope: Scope, id: unknown) {
  const action = z.uuid().parse(id);
  return transaction(async client => {
    const { rowCount } = await client.query(`UPDATE meeting_action SET done_at=clock_timestamp() WHERE institution_id=$1 AND id=$4 AND owner_id=$2
      AND done_at IS NULL AND EXISTS (SELECT 1 FROM membership me WHERE me.institution_id=$1 AND me.account_id=$2 AND me.role=$3 AND me.ended_at IS NULL)`,
    [scope.institution, scope.account, scope.role, action]);
    if (!rowCount) throw unavailable();
    await audit(client, scope, action, "meeting.action_done");
  });
}
