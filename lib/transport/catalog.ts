import type { PoolClient } from "pg";
import { z } from "zod";
import { accountInActiveDepartmentSql } from "../active-departments";
import { audit, WorkflowError } from "../assignments";
import { db, transaction } from "../db";
import type { Scope } from "../scope";

const label = (max:number) => z.string().trim().min(1).max(max);
const unavailable = () => new WorkflowError("Transport is unavailable for this workspace or record.");
const coords = z.object({ id:z.uuid().optional(), label:label(120), lat:z.number().min(-90).max(90),
  lon:z.number().min(-180).max(180), offset:z.number().int().min(0).max(1439) });
const ops = z.discriminatedUnion("operation",[
  z.object({operation:z.literal("create-route"),code:label(30),title:label(120),direction:z.enum(["inbound","outbound"])}),
  z.object({operation:z.literal("publish-stops"),route:z.uuid(), expected:z.number().int().min(0).max(32766),stops:z.array(coords).min(2).max(100)}),
  z.object({operation:z.literal("lock-route"),route:z.uuid(),locked:z.boolean()}),
  z.object({operation:z.literal("create-vehicle"),title:label(80),seats:z.number().int().min(1).max(250),capacity:z.number().int().min(1).max(300)}),
  z.object({operation:z.literal("create-schedule"),route:z.uuid(),vehicle:z.uuid(),weekday:z.number().int().min(1).max(7),departure:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)}),
  z.object({operation:z.literal("retire-schedule"),schedule:z.uuid()}),
  z.object({operation:z.literal("student-choice"),route:z.uuid(),stop:z.uuid()}),
]);
export const transportMemberSql = (account:string, role:string) => `SELECT 1 FROM membership m WHERE m.institution_id=$1 AND m.account_id=${account} AND m.role=${role} AND m.ended_at IS NULL`;
export async function holdTransportMember(c:PoolClient,s:Scope,role:Scope["role"],exclusive=false) {
  if(s.role!==role || !(await c.query(`${transportMemberSql("$2","$3")} FOR ${exclusive?"UPDATE":"SHARE"}`,[s.institution,s.account,role])).rowCount) throw unavailable();
}
export async function holdRiderDepartment(c:PoolClient,s:Scope) {
  // Hold a qualifying active department and either its direct membership or a current student roster.
  const direct=await c.query(`SELECT d.id FROM membership m JOIN department d ON (d.institution_id,d.id)=(m.institution_id,m.department_id)
    WHERE m.institution_id=$1 AND m.account_id=$2 AND m.role='student' AND m.ended_at IS NULL AND d.active FOR SHARE OF m,d`,[s.institution,s.account]);
  if (direct.rowCount) return;
  const rosters=await c.query(`SELECT d.id FROM roster r JOIN offering f ON (f.institution_id,f.id)=(r.institution_id,r.offering_id)
    JOIN course a ON (a.institution_id,a.id)=(f.institution_id,f.course_id)
    JOIN department d ON (d.institution_id,d.id)=(a.institution_id,a.department_id)
    WHERE r.institution_id=$1 AND r.account_id=$2 AND r.role='student' AND r.ended_at IS NULL AND d.active FOR SHARE OF r,d`,[s.institution,s.account]);
  if (!rosters.rowCount) throw unavailable();
}
async function routeLock(c:PoolClient,s:Scope,id:string) {
  const {rows:[r]}=await c.query<{published_revision:number|null;choice_locked:boolean;active:boolean}>(
    "SELECT published_revision,choice_locked,active FROM transport_route WHERE institution_id=$1 AND id=$2 FOR UPDATE",[s.institution,id]);
  if(!r || !r.active) throw unavailable();
  return r;
}
export function changeTransportCatalog(s:Scope,raw:unknown) {
  const i=ops.parse(raw);
  return transaction(async c=>{
    const rider=i.operation==="student-choice";
    await holdTransportMember(c,s,rider?"student":"transport",rider);
    const tenant=s.institution;
    try {
      if (i.operation==="create-route") {
        const {rows:[r]}=await c.query<{id:string}>("INSERT INTO transport_route(institution_id,code,label,direction) VALUES($1,$2,$3,$4) RETURNING id",
          [tenant,i.code,i.title,i.direction]);
        await audit(c,s,r.id,"transport.route_created");return r.id;
      }
      if (i.operation==="create-vehicle") {
        if(i.capacity<i.seats) throw new WorkflowError("Total capacity cannot be lower than seat capacity.");
        const {rows:[v]}=await c.query<{id:string}>("INSERT INTO transport_vehicle(institution_id,label,seat_capacity,permitted_capacity) VALUES($1,$2,$3,$4) RETURNING id",
          [tenant,i.title,i.seats,i.capacity]);
        await audit(c,s,v.id,"transport.vehicle_created");return v.id;
      }
      if (i.operation==="retire-schedule") {
        const {rows:[a]}=await c.query<{active:boolean}>("SELECT active FROM transport_schedule WHERE institution_id=$1 AND id=$2 FOR UPDATE",[tenant,i.schedule]);
        if(!a?.active) throw unavailable();
        await c.query("UPDATE transport_schedule SET active=false WHERE institution_id=$1 AND id=$2",[tenant,i.schedule]);
        await audit(c,s,i.schedule,"transport.schedule_retired");return i.schedule;
      }
      if (rider) await holdRiderDepartment(c,s);
      const r=await routeLock(c,s,i.route);
      if (i.operation==="lock-route") {
        if(r.choice_locked!==i.locked){
          await c.query("UPDATE transport_route SET choice_locked=$3 WHERE institution_id=$1 AND id=$2",[tenant,i.route,i.locked]);
          await audit(c,s,i.route,i.locked?"transport.route_locked":"transport.route_unlocked");
        }
        return i.route;
      }
      if (i.operation==="publish-stops") {
        if ((r.published_revision??0)!==i.expected) throw new WorkflowError("The stop list has changed. Reload this route.");
        if(i.stops[0].offset!==0 || i.stops.some((x,n)=>n>0 && x.offset<=i.stops[n-1].offset))
          throw new WorkflowError("Start at minute 0 and increase the scheduled time at each stop.");
        if (new Set(i.stops.map(x=>x.label.toLowerCase())).size!==i.stops.length) throw new WorkflowError("Stop names must be distinct on this route.");
        const prior=(await c.query<{stop_id:string;label:string}>(`SELECT stop_id,label FROM transport_route_stop WHERE institution_id=$1 AND route_id=$2 AND revision=$3`,[tenant,i.route,i.expected])).rows;
        const selected = i.stops.map(x=>({...x,id:x.id??prior.find(p=>p.label.toLowerCase()===x.label.toLowerCase())?.stop_id}));
        const reused = selected.flatMap(x=>x.id?[x.id]:[]);
        if(new Set(reused).size!==reused.length || reused.some(id=>!prior.some(p=>p.stop_id===id))) throw unavailable();
        const attached=await c.query("SELECT 1 FROM transport_choice WHERE institution_id=$1 AND route_id=$2 AND NOT (stop_id=ANY($3::uuid[]))",[tenant,i.route,reused]);
        if(attached.rowCount) throw new WorkflowError("Keep stops currently selected by riders, or move those riders before removing the stops.");
        const active=await c.query("SELECT 1 FROM transport_schedule WHERE institution_id=$1 AND route_id=$2 AND active",[tenant,i.route]);
        if(active.rowCount) throw new WorkflowError("Retire the old service schedules before publishing revised stops, then add schedules for the new revision.");
        const v=i.expected+1;
        await c.query("INSERT INTO transport_route_revision(institution_id,route_id,revision,published_at) VALUES($1,$2,$3,clock_timestamp())",[tenant,i.route,v]);
        for(const [n,stop] of selected.entries()){
          const id=stop.id??(await c.query<{id:string}>("INSERT INTO transport_stop(institution_id,route_id) VALUES($1,$2) RETURNING id",[tenant,i.route])).rows[0].id;
          await c.query(`INSERT INTO transport_route_stop(institution_id,route_id,revision,stop_id,stop_order,label,lat,lon,arrival_offset_min)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[tenant,i.route,v,id,n+1,stop.label,stop.lat,stop.lon,stop.offset]);
        }
        await c.query("UPDATE transport_route SET published_revision=$3 WHERE institution_id=$1 AND id=$2",[tenant,i.route,v]);
        await audit(c,s,i.route,"transport.stops_published",v);return i.route;
      }
      if (!r.published_revision) throw new WorkflowError("Publish the stops before configuring service or choosing this route.");
      if(i.operation==="create-schedule"){
        if (!(await c.query("SELECT 1 FROM transport_vehicle WHERE institution_id=$1 AND id=$2 AND active FOR SHARE",[tenant,i.vehicle])).rowCount) throw unavailable();
        const {rows:[a]}=await c.query<{id:string}>(`INSERT INTO transport_schedule(institution_id,route_id,revision,vehicle_id,weekday,departure)
          VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[tenant,i.route,r.published_revision,i.vehicle,i.weekday,i.departure]);
        await audit(c,s,a.id,"transport.schedule_created");return a.id;
      }
      if (!(await c.query("SELECT 1 FROM transport_route_stop WHERE institution_id=$1 AND route_id=$2 AND revision=$3 AND stop_id=$4",
        [tenant,i.route,r.published_revision,i.stop])).rowCount) throw unavailable();
      const {rows:[p]}=await c.query<{route_id:string;stop_id:string}>("SELECT route_id,stop_id FROM transport_choice WHERE institution_id=$1 AND student_id=$2 FOR UPDATE",[tenant,s.account]);
      if(r.choice_locked && p?.route_id!==i.route) throw new WorkflowError("This bus is full and is not accepting new route selections.");
      if(p?.route_id===i.route && p.stop_id===i.stop) return i.route;
      await c.query(`INSERT INTO transport_choice(institution_id,student_id,route_id,stop_id) VALUES($1,$2,$3,$4)
        ON CONFLICT(institution_id,student_id) DO UPDATE SET route_id=EXCLUDED.route_id,stop_id=EXCLUDED.stop_id,changed_at=clock_timestamp()`,
        [tenant,s.account,i.route,i.stop]);
      await audit(c,s,i.route,"transport.choice_updated",undefined,s.account);return i.route;
    } catch(e) {
      if((e as {code?:string}).code==="23505") throw new WorkflowError("An equivalent transport record already exists.");
      throw e;
    }
  });
}
export type TransportRoute = { id:string; code:string; label:string; direction:string; choice_locked:boolean; published_revision:number|null;
  stops:{id:string; label:string; offset:number;lat:number|null;lon:number|null}[];
  schedules:{id:string;vehicle:string;day:number;departure:string}[] };
export async function transportCatalog(s:Scope){
  const args=[s.institution,s.account,s.role];
  const access=`EXISTS (${transportMemberSql("$2","$3")}) AND ($3='transport' OR ($3='student' AND ${accountInActiveDepartmentSql("$2")}))`;
  const {rows:[{allowed}]}=await db.query<{allowed:boolean}>(`SELECT ${access} AS allowed`,args);
  if(!allowed) return null;
  const [routes,vehicles,choice]=await Promise.all([
    db.query<TransportRoute>(`SELECT r.id,r.code,r.label,r.direction,r.choice_locked,r.published_revision,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t.stop_id,'label',t.label,'offset',t.arrival_offset_min,
        'lat',CASE WHEN $3='transport' THEN t.lat END,'lon',CASE WHEN $3='transport' THEN t.lon END) ORDER BY t.stop_order)
        FROM transport_route_stop t WHERE (t.institution_id,t.route_id,t.revision)=(r.institution_id,r.id,r.published_revision)),'[]') AS stops,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t.id,'vehicle',v.label,'day',t.weekday,'departure',to_char(t.departure,'HH24:MI')) ORDER BY t.weekday,t.departure,t.id)
        FROM transport_schedule t JOIN transport_vehicle v ON (v.institution_id,v.id)=(t.institution_id,t.vehicle_id)
        WHERE t.institution_id=r.institution_id AND t.route_id=r.id AND t.active AND v.active),'[]') AS schedules
      FROM transport_route r WHERE r.institution_id=$1 AND r.active AND ($3='transport' OR r.published_revision IS NOT NULL) AND ${access}
      ORDER BY r.code,r.direction,r.id LIMIT 100`,args),
    db.query<{id:string;label:string;seat_capacity:number;permitted_capacity:number}>(`SELECT id,label,seat_capacity,permitted_capacity FROM transport_vehicle v
       WHERE institution_id=$1 AND active AND $3='transport' AND ${access} ORDER BY label LIMIT 100`,args),
    db.query<{route_id:string;stop_id:string}>(`SELECT route_id,stop_id FROM transport_choice
       WHERE institution_id=$1 AND student_id=$2 AND $3='student' AND ${access}`,args)
  ]);
  return {routes:routes.rows,vehicles:vehicles.rows,choice:choice.rows[0]??null};
}
