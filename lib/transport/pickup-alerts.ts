import type {PoolClient} from "pg";
import {z} from "zod";
import {audit} from "../assignments";
import {db,transaction} from "../db";
import {sendPush} from "../push";
import type {Scope} from "../scope";
import {accountInActiveDepartmentSql} from "../active-departments";
import {holdRiderDepartment,holdTransportMember,transportMemberSql} from "./catalog";
import {computeTransportEta,type RoutePoint} from "./eta";
import type {Observation} from "./osmand";

export function saveTransportPreferences(s:Scope,raw:unknown){
  const p=z.object({phoneAlerts:z.boolean(),locale:z.enum(["en","kn"])}).parse(raw);
  return transaction(async c=>{
    await holdTransportMember(c,s,"student",true);
    await holdRiderDepartment(c,s);
    await c.query(`INSERT INTO transport_rider_preference(institution_id,student_id,phone_alerts,notice_language) VALUES($1,$2,$3,$4)
      ON CONFLICT(institution_id,student_id) DO UPDATE SET phone_alerts=EXCLUDED.phone_alerts,notice_language=EXCLUDED.notice_language`,
      [s.institution,s.account,p.phoneAlerts,p.locale]);
    await audit(c,s,s.institution,"transport.preference_updated",undefined,s.account);
  });
}
export async function riderTransportPreferences(s:Scope) {
  if(s.role!=="student") return null;
  const {rows:[p]}=await db.query<{phone_alerts:boolean;notice_language:"en"|"kn"}>(`SELECT COALESCE(p.phone_alerts,false) AS phone_alerts,
    COALESCE(p.notice_language,'en') AS notice_language FROM membership m LEFT JOIN transport_rider_preference p
      ON (p.institution_id,p.student_id)=(m.institution_id,m.account_id)
    WHERE m.institution_id=$1 AND m.account_id=$2 AND m.role='student' AND m.ended_at IS NULL AND ${accountInActiveDepartmentSql("$2")} LIMIT 1`,
    [s.institution,s.account]);
  return p??null;
}
type PendingPhoneAlert={account:string;locale:"en"|"kn"};

export async function recordPickupAlerts(c:PoolClient,tenant:string,trip:string,fix:Observation,now:Date):Promise<PendingPhoneAlert[]>{
  const {rows:[data]}=await c.query<{departure:Date;stops:RoutePoint[]}>(`SELECT scheduled_departure_at AS departure,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.stop_id,'label',r.label,'lat',r.lat,'lon',r.lon,'offset',r.arrival_offset_min) ORDER BY r.stop_order)
      FROM transport_route_stop r WHERE (r.institution_id,r.route_id,r.revision)=(t.institution_id,t.route_id,t.revision)),'[]') AS stops
    FROM transport_trip t WHERE institution_id=$1 AND id=$2 AND state='active'`,[tenant,trip]);
  if(!data)return [];
  const view=computeTransportEta({departure:data.departure.toISOString(),stops:data.stops,pickup:"",now,
    fix:{lat:fix.lat,lon:fix.lon,observedAt:fix.observedAt,receivedAt:now.toISOString()}});
  if(view.state!=="fresh")return [];
  const eligible=view.timeline.filter(s=>!s.passed && s.expected && Date.parse(s.expected)>now.getTime()
    && Date.parse(s.expected)-now.getTime()<=300_000).map(s=>s.id);
  if(!eligible.length)return [];
  return (await c.query<PendingPhoneAlert>(`WITH inserted AS (
      INSERT INTO transport_pickup_alert(institution_id,trip_id,student_id)
      SELECT r.institution_id,r.trip_id,r.student_id FROM transport_trip_rider r
      WHERE r.institution_id=$1 AND r.trip_id=$2 AND r.stop_id=ANY($3::uuid[]) AND r.released_at IS NULL
        AND EXISTS (${transportMemberSql("r.student_id","'student'")}) AND ${accountInActiveDepartmentSql("r.student_id")}
      ON CONFLICT DO NOTHING RETURNING institution_id,student_id)
    SELECT i.student_id AS account,p.notice_language AS locale FROM inserted i JOIN transport_rider_preference p
    ON (p.institution_id,p.student_id)=(i.institution_id,i.student_id) WHERE p.phone_alerts`,[tenant,trip,eligible])).rows;
}
export async function wakePickupPhones(tenant:string,trip:string,wake:PendingPhoneAlert[]){
  if(process.env.NEXUS_TRANSPORT_PUSH_ENABLED!=="true"||!wake.length)return;
  // Re-check consent, membership and the trip state at dispatch time. The in-app receipt was saved even if a phone cannot be woken.
  const scope=(await db.query<PendingPhoneAlert>(`SELECT r.student_id AS account,p.notice_language AS locale FROM transport_trip_rider r
    JOIN transport_trip t ON (t.institution_id,t.id)=(r.institution_id,r.trip_id) JOIN transport_rider_preference p
    ON (p.institution_id,p.student_id)=(r.institution_id,r.student_id)
    WHERE r.institution_id=$1 AND r.trip_id=$2 AND r.student_id=ANY($3::text[]) AND r.released_at IS NULL AND p.phone_alerts
    AND t.state='active' AND t.mode='live' AND EXISTS (${transportMemberSql("r.student_id","'student'")})
    AND ${accountInActiveDepartmentSql("r.student_id")}`,[tenant,trip,wake.map(x=>x.account)])).rows;
  for(const lang of ["en","kn"] as const) {
    const ids=scope.filter(t=>t.locale===lang).map(t=>t.account);
    const note=lang==="en"?{title:"Your college bus is approaching",body:"Estimated at about five minutes. Check your stop and the latest update."}
      :{title:"ನಿಮ್ಮ ಕಾಲೇಜು ಬಸ್ ಸಮೀಪಿಸುತ್ತಿದೆ",body:"ಸುಮಾರು ಐದು ನಿಮಿಷದಲ್ಲಿ ಬರುವ ನಿರೀಕ್ಷೆಯಿದೆ. ನಿಮ್ಮ ನಿಲ್ದಾಣ ಮತ್ತು ಹೊಸ ಮಾಹಿತಿಯನ್ನು ನೋಡಿ."};
    await sendPush(tenant,ids,{...note,url:`/transport?institution=${encodeURIComponent(tenant)}&role=student`});
  }
}
