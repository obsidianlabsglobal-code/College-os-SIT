import type {PoolClient} from "pg";
import {z} from "zod";
import {audit,WorkflowError} from "../assignments";
import {db,transaction} from "../db";
import {accountInActiveDepartmentSql} from "../active-departments";
import type {Scope} from "../scope";
import {holdRiderDepartment,holdTransportMember,transportMemberSql} from "./catalog";
import {routeProjection,type RoutePoint} from "./eta";

const gate=()=>process.env.NEXUS_TRANSPORT_RIDER_BACKUP_ENABLED==="true";
const unavailable=()=>new WorkflowError("Rider backup location is not available for this trip.");
const recentBusSql=`EXISTS (SELECT 1 FROM transport_latest_position l JOIN transport_position p
 ON (p.institution_id,p.id)=(l.institution_id,l.position_id) WHERE (l.institution_id,l.trip_id)=(t.institution_id,t.id)
 AND p.observed_at>=clock_timestamp()-interval '90 seconds' AND p.received_at>=clock_timestamp()-interval '90 seconds')`;
async function lockBoarded(c:PoolClient,s:Scope,trip:string){
  await holdTransportMember(c,s,"student",true);await holdRiderDepartment(c,s);
  const {rows:[r]}=await c.query<{mode:string;recent:boolean;stops:RoutePoint[]}>(`SELECT t.mode,${recentBusSql} AS recent,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',x.stop_id,'label',x.label,'lat',x.lat,'lon',x.lon,'offset',x.arrival_offset_min) ORDER BY x.stop_order)
      FROM transport_route_stop x WHERE (x.institution_id,x.route_id,x.revision)=(t.institution_id,t.route_id,t.revision)),'[]') AS stops
    FROM transport_trip t JOIN transport_boarding b ON (b.institution_id,b.trip_id)=(t.institution_id,t.id)
    WHERE t.institution_id=$1 AND t.id=$2 AND b.student_id=$3 AND t.state='active' FOR UPDATE OF t`,[s.institution,trip,s.account]);
  if(!r || (r.mode==="live" && process.env.NEXUS_TRANSPORT_LIVE_ENABLED!=="true"))throw unavailable();
  return r;
}
export function changeBackupConsent(s:Scope,raw:unknown){
  const i=z.object({trip:z.uuid(),enabled:z.boolean()}).parse(raw);
  if(i.enabled&&!gate())throw unavailable();
  return transaction(async c=>{
    await lockBoarded(c,s,i.trip);
    const key=[s.institution,i.trip,s.account];
    if(i.enabled) await c.query(`INSERT INTO transport_backup_consent(institution_id,trip_id,student_id) VALUES($1,$2,$3)
      ON CONFLICT(institution_id,trip_id,student_id) DO UPDATE SET revoked_at=NULL,granted_at=clock_timestamp()`,key);
    else {
      await c.query("UPDATE transport_backup_consent SET revoked_at=clock_timestamp() WHERE institution_id=$1 AND trip_id=$2 AND student_id=$3 AND revoked_at IS NULL",key);
      await c.query("DELETE FROM transport_backup_fix WHERE institution_id=$1 AND trip_id=$2 AND student_id=$3",key);
    }
    await audit(c,s,i.trip,i.enabled?"transport.backup_opted_in":"transport.backup_opted_out",undefined,s.account);
  });
}
export function submitBackupFix(s:Scope,raw:unknown){
  const i=z.object({trip:z.uuid(),lat:z.number().min(-90).max(90),lon:z.number().min(-180).max(180),accuracy:z.number().min(0).max(100)}).parse(raw);
  if(!gate())throw unavailable();
  return transaction(async c=>{
    const trip=await lockBoarded(c,s,i.trip);
    if(trip.recent)return "bus-signal-available";
    const key=[s.institution,i.trip,s.account];
    const has=await c.query("SELECT 1 FROM transport_backup_consent WHERE institution_id=$1 AND trip_id=$2 AND student_id=$3 AND revoked_at IS NULL FOR SHARE",key);
    if(!has.rowCount)throw unavailable();
    if(!routeProjection(trip.stops,i))return "out-of-route";
    const r=await c.query(`INSERT INTO transport_backup_fix(institution_id,trip_id,student_id,latitude,longitude) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(institution_id,trip_id,student_id) DO UPDATE SET latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,sampled_at=clock_timestamp()
        WHERE transport_backup_fix.sampled_at<clock_timestamp()-interval '15 seconds'`,[...key,i.lat,i.lon]);
    return r.rowCount ? "saved" : "rate-limited";
  });
}
export async function backupView(s:Scope,trip:string) {
  if(!gate()||s.role!=="student")return null;
  const {rows:[row]}=await db.query<{opted:boolean;recent:boolean}>(`SELECT (c.granted_at IS NOT NULL AND c.revoked_at IS NULL) AS opted,${recentBusSql} AS recent
    FROM transport_trip t JOIN transport_boarding b ON (b.institution_id,b.trip_id)=(t.institution_id,t.id)
    LEFT JOIN transport_backup_consent c ON (c.institution_id,c.trip_id,c.student_id)=(b.institution_id,b.trip_id,b.student_id)
    WHERE t.institution_id=$1 AND t.id=$3 AND t.state='active' AND b.student_id=$2 AND
    EXISTS (${transportMemberSql("$2","'student'")}) AND ${accountInActiveDepartmentSql("$2")}`,[s.institution,s.account,trip]);
  return row??null;
}
