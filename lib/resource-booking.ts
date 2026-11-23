import type { PoolClient } from "pg";
import { audit, WorkflowError } from "./assignments";
import { clubAccess, lockClubActor } from "./clubverse";
import { transaction } from "./db";
import { resourceInput } from "./resource-contracts";
import type { Scope } from "./scope";

const unavailable = () => new WorkflowError("This booking action is unavailable.");

async function eventRecord(client: PoolClient, scope: Scope, id: string) {
  const { rows:[event] } = await client.query<{club_id:string;state:string;future:boolean}>(
    `SELECT club_id,state,starts_at>clock_timestamp() AS future FROM club_event
     WHERE (institution_id,id)=($1,$2) FOR UPDATE`,[scope.institution,id],
  );
  if (!event) throw unavailable();
  return event;
}

function acceptsBooking(event: Awaited<ReturnType<typeof eventRecord>>) {
  if (!event.future || ["cancelled","completed","in_progress"].includes(event.state)) {
    throw new WorkflowError("Only upcoming events can reserve resources.");
  }
}

export async function changeResource(scope: Scope, raw: unknown) {
  const input = resourceInput.parse(raw);
  try {
    return await transaction(async client => {
      await lockClubActor(client,scope);
      const institution = scope.institution;
      switch (input.operation) {
        case "create": {
          if (scope.role !== "admin") throw unavailable();
          const {rows:[resource]} = await client.query<{id:string}>(
            "INSERT INTO campus_resource (institution_id,name,kind,location,capacity) VALUES ($1,$2,$3,$4,$5) RETURNING id",
            [institution,input.name,input.kind,input.location,input.capacity ?? null],
          );
          await audit(client,scope,resource.id,"resource.created");
          return resource.id;
        }
        case "grant": {
          if (scope.role !== "admin") throw unavailable();
          const members = await client.query(
            "SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role IN ('admin','faculty','student') AND ended_at IS NULL FOR SHARE",
            [institution,input.account],
          );
          if (!members.rowCount) throw unavailable();
          await client.query(
            `UPDATE resource_custodian SET revoked_at=clock_timestamp()
             WHERE institution_id=$1 AND resource_id=$2 AND account_id=$3 AND revoked_at IS NULL AND ends_at<=clock_timestamp()`,
            [institution,input.resource,input.account],
          );
          const {rows:[grant]} = await client.query<{id:string}>(
            `INSERT INTO resource_custodian (institution_id,resource_id,account_id,ends_at)
             VALUES ($1,$2,$3,clock_timestamp()+make_interval(days=>$4)) RETURNING id`,
            [institution,input.resource,input.account,input.days],
          );
          await audit(client,scope,grant.id,"resource.custodian_granted",undefined,input.account);
          return grant.id;
        }
        case "revoke": {
          if (scope.role !== "admin") throw unavailable();
          const {rows:[grant]} = await client.query<{account_id:string}>(
            "UPDATE resource_custodian SET revoked_at=clock_timestamp() WHERE (institution_id,id)=($1,$2) AND revoked_at IS NULL RETURNING account_id",
            [institution,input.grant],
          );
          if (!grant) throw unavailable();
          await audit(client,scope,input.grant,"resource.custodian_revoked",undefined,grant.account_id);
          return input.grant;
        }
        case "request": {
          const {rows:[parent]} = await client.query<{club_id:string}>("SELECT club_id FROM club_event WHERE (institution_id,id)=($1,$2)",[institution,input.event]);
          if (!parent) throw unavailable();
          const club = await clubAccess(client,scope,parent.club_id);
          if (!club.officer || club.state !== "active") throw unavailable();
          acceptsBooking(await eventRecord(client,scope,input.event));
          const {rows:[existing]} = await client.query<{id:string}>(
            `SELECT id FROM resource_booking WHERE (institution_id,event_id,resource_id)=($1,$2,$3) AND state IN ('requested','confirmed')`,
            [institution,input.event,input.resource],
          );
          if (existing) return existing.id;
          const {rows:[booking]} = await client.query<{id:string}>(
            `INSERT INTO resource_booking (institution_id,event_id,resource_id,requested_by,slot)
             SELECT institution_id,id,$3,$4,tstzrange(starts_at,ends_at,'[)') FROM club_event WHERE (institution_id,id)=($1,$2) RETURNING id`,
            [institution,input.event,input.resource,scope.account],
          );
          await audit(client,scope,booking.id,"booking.requested",0,scope.account);
          return booking.id;
        }
        default: {
          const key = [institution,input.booking];
          const {rows:[parent]} = await client.query<{event_id:string;club_id:string}>(
            "SELECT b.event_id,e.club_id FROM resource_booking b JOIN club_event e ON (e.institution_id,e.id)=(b.institution_id,b.event_id) WHERE (b.institution_id,b.id)=($1,$2)",key,
          );
          if (!parent) throw unavailable();
          const club = await clubAccess(client,scope,parent.club_id);
          const event = await eventRecord(client,scope,parent.event_id);
          const {rows:[booking]} = await client.query<{resource_id:string;state:string;revision:number;requested_by:string}>(
            "SELECT resource_id,state,revision,requested_by FROM resource_booking WHERE (institution_id,id)=($1,$2) FOR UPDATE",key,
          );
          if (input.operation === "confirm") {
            await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`booking:${institution}:${booking.resource_id}`]);
          }
          const grant = await client.query(
            `SELECT 1 FROM resource_custodian WHERE (institution_id,resource_id,account_id)=($1,$2,$3)
             AND revoked_at IS NULL AND starts_at<=clock_timestamp() AND ends_at>clock_timestamp() FOR SHARE`,
            [institution,booking.resource_id,scope.account],
          );
          const organizerCancels = input.operation === "cancel" && club.officer && club.state === "active";
          if (!organizerCancels && (!grant.rowCount || (input.operation !== "cancel" && booking.requested_by === scope.account))) throw unavailable();
          const target = {confirm:"confirmed",decline:"declined",cancel:"cancelled"}[input.operation];
          if (booking.state === target && booking.revision === input.revision + 1) return input.booking;
          if (booking.revision !== input.revision) throw new WorkflowError("This booking changed. Refresh and try again.");
          if (!(booking.state === "requested" || (booking.state === "confirmed" && target === "cancelled"))) throw unavailable();
          if (target === "confirmed") {
            acceptsBooking(event);
            if (club.state !== "active") throw unavailable();
            const scheduled = await client.query(`SELECT 1 FROM resource_booking b JOIN class_session s
              ON (s.institution_id,s.room_id)=(b.institution_id,b.resource_id) AND s.slot && b.slot
              WHERE (b.institution_id,b.id)=($1,$2) AND s.state IN ('published','conducted') LIMIT 1`,key);
            if (scheduled.rowCount) throw new WorkflowError("A scheduled class overlaps this booking. The request remains pending.");
          }
          const reason = "reason" in input ? input.reason : null;
          await client.query(
            "UPDATE resource_booking SET state=$3,reason=$4,revision=revision+1,changed_at=clock_timestamp() WHERE (institution_id,id)=($1,$2)",
            [...key,target,reason],
          );
          await audit(client,scope,input.booking,`booking.${target}`,booking.revision+1,booking.requested_by);
          return input.booking;
        }
      }
    });
  } catch (error) {
    const code = (error as {code?:string}).code;
    if (code === "23P01") throw new WorkflowError("Another booking already holds this resource for part of the event. This request is still awaiting a decision.");
    if (code === "23505") throw new WorkflowError("A matching resource or custodian grant already exists.");
    if (code === "23503") throw unavailable();
    throw error;
  }
}
