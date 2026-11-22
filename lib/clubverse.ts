import type { PoolClient } from "pg";
import { audit, WorkflowError } from "./assignments";
import { transaction } from "./db";
import type { ClubInput, EventInput } from "./club-contracts";
import type { Scope } from "./scope";

function denied(): never {
  throw new WorkflowError("This CLUBVERSE action is unavailable.");
}

export async function lockClubActor(client: PoolClient, scope: Scope) {
  if (!["student", "faculty", "admin"].includes(scope.role)) denied();
  const result = await client.query(
    "SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role=$3 AND ended_at IS NULL FOR SHARE",
    [scope.institution, scope.account, scope.role],
  );
  if (!result.rowCount) denied();
}

export function eligible(audience: string, role: Scope["role"]) {
  return (audience !== "faculty" && role === "student") || (audience !== "students" && role === "faculty");
}

export async function clubAccess(client: PoolClient, scope: Scope, club: string) {
  const { rows: [record] } = await client.query<{ state: string; audience: string }>(
    `SELECT c.state,p.audience FROM club c JOIN club_proposal p USING (institution_id,id)
     WHERE c.institution_id=$1 AND c.id=$2 FOR UPDATE OF c`, [scope.institution, club],
  );
  if (!record) denied();
  const [membership, grants] = await Promise.all([
    client.query<{ state: string }>("SELECT state FROM club_member WHERE institution_id=$1 AND club_id=$2 AND account_id=$3", [scope.institution, club, scope.account]),
    client.query<{ kind: string }>("SELECT kind FROM club_grant WHERE institution_id=$1 AND club_id=$2 AND account_id=$3 AND ended_at IS NULL", [scope.institution, club, scope.account]),
  ]);
  const state = membership.rows[0]?.state;
  const kinds = state === "active" && eligible(record.audience,scope.role) ? grants.rows.map(grant => grant.kind) : [];
  return { ...record, membership: state, member: state === "active" && eligible(record.audience,scope.role), officer: kinds.some(kind => kind === "lead" || kind === "officer"), lead: kinds.includes("lead") };
}

const proposalTransitions: Record<string, readonly string[]> = {
  draft: ["submitted"], changes_requested: ["submitted"], submitted: ["under_review"],
  under_review: ["approved", "rejected", "changes_requested"],
};
const operatorEventTransitions: Record<string, readonly string[]> = {
  draft: ["pending_approval", "cancelled"], approved: ["published", "cancelled"],
  published: ["registration_open", "cancelled"], registration_open: ["registration_closed", "cancelled"],
  registration_closed: ["in_progress", "cancelled"], in_progress: ["completed", "cancelled"],
};

async function proposalValues(client: PoolClient, input: Extract<ClubInput, { operation: "draft" | "revise" }>) {
  if (input.template && !(await client.query("SELECT 1 FROM club_template WHERE id=$1 AND category_id=$2", [input.template, input.category])).rowCount) {
    throw new WorkflowError("Choose a template from the selected category.");
  }
  return [input.category, input.template || null, input.name, input.purpose, input.rules, input.joining, input.audience];
}

