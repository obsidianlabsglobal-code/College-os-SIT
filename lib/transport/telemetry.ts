import { createHash,randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { db,transaction } from "../db";
import { audit,WorkflowError } from "../assignments";
import type { Scope } from "../scope";
import { holdTransportMember,transportMemberSql } from "./catalog";
import { recordSpeedAlert } from "./oversight";
import { recordPickupAlerts,wakePickupPhones } from "./pickup-alerts";
import { differenceInMotion } from "./telemetry-rules";
import { observation,type Observation } from "./osmand";

const liveEnabled=()=>process.env.NEXUS_TRANSPORT_LIVE_ENABLED==="true";
const digest=(token:string)=>createHash("sha256").update(token).digest("hex");
const deviceLabel=z.string().trim().min(1).max(100);
const clientId=z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/);
const credential=z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export function issueTransportDevice(s:Scope,raw:unknown) {
  const i=z.object({vehicle:z.uuid(),label:deviceLabel,clientId:clientId.optional(),
    protocol:z.enum(["sdk","stock"]).default("sdk")}).parse(raw);
  if(i.protocol==="sdk"&&!i.clientId)throw new WorkflowError("Enter the SDK client identifier.");
  return transaction(async c=>{
    await holdTransportMember(c,s,"transport");
    if(!(await c.query("SELECT 1 FROM transport_vehicle WHERE institution_id=$1 AND id=$2 AND active FOR SHARE",[s.institution,i.vehicle])).rowCount)
      throw new WorkflowError("Select an active vehicle.");
    const token=randomBytes(32).toString("base64url");
    try {
      const {rows:[r]}=await c.query<{id:string}>(`INSERT INTO transport_device(institution_id,vehicle_id,display_name,client_id,credential_digest)
        VALUES($1,$2,$3,$4,$5) RETURNING id`,[s.institution,i.vehicle,i.label,i.protocol==="stock"?"stock-"+digest(token):i.clientId,digest(token)]);
      await audit(c,s,r.id,"transport.device_issued");
      return {id:r.id,token,protocol:i.protocol};
    } catch(e) {
      if((e as {code?:string}).code==="23505")throw new WorkflowError("That identifier is already bound. Revoke it or use a new one.");
      throw e;
    }
  });
}
export function revokeTransportDevice(s:Scope,raw:unknown) {
  const id=z.uuid().parse(raw);
  return transaction(async c=>{
    await holdTransportMember(c,s,"transport");
    const {rowCount}=await c.query("SELECT 1 FROM transport_device WHERE institution_id=$1 AND id=$2 AND revoked_at IS NULL FOR UPDATE",[s.institution,id]);
    if(!rowCount)throw new WorkflowError("The binding is not active.");
    await c.query("UPDATE transport_device SET revoked_at=clock_timestamp() WHERE institution_id=$1 AND id=$2",[s.institution,id]);
    await audit(c,s,id,"transport.device_revoked");
  });
}
export async function transportDevices(s:Scope) {
  if(s.role!=="transport")return [];
  return (await db.query<{id:string;name:string;vehicle:string;revoked:boolean}>(`SELECT d.id,d.display_name AS name,v.label AS vehicle,d.revoked_at IS NOT NULL AS revoked
    FROM transport_device d JOIN transport_vehicle v ON (v.institution_id,v.id)=(d.institution_id,d.vehicle_id)
    WHERE d.institution_id=$1 AND EXISTS (${transportMemberSql("$2","'transport'")}) ORDER BY d.revoked_at NULLS FIRST,d.display_name`,[s.institution,s.account])).rows;
}
type BoundTrip={id:string;vehicle_id:string;started_at:Date};
type Result="accepted"|"quarantined"|"duplicate-or-old"|"no-trip"|"unauthorized"|"invalid-time"|"rate-limited";
const seven=7*86400_000;

