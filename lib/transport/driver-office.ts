import {z} from "zod";
import {db,transaction} from "../db";
import {audit,WorkflowError} from "../assignments";
import type {Scope} from "../scope";
import {holdTransportMember,transportMemberSql} from "./catalog";
import {resolveDriverPhone} from "./driver-phone";

const dispute=()=>new WorkflowError("This driver office operation is unavailable.");
const person=z.string().trim().min(1).max(100);
const docKinds=["licence","fitness","insurance","permit","puc"] as const;
const input=z.discriminatedUnion("operation",[
  z.object({operation:z.literal("driver-send-message"),trip:z.uuid(),kind:z.enum(["replacement","diversion","stop_change"]),
    bodyEn:z.string().trim().min(1).max(240),bodyKn:z.string().trim().min(1).max(240)}),
  z.object({operation:z.literal("driver-document-expiry"),vehicle:z.uuid(),driver:person,kind:z.enum(docKinds),expiry:z.iso.date()}),
  z.object({operation:z.literal("driver-decide-leave"),request:z.uuid(),decision:z.enum(["approved","rejected"])}),
]);
export function driverOfficeAction(s:Scope,raw:unknown) {
  const i=input.parse(raw);
  return transaction(async c=>{
    await holdTransportMember(c,s,"transport");
    const tenant=s.institution;
    if(i.operation==="driver-send-message"){
      const {rows:[t]}=await c.query<{driver_id:string}>(`SELECT driver_id FROM transport_trip
        WHERE institution_id=$1 AND id=$2 AND state IN ('scheduled','active') AND driver_id IS NOT NULL FOR UPDATE`,[tenant,i.trip]);
      if(!t)throw dispute();
      await holdTransportMember(c,{...s,role:"driver",account:t.driver_id},"driver");
      const {rows:[m]}=await c.query<{id:string}>(`INSERT INTO transport_driver_message(institution_id,trip_id,kind,body_en,body_kn,issued_by)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[tenant,i.trip,i.kind,i.bodyEn,i.bodyKn,s.account]);
      await audit(c,s,m.id,"transport.driver_office_message");return;
    }
    if(i.operation==="driver-document-expiry"){
      await holdTransportMember(c,{...s,role:"driver",account:i.driver},"driver");
      if(!(await c.query("SELECT 1 FROM transport_vehicle WHERE institution_id=$1 AND id=$2 AND active FOR SHARE",[tenant,i.vehicle])).rowCount)throw dispute();
      const {rows:[d]}=await c.query<{id:string}>(`INSERT INTO transport_driver_document(institution_id,vehicle_id,driver_id,kind,expiry)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT (institution_id,vehicle_id,driver_id,kind)
        DO UPDATE SET expiry=excluded.expiry RETURNING id`,[tenant,i.vehicle,i.driver,i.kind,i.expiry]);
      await audit(c,s,d.id,"transport.driver_document_recorded");return;
    }
    const {rows:[r]}=await c.query<{vehicle_id:string;driver_id:string;backup_driver:string|null;kind:string;day:string;valid_day:boolean}>(`
      SELECT vehicle_id,driver_id,backup_driver,kind,day::text,day>=(clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date AS valid_day
      FROM transport_driver_leave WHERE institution_id=$1 AND id=$2 AND state='pending' FOR UPDATE`,[tenant,i.request]);
    if(!r)throw dispute();
    if(i.decision==="approved"&&!r.valid_day)throw dispute();
    if(i.decision==="approved"&&r.kind==="swap"&&r.backup_driver){
      await holdTransportMember(c,{...s,role:"driver",account:r.backup_driver},"driver");
      await c.query(`UPDATE transport_trip SET driver_id=$5
        WHERE institution_id=$1 AND vehicle_id=$2 AND driver_id=$3 AND service_on=$4 AND state='scheduled'`,
        [tenant,r.vehicle_id,r.driver_id,r.day,r.backup_driver]);
    }
    await c.query(`UPDATE transport_driver_leave SET state=$3,decided_by=$4,decided_at=clock_timestamp() WHERE institution_id=$1 AND id=$2`,
      [tenant,i.request,i.decision,s.account]);
    await audit(c,s,i.request,"transport.driver_leave_"+i.decision);
  });
}
export async function officeDriverQueue(s:Scope){
  if(s.role!=="transport")return {messages:[],requests:[]};
  const args=[s.institution,s.account];
  const [m,l]=await Promise.all([
    db.query<{id:string;kind:string;read_at:Date|null;vehicle:string}>(`SELECT m.id,m.kind,m.read_at,v.label AS vehicle
      FROM transport_driver_message m JOIN transport_trip t ON (t.institution_id,t.id)=(m.institution_id,m.trip_id)
      JOIN transport_vehicle v ON (v.institution_id,v.id)=(t.institution_id,t.vehicle_id)
      WHERE m.institution_id=$1 AND EXISTS (${transportMemberSql("$2","'transport'")}) ORDER BY m.issued_at DESC LIMIT 20`,args),
    db.query<{id:string;kind:string;state:string;driver:string;day:string;vehicle:string}>(`SELECT l.id,l.kind,l.state,l.day::text,u.name AS driver,v.label AS vehicle
      FROM transport_driver_leave l JOIN "user" u ON u.id=l.driver_id JOIN transport_vehicle v ON (v.institution_id,v.id)=(l.institution_id,l.vehicle_id)
      WHERE l.institution_id=$1 AND EXISTS (${transportMemberSql("$2","'transport'")}) ORDER BY l.created_at DESC LIMIT 25`,args),
  ]);
  return {messages:m.rows,requests:l.rows};
}
export async function driverOwnRecords(tenant:string,vehicle:string,driver:string){
  const parameters=[tenant,driver,vehicle];
  const [trips,incidents,docs,requests]=await Promise.all([
    db.query<{day:string;minutes:number;route:string}>(`
      SELECT t.service_on::text AS day, floor(extract(epoch FROM t.ended_at-t.started_at)/60)::int AS minutes,r.label AS route
      FROM transport_trip t JOIN transport_route r ON (r.institution_id,r.id)=(t.institution_id,t.route_id)
      WHERE t.institution_id=$1 AND t.driver_id=$2 AND t.vehicle_id=$3 AND t.state='completed'
        AND t.service_on>=date_trunc('month',clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date
        AND EXISTS (${transportMemberSql("$2","'driver'")}) ORDER BY t.service_on DESC LIMIT 100`,parameters),
    db.query<{kind:string;state:string;date:Date}>(`
      SELECT d.kind,d.state,d.created_at AS date FROM transport_disruption d JOIN transport_trip t ON (t.institution_id,t.id)=(d.institution_id,d.trip_id)
      WHERE d.institution_id=$1 AND d.created_by=$2 AND t.vehicle_id=$3 AND EXISTS (${transportMemberSql("$2","'driver'")})
      ORDER BY d.created_at DESC LIMIT 25`,parameters),
    db.query<{kind:string;expiry:string;days:number}>(`
      SELECT kind,expiry::text, expiry-(clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date AS days FROM transport_driver_document
      WHERE institution_id=$1 AND driver_id=$2 AND vehicle_id=$3 AND EXISTS (${transportMemberSql("$2","'driver'")}) ORDER BY expiry`,parameters),
    db.query<{kind:string;day:string;state:string}>(`
      SELECT kind,day::text,state FROM transport_driver_leave WHERE institution_id=$1 AND driver_id=$2 AND vehicle_id=$3
      AND EXISTS (${transportMemberSql("$2","'driver'")}) ORDER BY day DESC LIMIT 12`,parameters)
  ]);
  return {trips:trips.rows,reports:incidents.rows.map(x=>({...x,date:x.date.toISOString()})),documents:docs.rows,requests:requests.rows};
}
export function requestDriverLeave(phone:unknown,session:unknown,raw:unknown){
  const i=z.object({kind:z.enum(["leave","swap"]),day:z.iso.date()}).parse(raw);
  return transaction(async c=>{
    const b=await resolveDriverPhone(c,phone,session,true);
    if(!b)throw dispute();
    const s:Scope={institution:b.institution_id,role:"driver",account:b.session_driver};
    await holdTransportMember(c,s,"driver");
    if(await c.query("SELECT 1 FROM transport_trip WHERE institution_id=$1 AND vehicle_id=$2 AND state='active' LIMIT 1",
      [s.institution,b.vehicle_id]).then(r=>r.rowCount))throw dispute();
    const other=b.session_driver===b.primary_driver?b.backup_driver:b.primary_driver;
    if(i.kind==="swap"&&!other)throw dispute();
    const {rows:[r]}=await c.query<{id:string}>(`INSERT INTO transport_driver_leave(institution_id,vehicle_id,driver_id,backup_driver,day,kind)
      SELECT $1,$2,$3,$4,$5,$6 WHERE $5::date>=(clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date
      ON CONFLICT DO NOTHING RETURNING id`,[s.institution,b.vehicle_id,s.account,i.kind==="swap"?other:null,i.day,i.kind]);
    if(r)await audit(c,s,r.id,"transport.driver_leave_requested");
    return {saved:true};
  });
}