async function proposals(client: PoolClient, scope: Scope, input: Extract<ClubInput, { operation: "draft" | "revise" | "proposal" }>) {
  const tenant = scope.institution;
  if (input.operation === "draft") {
    if (!eligible(input.audience, scope.role)) denied();
    const { rows: [record] } = await client.query<{ id: string }>(
      `INSERT INTO club_proposal (institution_id,founder_id,category_id,template_id,name,purpose,rules,joining,audience)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [tenant, scope.account, ...await proposalValues(client, input)],
    );
    await audit(client, scope, record.id, "club.proposal_drafted");
    return record.id;
  }

  const { rows: [record] } = await client.query<{ founder_id: string; state: string; revision: number; audience: string }>(
    "SELECT founder_id,state,revision,audience FROM club_proposal WHERE institution_id=$1 AND id=$2 FOR UPDATE", [tenant,input.id],
  );
  if (!record) denied();
  const founder = record.founder_id === scope.account && eligible(record.audience, scope.role);
  const reviewer = scope.role === "admin" && record.founder_id !== scope.account && !["draft", "changes_requested"].includes(record.state);
  if (!founder && !reviewer) denied();
  if (record.revision !== input.revision) throw new WorkflowError("This proposal changed. Refresh and try again.");
  const revision = record.revision + 1;
  if (input.operation === "revise") {
    if (!founder || !eligible(input.audience, scope.role) || !["draft", "changes_requested"].includes(record.state)) denied();
    await client.query(
      `UPDATE club_proposal SET category_id=$3,template_id=$4,name=$5,purpose=$6,rules=$7,joining=$8,audience=$9,revision=$10
       WHERE institution_id=$1 AND id=$2`, [tenant,input.id,...await proposalValues(client,input),revision],
    );
    await audit(client,scope,input.id,"club.proposal_revised",revision);
    return input.id;
  }
  if (!(proposalTransitions[record.state] ?? []).includes(input.next)) throw new WorkflowError("This proposal cannot move to that status.");
  if (input.next === "submitted" ? !founder : !reviewer) denied();
  if (["rejected", "changes_requested"].includes(input.next) && !input.note) throw new WorkflowError("Record a reason for this decision.");
  await client.query("UPDATE club_proposal SET state=$3,revision=$4,review_note=$5 WHERE institution_id=$1 AND id=$2",
    [tenant,input.id,input.next,revision,input.note || null]);
  if (input.next === "approved") {
    await candidate(client,scope,record.founder_id,record.audience);
    await client.query("INSERT INTO club (institution_id,id) VALUES ($1,$2)", [tenant,input.id]);
    await client.query("INSERT INTO club_member (institution_id,club_id,account_id,state) VALUES ($1,$2,$3,'active')", [tenant,input.id,record.founder_id]);
    await client.query("INSERT INTO club_grant (institution_id,club_id,account_id,kind) VALUES ($1,$2,$3,'lead')", [tenant,input.id,record.founder_id]);
  }
  await audit(client,scope,input.id,`club.proposal_${input.next}`,revision);
  return input.id;
}

async function candidate(client: PoolClient, scope: Scope, person: string, audience: string) {
  const { rows } = await client.query<{ role: Scope["role"] }>(
    "SELECT role FROM membership WHERE institution_id=$1 AND account_id=$2 AND ended_at IS NULL FOR SHARE",
    [scope.institution,person],
  );
  if (!rows.some(row => eligible(audience,row.role))) denied();
  return rows;
}

export async function saveEventDraft(client: PoolClient, scope: Scope, input: EventInput) {
  await lockClubActor(client,scope);
  const access = await clubAccess(client,scope,input.club);
  if (!access.officer || access.state !== "active") denied();
  const { rows: [record] } = await client.query<{ id: string }>(
    `WITH event_time AS (
       SELECT $7::timestamp AT TIME ZONE timezone AS starts,$8::timestamp AT TIME ZONE timezone AS ends
       FROM institution WHERE id=$1
     )
     INSERT INTO club_event (institution_id,club_id,author_id,title,location,requirements,starts_at,ends_at,capacity,audience)
     SELECT $1,$2,$3,$4,$5,$6,starts,ends,$9,$10 FROM event_time WHERE ends>starts AND starts>clock_timestamp() RETURNING id`,
    [scope.institution,input.club,scope.account,input.title,input.location,input.requirements,input.starts,input.ends,input.capacity,input.audience],
  );
  if (!record) throw new WorkflowError("Choose a future event start and an end after the start.");
  await audit(client,scope,record.id,"club.event_drafted");
  return record.id;
}

async function events(client: PoolClient, scope: Scope, access: Awaited<ReturnType<typeof clubAccess>>, input: Extract<ClubInput, { operation: "event-state" | "register" | "verify" }>) {
  const key = [scope.institution,input.id];
  const { rows: [event] } = await client.query<{ state: string; revision: number; capacity: number; author_id: string; audience: string; registration_time: boolean; started: boolean }>(
    `SELECT state,revision,capacity,author_id,audience,clock_timestamp()<starts_at AS registration_time,clock_timestamp()>=starts_at AS started
     FROM club_event WHERE institution_id=$1 AND id=$2 AND club_id=$3 FOR UPDATE`, [...key,input.club],
  );
  if (!event) denied();
  if (input.operation === "event-state") {
    const review = input.next === "approved" && event.state === "pending_approval" && scope.role === "admin" && event.author_id !== scope.account;
    if (!review && !(access.officer && (operatorEventTransitions[event.state] ?? []).includes(input.next))) denied();
    if (event.revision !== input.revision) throw new WorkflowError("This event changed. Refresh and try again.");
    if (["published","registration_open"].includes(input.next) && !event.registration_time) throw new WorkflowError("The event start has passed.");
    if (input.next === "in_progress" && !event.started) throw new WorkflowError("The event has not started.");
    await client.query("UPDATE club_event SET state=$3,revision=revision+1,published_at=CASE WHEN $3='published' THEN clock_timestamp() ELSE published_at END WHERE institution_id=$1 AND id=$2", [...key,input.next]);
    await audit(client,scope,input.id,`club.event_${input.next}`,event.revision+1);
    return input.id;
  }
  if (input.operation === "register") {
    if (scope.role !== "student" || !eligible(access.audience,scope.role) || (event.audience === "club" && !access.member)) denied();
    if (event.state !== "registration_open" || !event.registration_time) throw new WorkflowError("Registration is closed.");
    if ((await client.query("SELECT 1 FROM club_registration WHERE institution_id=$1 AND event_id=$2 AND account_id=$3",[...key,scope.account])).rowCount) {
      throw new WorkflowError("You are already registered.");
    }
    const { rows: [total] } = await client.query<{ count: number }>("SELECT count(*)::int AS count FROM club_registration WHERE institution_id=$1 AND event_id=$2",key);
    if (total.count >= event.capacity) throw new WorkflowError("This event is full.");
    await client.query("INSERT INTO club_registration (institution_id,event_id,account_id) VALUES ($1,$2,$3)",[...key,scope.account]);
    await audit(client,scope,input.id,"club.event_registered",undefined,scope.account);
    return input.id;
  }
  if (!access.officer || input.person === scope.account || !["in_progress","completed"].includes(event.state)) denied();
  const verified = await client.query(
    `UPDATE club_registration SET verified_at=clock_timestamp(),verified_by=$4,evidence=$5
     WHERE institution_id=$1 AND event_id=$2 AND account_id=$3 AND verified_at IS NULL`, [...key,input.person,scope.account,input.note],
  );
  if (!verified.rowCount) throw new WorkflowError("This registration is unavailable or already verified.");
  await audit(client,scope,input.id,"club.event_participation_verified",undefined,input.person);
  return input.id;
}

export function changeClub(scope: Scope, input: ClubInput) {
  return transaction(async client => {
    if (input.operation === "event-draft") return saveEventDraft(client,scope,input);
    await lockClubActor(client,scope);
    if (input.operation === "draft" || input.operation === "revise" || input.operation === "proposal") return proposals(client,scope,input);
    const access = await clubAccess(client,scope,input.club);
    const key = [scope.institution,input.club];
    if (input.operation === "club-state") {
      if (scope.role !== "admin" || access.state === "archived" || access.state === input.next) denied();
      await client.query("UPDATE club SET state=$3 WHERE institution_id=$1 AND id=$2",[...key,input.next]);
      await audit(client,scope,input.club,`club.${input.next}`);
      return input.club;
    }
    if (access.state !== "active") denied();
    if (input.operation === "event-state" || input.operation === "register" || input.operation === "verify") return events(client,scope,access,input);
    if (input.operation === "join") {
      if (!eligible(access.audience,scope.role) || ["active","requested"].includes(access.membership ?? "")) {
        throw new WorkflowError("Membership is unavailable or already requested.");
      }
      const { rows: [policy] } = await client.query<{ joining: string }>("SELECT joining FROM club_proposal WHERE institution_id=$1 AND id=$2",key);
      if (policy.joining === "invitation" && access.membership !== "invited") denied();
      const next = policy.joining === "open" || access.membership === "invited" ? "active" : "requested";
      await client.query(`INSERT INTO club_member (institution_id,club_id,account_id,state) VALUES ($1,$2,$3,$4)
        ON CONFLICT (institution_id,club_id,account_id) DO UPDATE SET state=EXCLUDED.state,updated_at=clock_timestamp()`,[...key,scope.account,next]);
      await audit(client,scope,input.club,`club.membership_${next}`,undefined,scope.account);
    } else if (input.operation === "membership") {
      const voluntary = input.next === "ended" && input.person === scope.account;
      if (!access.officer && !voluntary) denied();
      if (input.next === "invited") {
        await candidate(client,scope,input.person,access.audience);
        const result = await client.query(`INSERT INTO club_member (institution_id,club_id,account_id,state) VALUES ($1,$2,$3,'invited')
          ON CONFLICT (institution_id,club_id,account_id) DO UPDATE SET state='invited',updated_at=clock_timestamp()
          WHERE club_member.state IN ('declined','ended')`,[...key,input.person]);
        if (!result.rowCount) denied();
      } else {
        if (input.next === "active") await candidate(client,scope,input.person,access.audience);
        const result = await client.query(
          `UPDATE club_member m SET state=$4,updated_at=clock_timestamp()
           WHERE (institution_id,club_id,account_id)=($1,$2,$3)
             AND ((state='requested' AND $4 IN ('active','declined')) OR (state='active' AND $4='ended'))
             AND NOT EXISTS (SELECT 1 FROM club_grant g WHERE (g.institution_id,g.club_id,g.account_id)=(m.institution_id,m.club_id,m.account_id)
               AND g.kind='lead' AND g.ended_at IS NULL)`, [...key,input.person,input.next],
        );
        if (!result.rowCount) denied();
        if (input.next === "ended") await client.query("UPDATE club_grant SET ended_at=clock_timestamp() WHERE (institution_id,club_id,account_id)=($1,$2,$3) AND ended_at IS NULL",[...key,input.person]);
      }
      await audit(client,scope,input.club,`club.membership_${input.next}`,undefined,input.person);
    } else if (input.operation === "grant" || input.operation === "revoke") {
      if (!access.lead) denied();
      if (input.operation === "grant") {
        const roles = await candidate(client,scope,input.person,access.audience);
        if (input.kind === "advisor" && !roles.some(row => row.role === "faculty")) denied();
        const result = await client.query(
          `INSERT INTO club_grant (institution_id,club_id,account_id,kind) SELECT $1,$2,$3,$4
           FROM club_member WHERE (institution_id,club_id,account_id)=($1,$2,$3) AND state='active' ON CONFLICT DO NOTHING RETURNING id`,
          [...key,input.person,input.kind],
        );
        if (!result.rowCount) denied();
        await audit(client,scope,result.rows[0].id,"club.grant_created");
      } else {
        const result = await client.query("UPDATE club_grant SET ended_at=clock_timestamp() WHERE (institution_id,club_id,id)=($1,$2,$3) AND kind<>'lead' AND ended_at IS NULL",[...key,input.grant]);
        if (!result.rowCount) denied();
        await audit(client,scope,input.grant,"club.grant_ended");
      }
    } else if (input.operation === "handover") {
      if (!access.lead || input.person === scope.account) denied();
      await candidate(client,scope,input.person,access.audience);
      const { rows: [handover] } = await client.query<{ id: string }>(
        `INSERT INTO club_handover (institution_id,club_id,outgoing_id,incoming_id,notes)
         SELECT $1,$2,$3,$4,$5 FROM club_member WHERE (institution_id,club_id,account_id)=($1,$2,$4) AND state='active'
         ON CONFLICT DO NOTHING RETURNING id`,[...key,scope.account,input.person,input.note],
      );
      if (!handover) denied();
      await audit(client,scope,handover.id,"club.handover_submitted");
    } else if (input.operation === "cancel-handover") {
      if (scope.role !== "admin" && !access.lead) denied();
      const result = await client.query(
        "UPDATE club_handover SET cancelled_at=clock_timestamp() WHERE (institution_id,club_id,id)=($1,$2,$3) AND approved_at IS NULL AND cancelled_at IS NULL",
        [...key,input.id],
      );
      if (!result.rowCount) denied();
      await audit(client,scope,input.id,"club.handover_cancelled");
    } else {
      if (scope.role !== "admin") denied();
      const { rows: [record] } = await client.query<{ incoming_id: string; outgoing_id: string }>(
        "SELECT incoming_id,outgoing_id FROM club_handover WHERE (institution_id,club_id,id)=($1,$2,$3) AND approved_at IS NULL AND cancelled_at IS NULL FOR UPDATE",[...key,input.id],
      );
      if (!record || record.outgoing_id === scope.account || record.incoming_id === scope.account) denied();
      await candidate(client,scope,record.incoming_id,access.audience);
      const active = await client.query("SELECT 1 FROM club_member WHERE (institution_id,club_id,account_id)=($1,$2,$3) AND state='active'",[...key,record.incoming_id]);
      if (!active.rowCount) denied();
      const ended = await client.query("UPDATE club_grant SET ended_at=clock_timestamp() WHERE (institution_id,club_id,account_id)=($1,$2,$3) AND ended_at IS NULL RETURNING kind",[...key,record.outgoing_id]);
      if (!ended.rows.some(row => row.kind === "lead")) denied();
      await client.query("INSERT INTO club_grant (institution_id,club_id,account_id,kind) VALUES ($1,$2,$3,'lead')",[...key,record.incoming_id]);
      await client.query("UPDATE club_handover SET approved_at=clock_timestamp() WHERE (institution_id,club_id,id)=($1,$2,$3)",[...key,input.id]);
      await audit(client,scope,input.id,"club.handover_approved");
    }
    return input.club;
  });
}
