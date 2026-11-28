import type {PoolClient} from "pg";
import {z} from "zod";
import {audit,WorkflowError} from "../assignments";
import {db,transaction} from "../db";
import type {Scope} from "../scope";
import {holdTransportMember,transportMemberSql} from "./catalog";

const input=z.discriminatedUnion("operation",[
  z.object({operation:z.literal("fee-status"),student:z.string().trim().min(1).max(100),status:z.enum(["paid","due","exempt"])}),
  z.object({operation:z.literal("speed-policy"),limit:z.number().int().min(10).max(120),enabled:z.boolean()}),
]);
export function changeTransportOversight(s:Scope,raw:unknown){
  const i=input.parse(raw);
  return transaction(async c=>{
    await holdTransportMember(c,s,"transport");
    if(i.operation==="speed-policy"){
      if(i.enabled&&process.env.NEXUS_TRANSPORT_OVERSPEED_APPROVED!=="true")throw new WorkflowError("Overspeed alerting has not been authorized for this institution.");
      await c.query("SELECT institution_id FROM transport_speed_policy WHERE institution_id=$1 FOR UPDATE",[s.institution]);
      await c.query(`INSERT INTO transport_speed_policy(institution_id,enabled,limit_kmh) VALUES($1,$2,$3)
        ON CONFLICT(institution_id) DO UPDATE SET enabled=EXCLUDED.enabled,limit_kmh=EXCLUDED.limit_kmh`,[s.institution,i.enabled,i.limit]);
      await audit(c,s,s.institution,"transport.speed_policy_updated");return;
    }
    if(!(await c.query(`${transportMemberSql("$2","'student'")} FOR SHARE`,[s.institution,i.student])).rowCount ||
       !(await c.query("SELECT 1 FROM transport_choice WHERE institution_id=$1 AND student_id=$2 FOR UPDATE",[s.institution,i.student])).rowCount)
      throw new WorkflowError("Choose a current rider.");
    await c.query(`INSERT INTO transport_fee_status(institution_id,student_id,status,decided_by) VALUES($1,$2,$3,$4)
     ON CONFLICT(institution_id,student_id) DO UPDATE SET status=EXCLUDED.status,decided_by=EXCLUDED.decided_by,decided_at=clock_timestamp()`,
     [s.institution,i.student,i.status,s.account]);
    await audit(c,s,s.institution,"transport.fee_status_updated",undefined,i.student);
  });
}
export async function transportOversight(s:Scope){
  if(s.role!=="transport")return {fees:[],policy:null,alerts:[],insights:[],merge:[]};
  const args=[s.institution,s.account],isOffice=`EXISTS (${transportMemberSql("$2","'transport'")})`;
  const [fees,policy,alerts,insights]=await Promise.all([
    db.query<{id:string;name:string;route:string;status:"paid"|"due"|"exempt"|null}>(`
      SELECT p.student_id AS id,u.name,r.label AS route,f.status FROM transport_choice p
      JOIN "user" u ON u.id=p.student_id JOIN transport_route r ON (r.institution_id,r.id)=(p.institution_id,p.route_id)
      LEFT JOIN transport_fee_status f ON (f.institution_id,f.student_id)=(p.institution_id,p.student_id)
      WHERE p.institution_id=$1 AND ${isOffice} AND EXISTS (${transportMemberSql("p.student_id","'student'")}) ORDER BY u.name LIMIT 300`,args),
    db.query<{enabled:boolean;limit_kmh:number}>(`SELECT enabled,limit_kmh FROM transport_speed_policy WHERE institution_id=$1 AND ${isOffice}`,args),
    db.query<{id:string;vehicle:string;kmh:number;threshold:number}>(`SELECT t.id||'-'||extract(epoch from a.time_bucket) AS id,v.label AS vehicle,
      a.observed_kmh AS kmh,a.threshold_kmh AS threshold FROM transport_speed_alert a
      JOIN transport_trip t ON (t.institution_id,t.id)=(a.institution_id,a.trip_id)
      JOIN transport_vehicle v ON (v.institution_id,v.id)=(t.institution_id,t.vehicle_id)
      WHERE a.institution_id=$1 AND ${isOffice} ORDER BY a.time_bucket DESC LIMIT 50`,args),
    db.query<{id:string;code:string;name:string;direction:string;checkins:number;trips:number;over:number;seats:number;stops:{name:string;boardings:number}[];vehicles:{name:string;boardings:number}[]}>(`
      WITH observed AS (
        SELECT t.institution_id,t.id,t.route_id,t.vehicle_id,t.seats_at_start,count(b.student_id)::int AS n FROM transport_trip t
        LEFT JOIN transport_boarding b ON (b.institution_id,b.trip_id)=(t.institution_id,t.id)
        WHERE t.institution_id=$1 AND t.state='completed' AND t.service_on>=((clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date-30)
        GROUP BY t.institution_id,t.id
      )
      SELECT r.id,r.code,r.label AS name,r.direction,
        COALESCE(sum(o.n),0)::int AS checkins,count(o.id)::int AS trips,count(o.id) FILTER (WHERE o.n>o.seats_at_start)::int AS over,
        COALESCE(sum(o.seats_at_start),0)::int AS seats,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('name',x.label,'boardings',(SELECT count(*) FROM transport_boarding b
          JOIN transport_trip_rider p ON (p.institution_id,p.trip_id,p.student_id)=(b.institution_id,b.trip_id,b.student_id)
          JOIN observed e ON (e.institution_id,e.id)=(p.institution_id,p.trip_id) WHERE p.route_id=r.id AND p.stop_id=x.stop_id))
          ORDER BY x.stop_order) FROM transport_route_stop x WHERE (x.institution_id,x.route_id,x.revision)=(r.institution_id,r.id,r.published_revision)),'[]') AS stops,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('name',b.label,'boardings',b.n)) FROM (
          SELECT v.label,SUM(s.n)::int AS n FROM observed s JOIN transport_vehicle v ON (v.institution_id,v.id)=(s.institution_id,s.vehicle_id)
          WHERE s.route_id=r.id GROUP BY v.label ORDER BY v.label
        ) b),'[]') AS vehicles
      FROM transport_route r LEFT JOIN observed o ON (o.institution_id,o.route_id)=(r.institution_id,r.id)
      WHERE r.institution_id=$1 AND r.active AND r.published_revision IS NOT NULL AND ${isOffice} GROUP BY r.institution_id,r.id ORDER BY r.code LIMIT 100`,args)
  ]);
  const merge=insights.rows.flatMap((a,i)=>insights.rows.slice(i+1).flatMap(b=>{
    const shared=a.stops.filter(x=>b.stops.some(y=>y.name.toLowerCase()===x.name.toLowerCase())).length;
    // Read-only screening: same direction, enough observed service and more than a common campus stop.
    return a.direction===b.direction && a.trips>=3 && b.trips>=3 && shared>=2 && a.seats>0 && b.seats>0 &&
      a.checkins/a.seats<.4 && b.checkins/b.seats<.4 ? [{routes:`${a.code} + ${b.code}`,shared,a:a.checkins,b:b.checkins,sa:a.seats,sb:b.seats}]:[];
  }));
  return {fees:fees.rows,policy:policy.rows[0]??{enabled:false,limit_kmh:70},alerts:alerts.rows,insights:insights.rows,merge};
}
export async function recordSpeedAlert(c:PoolClient,tenant:string,trip:string,kmh:number|undefined){
  if(process.env.NEXUS_TRANSPORT_OVERSPEED_APPROVED!=="true"||kmh===undefined)return;
  await c.query(`INSERT INTO transport_speed_alert(institution_id,trip_id,time_bucket,threshold_kmh,observed_kmh)
    SELECT $1,$2,date_trunc('minute',clock_timestamp()),limit_kmh,round($3::double precision)::int FROM transport_speed_policy
    WHERE institution_id=$1 AND enabled AND $3::double precision>limit_kmh ON CONFLICT DO NOTHING`,[tenant,trip,kmh]);
}
