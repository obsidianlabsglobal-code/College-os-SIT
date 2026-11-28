import {z} from "zod";
import {audit,WorkflowError} from "../assignments";
import {db,transaction} from "../db";
import type {Scope} from "../scope";
import {accountInActiveDepartmentSql} from "../active-departments";
import {holdRiderDepartment,holdTransportMember,transportMemberSql} from "./catalog";
import {computeTransportEta,type RoutePoint} from "./eta";
const unavailable=()=>new WorkflowError("This transport action is unavailable.");
const friendly=(x:string)=>x.trim().slice(0,300);

export function respondToAccident(s:Scope,raw:unknown){
  const i=z.object({incident:z.uuid(),response:z.enum(["safe","need_help"])}).parse(raw);
  return transaction(async c=>{
    await holdTransportMember(c,s,"student",true);await holdRiderDepartment(c,s);
    const {rows:[d]}=await c.query<{mode:string;bus:string;stop:string}>(`
      SELECT t.mode,v.label AS bus,rs.label AS stop FROM transport_disruption d
      JOIN transport_trip t ON (t.institution_id,t.id)=(d.institution_id,d.trip_id)
      JOIN transport_vehicle v ON (v.institution_id,v.id)=(t.institution_id,t.vehicle_id)
      JOIN transport_route_stop rs ON (rs.institution_id,rs.route_id,rs.revision,rs.stop_id)=(d.institution_id,d.route_id,d.revision,d.stop_id)
      WHERE d.institution_id=$1 AND d.id=$2 AND d.kind IN ('accident_no_injuries','accident_injury') AND d.state='open'
      AND d.created_at>clock_timestamp()-interval '24 hours'
      AND EXISTS (SELECT 1 FROM transport_disruption_receipt r WHERE (r.institution_id,r.disruption_id)=(d.institution_id,d.id)
        AND r.student_id=$3 AND r.audience='aboard') FOR UPDATE OF d`,[s.institution,i.incident,s.account]);
    if(!d || (d.mode==="live"&&process.env.NEXUS_TRANSPORT_LIVE_ENABLED!=="true"))throw unavailable();
    const r=await c.query(`INSERT INTO transport_accident_response(institution_id,disruption_id,student_id,response)
      VALUES($1,$2,$3,$4) ON CONFLICT(institution_id,disruption_id,student_id) DO UPDATE
      SET response=EXCLUDED.response,responded_at=clock_timestamp() WHERE transport_accident_response.response<>EXCLUDED.response`,
      [s.institution,i.incident,s.account,i.response]);
    if(r.rowCount&&i.response==="need_help"){
      await c.query(`INSERT INTO push_message(institution_id,account_id,title,body,url)
        SELECT DISTINCT m.institution_id,m.account_id,'Rider needs assistance',$2,'/transport?institution='||m.institution_id::text||'&role=transport'
        FROM membership m WHERE m.institution_id=$1 AND m.role='transport' AND m.ended_at IS NULL`,
        [s.institution,friendly(`${d.mode==="simulated"?"SIMULATED. ":""}${d.bus} near ${d.stop}: a checked-in rider requested help. Open Transport for the incident.`)]);
    }
    if(r.rowCount)await audit(c,s,i.incident,`transport.accident_${i.response}`,undefined,s.account);
  });
}
export async function officeAccidentResponses(s:Scope){
  if(s.role!=="transport")return [];
  return (await db.query<{incident:string;name:string;response:"safe"|"need_help";at:Date}>(`
    SELECT r.disruption_id AS incident,u.name,r.response,r.responded_at AS at FROM transport_accident_response r JOIN "user" u ON u.id=r.student_id
    WHERE r.institution_id=$1 AND r.responded_at>=clock_timestamp()-interval '7 days'
    AND EXISTS (${transportMemberSql("$2","'transport'")}) ORDER BY r.responded_at DESC LIMIT 200`,[s.institution,s.account])).rows;
}
export function linkReplacement(s:Scope,raw:unknown){
  const i=z.object({incident:z.uuid(),trip:z.uuid(),stop:z.uuid()}).parse(raw);
  return transaction(async c=>{
    await holdTransportMember(c,s,"transport");
    const {rows:[d]}=await c.query<{trip_id:string;mode:string;state:string}>(`SELECT d.trip_id,d.state,t.mode FROM transport_disruption d
      JOIN transport_trip t ON (t.institution_id,t.id)=(d.institution_id,d.trip_id) WHERE d.institution_id=$1 AND d.id=$2 FOR UPDATE OF d`,
      [s.institution,i.incident]);
    if(!d||d.state!=="open"||d.trip_id===i.trip)throw unavailable();
    const {rows:[t]}=await c.query<{route_id:string;revision:number}>(`SELECT t.route_id,t.revision FROM transport_trip t JOIN transport_route_stop r
      ON (r.institution_id,r.route_id,r.revision)=(t.institution_id,t.route_id,t.revision)
      WHERE t.institution_id=$1 AND t.id=$2 AND r.stop_id=$3 AND t.mode=$4 AND t.state='active' FOR SHARE OF t`,
      [s.institution,i.trip,i.stop,d.mode]);
    if(!t)throw new WorkflowError("Choose an active replacement trip of the same tracking mode and a stop on that trip.");
    await c.query(`INSERT INTO transport_replacement(institution_id,disruption_id,replacement_trip_id,route_id,revision,stop_id)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(institution_id,disruption_id) DO UPDATE SET replacement_trip_id=EXCLUDED.replacement_trip_id,
      route_id=EXCLUDED.route_id,revision=EXCLUDED.revision,stop_id=EXCLUDED.stop_id,changed_at=clock_timestamp()`,
      [s.institution,i.incident,i.trip,t.route_id,t.revision,i.stop]);
    await audit(c,s,i.incident,"transport.replacement_assigned");
  });
}
export async function riderReplacements(s:Scope) {
  if(s.role!=="student")return [];
  const {rows}=await db.query<{incident:string;vehicle:string;mode:string;stop_id:string;departure:Date;stops:RoutePoint[];
    fix:{lat:number;lon:number;observedAt:string;receivedAt:string}|null}>(`
    SELECT x.disruption_id AS incident,v.label AS vehicle,t.mode,x.stop_id,t.scheduled_departure_at AS departure,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.stop_id,'label',r.label,'lat',r.lat,'lon',r.lon,'offset',r.arrival_offset_min)
        ORDER BY r.stop_order) FROM transport_route_stop r WHERE (r.institution_id,r.route_id,r.revision)=(t.institution_id,t.route_id,t.revision)),'[]') AS stops,
      (SELECT jsonb_build_object('lat',p.latitude,'lon',p.longitude,'observedAt',p.observed_at,'receivedAt',p.received_at)
        FROM transport_latest_position l JOIN transport_position p ON (p.institution_id,p.id)=(l.institution_id,l.position_id)
        WHERE l.institution_id=t.institution_id AND l.trip_id=t.id AND p.observed_at>clock_timestamp()-interval '90 seconds') AS fix
    FROM transport_replacement x JOIN transport_disruption d ON (d.institution_id,d.id)=(x.institution_id,x.disruption_id)
    JOIN transport_trip t ON (t.institution_id,t.id)=(x.institution_id,x.replacement_trip_id)
    JOIN transport_vehicle v ON (v.institution_id,v.id)=(t.institution_id,t.vehicle_id)
    WHERE x.institution_id=$1 AND d.state='open' AND t.state='active' AND (t.mode='simulated' OR $3::boolean)
      AND EXISTS (SELECT 1 FROM transport_disruption_receipt r WHERE (r.institution_id,r.disruption_id)=(x.institution_id,x.disruption_id) AND r.student_id=$2)
      AND EXISTS (${transportMemberSql("$2","'student'")}) AND ${accountInActiveDepartmentSql("$2")} ORDER BY x.changed_at DESC LIMIT 10`,
    [s.institution,s.account,process.env.NEXUS_TRANSPORT_LIVE_ENABLED==="true"]);
  return rows.map(r=>{
    const eta=computeTransportEta({departure:r.departure.toISOString(),stops:r.stops,pickup:r.stop_id,fix:r.fix,now:new Date()});
    const stop=eta.timeline.find(s=>s.pickup);
    return {incident:r.incident,vehicle:r.vehicle,mode:r.mode,stop:stop?.label??"Meeting stop",expected:stop?.expected??null,signal:eta.state,updated:eta.observedAt};
  });
}