async function writePosition(c:PoolClient,tenant:string,trip:BoundTrip,source:"live"|"simulated",device:string|null,fix:Observation,now:Date):Promise<Result>{
  const t=Date.parse(fix.observedAt),n=now.getTime();
  if(!Number.isFinite(t) || t>n+30_000 || t<n-seven || t<trip.started_at.getTime())return "invalid-time";
  const {rows:[old]}=await c.query<{latitude:number;longitude:number;observed_at:Date;accuracy_m:number|null}>(`
    SELECT p.latitude,p.longitude,p.observed_at,p.accuracy_m FROM transport_latest_position l
    JOIN transport_position p ON (p.institution_id,p.id)=(l.institution_id,l.position_id) WHERE l.institution_id=$1 AND l.trip_id=$2`,[tenant,trip.id]);
  if(old && t<=old.observed_at.getTime())return "duplicate-or-old";
  const quarantine=differenceInMotion(old,fix,t);
  const {rows:[entry]}=await c.query<{id:string}>(`INSERT INTO transport_position(institution_id,trip_id,vehicle_id,device_id,source,observed_at,
    latitude,longitude,accuracy_m,speed_kmh,quarantined) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    ON CONFLICT DO NOTHING RETURNING id`,[tenant,trip.id,trip.vehicle_id,device,source,fix.observedAt,fix.lat,fix.lon,fix.accuracy??null,fix.speedKmh??null,quarantine]);
  if(!entry)return "duplicate-or-old";
  if(quarantine)return "quarantined";
  await c.query(`INSERT INTO transport_latest_position(institution_id,trip_id,position_id) VALUES($1,$2,$3)
    ON CONFLICT(institution_id,trip_id) DO UPDATE SET position_id=EXCLUDED.position_id`,[tenant,trip.id,entry.id]);
  if(n-t<=90_000)await c.query("DELETE FROM transport_backup_fix WHERE institution_id=$1 AND trip_id=$2",[tenant,trip.id]);
  return "accepted";
}
export function acceptOsmAnd(token:string,reportedId:string,raw:unknown):Promise<Result>{
  if(!liveEnabled()||!credential.safeParse(token).success||!clientId.safeParse(reportedId).success)return Promise.resolve("unauthorized");
  const fix=observation.parse(raw);
  return transaction(async c=>{
    const {rows:[d]}=await c.query<{institution_id:string;id:string;vehicle_id:string;rate_window:Date|null;rate_count:number;now:Date}>(`
      SELECT d.institution_id,d.id,d.vehicle_id,d.rate_window,d.rate_count,clock_timestamp() AS now FROM transport_device d
      JOIN transport_vehicle v ON (v.institution_id,v.id)=(d.institution_id,d.vehicle_id)
      WHERE d.credential_digest=$1 AND d.client_id=$2 AND d.revoked_at IS NULL AND v.active FOR UPDATE OF d`,[digest(token),reportedId]);
    if(!d)return "unauthorized";
    const current=!!d.rate_window && d.now.getTime()-d.rate_window.getTime()<60_000;
    if(current && d.rate_count>=16)return "rate-limited";
    await c.query("UPDATE transport_device SET rate_window=$3,rate_count=$4 WHERE institution_id=$1 AND id=$2",
      [d.institution_id,d.id,current?d.rate_window:d.now,current?d.rate_count+1:1]);
    const {rows:[t]}=await c.query<BoundTrip>(`SELECT id,vehicle_id,started_at FROM transport_trip WHERE institution_id=$1
      AND vehicle_id=$2 AND mode='live' AND state='active' FOR UPDATE`,[d.institution_id,d.vehicle_id]);
    if(!t)return "no-trip";
    const result=await writePosition(c,d.institution_id,t,"live",d.id,fix,d.now);
    if(result!=="accepted") return result;
    const wake=await recordPickupAlerts(c,d.institution_id,t.id,fix,d.now);
    if(d.now.getTime()-Date.parse(fix.observedAt)<=30_000) await recordSpeedAlert(c,d.institution_id,t.id,fix.speedKmh);
    return { result, tenant:d.institution_id, trip:t.id, wake };
  }).then(async r=>{
    if(typeof r==="string")return r;
    // Position and the modal-independent in-app receipt survived commit. External push is best effort.
    try { await wakePickupPhones(r.tenant,r.trip,r.wake); } catch { /* keep the in-app receipt */ }
    return r.result;
  });
}
export function acceptStockOsmAnd(deviceIdentifier:string,raw:unknown) {
  if(!credential.safeParse(deviceIdentifier).success)return Promise.resolve("unauthorized" as const);
  return acceptOsmAnd(deviceIdentifier,"stock-"+digest(deviceIdentifier),raw);
}
export function publishFictionalTransportPosition(s:Scope,raw:unknown){
  const i=z.object({trip:z.uuid(),fix:observation}).parse(raw);
  if(process.env.NEXUS_TRANSPORT_SIMULATION_ENABLED!=="true")throw new WorkflowError("Fictional transport simulation is turned off.");
  return transaction(async c=>{
    await holdTransportMember(c,s,"transport");
    const {rows:[t]}=await c.query<BoundTrip & {now:Date}>(`SELECT id,vehicle_id,started_at,clock_timestamp() AS now FROM transport_trip
       WHERE institution_id=$1 AND id=$2 AND mode='simulated' AND state='active' FOR UPDATE`,[s.institution,i.trip]);
    if(!t)return "no-trip" as const;
    const result=await writePosition(c,s.institution,t,"simulated",null,i.fix,t.now);
    if(result==="accepted") {
      await recordPickupAlerts(c,s.institution,t.id,i.fix,t.now);
      await audit(c,s,t.id,"transport.simulation_fix_accepted");
    }
    return result;
  });
}
export function purgeTransportHistory(s:Scope) {
  return transaction(async c=>{
    await holdTransportMember(c,s,"transport");
    const {rowCount}=await c.query("DELETE FROM transport_position WHERE institution_id=$1 AND observed_at < clock_timestamp()-interval '168 hours'",[s.institution]);
    await audit(c,s,s.institution,"transport.position_retention_applied");
    return Number(rowCount??0);
  });
}
