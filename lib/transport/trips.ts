import { z } from "zod";
import { audit,WorkflowError } from "../assignments";
import { accountInActiveDepartmentSql } from "../active-departments";
import { db,transaction } from "../db";
import type { Scope } from "../scope";
import { holdTransportMember, transportMemberSql } from "./catalog";

const unavailable=()=>new WorkflowError("This trip or operation is unavailable.");
const configuredLive=()=>process.env.NEXUS_TRANSPORT_LIVE_ENABLED==="true";
const input=z.discriminatedUnion("operation",[
  z.object({operation:z.literal("create-trip"),schedule:z.uuid(),day:z.iso.date(),mode:z.enum(["simulated","live"]),driver:z.string().trim().min(1).max(100).optional()}),
  z.object({operation:z.enum(["start-trip","complete-trip","cancel-trip"]),trip:z.uuid()}),
]);
export function changeTransportTrip(s:Scope,raw:unknown) {
  const i=input.parse(raw);
  const tenant=s.institution;
  return transaction(async c=>{
    await holdTransportMember(c,s,"transport");
    try {
      if(i.operation==="create-trip"){
        if(i.mode==="live"&&!configuredLive()) throw new WorkflowError("Live operation has not been authorized.");
        if(i.driver && !(await c.query(`${transportMemberSql("$2","'driver'")} FOR SHARE`,[tenant,i.driver])).rowCount) throw unavailable();
        const {rows:[schedule]}=await c.query<{route_id:string}>(`SELECT route_id FROM transport_schedule
          WHERE institution_id=$1 AND id=$2 AND active`,[tenant,i.schedule]);
        if(!schedule || !(await c.query("SELECT 1 FROM transport_route WHERE institution_id=$1 AND id=$2 AND active FOR UPDATE",[tenant,schedule.route_id])).rowCount) throw unavailable();
        const {rows:[created]}=await c.query<{id:string}>(`INSERT INTO transport_trip(institution_id,schedule_id,route_id,revision,vehicle_id,service_on,
          scheduled_departure_at,mode,driver_id,created_by)
          SELECT x.institution_id,x.id,x.route_id,x.revision,x.vehicle_id,$3::date,($3::date+x.departure) AT TIME ZONE 'Asia/Kolkata',$4,$5,$6
          FROM transport_schedule x JOIN transport_vehicle v ON (v.institution_id,v.id)=(x.institution_id,x.vehicle_id)
          WHERE x.institution_id=$1 AND x.id=$2 AND x.active AND v.active AND x.weekday=EXTRACT(ISODOW FROM $3::date) FOR SHARE OF x,v
          RETURNING id`,[tenant,i.schedule,i.day,i.mode,i.driver??null,s.account]);
        if(!created) throw new WorkflowError("Choose an active schedule and a date on its service day.");
        await audit(c,s,created.id,"transport.trip_scheduled");return created.id;
      }
      const {rows:[candidate]}=await c.query<{route_id:string}>("SELECT route_id FROM transport_trip WHERE institution_id=$1 AND id=$2",[tenant,i.trip]);
      if(!candidate || !(await c.query("SELECT 1 FROM transport_route WHERE institution_id=$1 AND id=$2 FOR UPDATE",[tenant,candidate.route_id])).rowCount) throw unavailable();
      const {rows:[t]}=await c.query<{state:string;mode:string;route_id:string;revision:number;driver_id:string|null;same_day:boolean}>(`
        SELECT t.state,t.mode,t.route_id,t.revision,t.driver_id,
        service_on=(clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date AS same_day FROM transport_trip t
        WHERE t.institution_id=$1 AND t.id=$2 FOR UPDATE`,[tenant,i.trip]);
      if(!t) throw unavailable();
      if(i.operation==="start-trip"){
        if(t.state!=="scheduled") throw new WorkflowError("This trip has already changed. Reload to check its state.");
        if(t.mode==="live" && (!configuredLive() || !t.same_day || !t.driver_id)) throw new WorkflowError("Live operation requires approval, a current driver and today's trip.");
        if(t.driver_id && !(await c.query(`${transportMemberSql("$2","'driver'")} FOR SHARE`,[tenant,t.driver_id])).rowCount) throw unavailable();
        await c.query(`UPDATE transport_trip t SET state='active',started_at=clock_timestamp(),seats_at_start=v.seat_capacity
          FROM transport_vehicle v WHERE t.institution_id=$1 AND t.id=$2 AND (v.institution_id,v.id)=(t.institution_id,t.vehicle_id)`,[tenant,i.trip]);
        await c.query(`INSERT INTO transport_trip_rider(institution_id,trip_id,student_id,route_id,revision,stop_id)
          SELECT p.institution_id,$2,p.student_id,p.route_id,$4,p.stop_id FROM transport_choice p
          JOIN transport_route_stop r ON (r.institution_id,r.route_id,r.revision,r.stop_id)=(p.institution_id,p.route_id,$4,p.stop_id)
          WHERE p.institution_id=$1 AND p.route_id=$3 AND EXISTS (${transportMemberSql("p.student_id","'student'")})
            AND ${accountInActiveDepartmentSql("p.student_id")}
          ORDER BY p.student_id ON CONFLICT DO NOTHING`,[tenant,i.trip,t.route_id,t.revision]);
        await audit(c,s,i.trip,"transport.trip_started");return i.trip;
      }
      if(t.state==="completed" || t.state==="cancelled" || (i.operation==="complete-trip"&&t.state!=="active")) throw unavailable();
      const state=i.operation==="complete-trip"?"completed":"cancelled";
      await c.query("UPDATE transport_trip SET state=$3,ended_at=clock_timestamp() WHERE institution_id=$1 AND id=$2",[tenant,i.trip,state]);
      await c.query("UPDATE transport_trip_rider SET released_at=clock_timestamp() WHERE institution_id=$1 AND trip_id=$2 AND released_at IS NULL",[tenant,i.trip]);
      await c.query("DELETE FROM transport_backup_fix WHERE institution_id=$1 AND trip_id=$2",[tenant,i.trip]);
      await audit(c,s,i.trip,`transport.trip_${state}`);return i.trip;
    }catch(e){
      if((e as {code?:string}).code==="23505") throw new WorkflowError("A trip already exists for that schedule or the route, bus or driver is in use.");
      throw e;
    }
  });
}
export type RiderTrip={id:string;route:string;vehicle:string;stop:string;scheduled_at:string;mode:"live"|"simulated"};
export async function studentActiveTrip(s:Scope){
  if(s.role!=="student")return null;
  const {rows:[row]}=await db.query<RiderTrip>(`SELECT t.id,a.label AS route,v.label AS vehicle,r.label AS stop,t.mode,
    to_char((t.scheduled_departure_at+make_interval(mins=>r.arrival_offset_min::int)) AT TIME ZONE 'Asia/Kolkata','HH24:MI') AS scheduled_at
    FROM transport_trip t JOIN transport_trip_rider p ON (p.institution_id,p.trip_id)=(t.institution_id,t.id)
    JOIN transport_route a ON (a.institution_id,a.id)=(t.institution_id,t.route_id)
    JOIN transport_vehicle v ON (v.institution_id,v.id)=(t.institution_id,t.vehicle_id)
    JOIN transport_route_stop r ON (r.institution_id,r.route_id,r.revision,r.stop_id)=(p.institution_id,p.route_id,p.revision,p.stop_id)
    WHERE t.institution_id=$1 AND t.state='active' AND p.released_at IS NULL AND p.student_id=$2
    AND EXISTS (${transportMemberSql("$2","'student'")}) AND ${accountInActiveDepartmentSql("$2")}
    AND (t.mode='simulated' OR $3::boolean)`,[s.institution,s.account,configuredLive()]);
  return row??null;
}

