import {db} from "../db";
import type {Scope} from "../scope";
import {accountInActiveDepartmentSql} from "../active-departments";
import {transportMemberSql} from "./catalog";
import {computeTransportEta,type RoutePoint} from "./eta";
export async function studentTimeline(s:Scope){
  if(s.role!=="student")return null;
  const allowLive=process.env.NEXUS_TRANSPORT_LIVE_ENABLED==="true";
  const args=[s.institution,s.account,allowLive,process.env.NEXUS_TRANSPORT_RIDER_BACKUP_ENABLED==="true"];
  const {rows:[row]}=await db.query<{
    id:string;route:string;vehicle:string;mode:"live"|"simulated";departure:Date;pickup:string;
    stops:RoutePoint[]; alerted_at:Date|null; seats:number|null; boarded:number; backup:{lat:number;lon:number;observedAt:string;receivedAt:string}|null; fix:{lat:number;lon:number;observedAt:string;receivedAt:string}|null;
  }>(`SELECT t.id,r.label AS route,v.label AS vehicle,t.mode,t.scheduled_departure_at AS departure,p.stop_id AS pickup,t.seats_at_start AS seats,
    (SELECT count(*)::int FROM transport_boarding b WHERE (b.institution_id,b.trip_id)=(t.institution_id,t.id)) AS boarded,
    (SELECT alerted_at FROM transport_pickup_alert n WHERE (n.institution_id,n.trip_id,n.student_id)=(p.institution_id,p.trip_id,p.student_id)) AS alerted_at,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',rs.stop_id,'label',rs.label,'lat',rs.lat,'lon',rs.lon,'offset',rs.arrival_offset_min) ORDER BY rs.stop_order)
      FROM transport_route_stop rs WHERE (rs.institution_id,rs.route_id,rs.revision)=(t.institution_id,t.route_id,t.revision)),'[]') AS stops,
    (SELECT jsonb_build_object('lat',x.latitude,'lon',x.longitude,'observedAt',x.observed_at,'receivedAt',x.received_at)
      FROM transport_latest_position l JOIN transport_position x ON (x.institution_id,x.id)=(l.institution_id,l.position_id)
      WHERE (l.institution_id,l.trip_id)=(t.institution_id,t.id) AND x.observed_at>clock_timestamp()-interval '168 hours') AS fix,
    (SELECT jsonb_build_object('lat',round(b.latitude::numeric,3),'lon',round(b.longitude::numeric,3),'observedAt',b.sampled_at,'receivedAt',b.sampled_at)
      FROM transport_backup_fix b JOIN transport_backup_consent c ON (c.institution_id,c.trip_id,c.student_id)=(b.institution_id,b.trip_id,b.student_id)
      WHERE $4::boolean AND b.institution_id=t.institution_id AND b.trip_id=t.id AND b.sampled_at>=clock_timestamp()-interval '30 seconds'
        AND c.revoked_at IS NULL AND EXISTS (${transportMemberSql("b.student_id","'student'")}) AND ${accountInActiveDepartmentSql("b.student_id")}
      ORDER BY b.sampled_at DESC LIMIT 1) AS backup
    FROM transport_trip t JOIN transport_trip_rider p ON (p.institution_id,p.trip_id)=(t.institution_id,t.id)
    JOIN transport_route r ON (r.institution_id,r.id)=(t.institution_id,t.route_id)
    JOIN transport_vehicle v ON (v.institution_id,v.id)=(t.institution_id,t.vehicle_id)
    WHERE t.institution_id=$1 AND t.state='active' AND p.student_id=$2 AND p.released_at IS NULL
      AND EXISTS (${transportMemberSql("$2","'student'")}) AND ${accountInActiveDepartmentSql("$2")} AND (t.mode='simulated' OR $3::boolean)`,args);
  if(!row)return null;
  const context={departure:row.departure.toISOString(),stops:row.stops,pickup:row.pickup,now:new Date()};
  const main=computeTransportEta({...context,fix:row.fix});
  const usedBackup=Boolean(main.state==="no-signal"&&row.backup);
  const projection=usedBackup ? {...computeTransportEta({...context,fix:row.backup}),closeToPickup:false}:main;
  return {trip:row.id,route:row.route,vehicle:row.vehicle,mode:row.mode,alertedAt:row.alerted_at?.toISOString()??null,
    seats:row.seats,boarded:row.boarded,usedBackup,...projection};
}
export type StudentTimeline=NonNullable<Awaited<ReturnType<typeof studentTimeline>>>;