export async function officeTripList(s:Scope){
  if(s.role!=="transport")return {trips:[],drivers:[]};
  const args=[s.institution,s.account];
  const [trips,drivers]=await Promise.all([
    db.query<{id:string;route:string;vehicle:string;day:string;departure:string;mode:"live"|"simulated";state:string}>(`
      SELECT t.id,r.label AS route,v.label AS vehicle,to_char(t.service_on,'YYYY-MM-DD') AS day,
        to_char(t.scheduled_departure_at AT TIME ZONE 'Asia/Kolkata','HH24:MI') AS departure,t.mode,t.state
      FROM transport_trip t JOIN transport_route r ON (r.institution_id,r.id)=(t.institution_id,t.route_id)
      JOIN transport_vehicle v ON (v.institution_id,v.id)=(t.institution_id,t.vehicle_id)
      WHERE t.institution_id=$1 AND EXISTS (${transportMemberSql("$2","'transport'")})
      ORDER BY (t.state='active') DESC,t.service_on DESC,t.id LIMIT 60`,args),
    db.query<{id:string;name:string}>(`SELECT DISTINCT u.id,u.name FROM membership m JOIN "user" u ON u.id=m.account_id
      WHERE m.institution_id=$1 AND m.role='driver' AND m.ended_at IS NULL AND EXISTS (${transportMemberSql("$2","'transport'")})
      ORDER BY u.name,u.id`,args)
  ]);
  return {trips:trips.rows,drivers:drivers.rows};
}
