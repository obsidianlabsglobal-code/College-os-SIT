import {createHash,createHmac,randomBytes,timingSafeEqual} from "node:crypto";
import {z} from "zod";
import type {Scope} from "../scope";
import {audit,WorkflowError} from "../assignments";
import {db,transaction} from "../db";
import {accountInActiveDepartmentSql} from "../active-departments";
import {holdRiderDepartment,holdTransportMember,transportMemberSql} from "./catalog";
import {distanceMeters} from "./osmand";

const unavailable=()=>new WorkflowError("This boarding code or trip is unavailable.");
const keyPattern=/^[A-Za-z0-9_-]{43}$/;
const signed=/^s1\.([0-9a-f-]{36})\.([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/;
const dns=(s:string)=>createHash("sha256").update(s).digest("hex");
const secret=()=>{const v=process.env.NEXUS_TRANSPORT_BOARDING_SECRET; return v && v.length>=32?v:null;};
const newKey=()=>randomBytes(32).toString("base64url");
const modeAllowed=(s:string)=>s==="simulated" ? process.env.NEXUS_TRANSPORT_SIMULATION_ENABLED==="true" :
  process.env.NEXUS_TRANSPORT_LIVE_ENABLED==="true";
function screenCode(trip:string,vehicle:string,started:Date) {
  const k=secret();if(!k)throw unavailable();
  const msg=`s1.${trip}.${vehicle}`;
  return `${msg}.${createHmac("sha256",k).update(msg+"."+started.toISOString()).digest("base64url")}`;
}
export function issueBoardCredential(s:Scope,raw:unknown){
  const i=z.object({vehicle:z.uuid(),kind:z.enum(["device","sticker"]),label:z.string().trim().min(1).max(100).optional()}).parse(raw);
  return transaction(async c=>{
    await holdTransportMember(c,s,"transport");
    const selected=await c.query("SELECT 1 FROM transport_vehicle WHERE institution_id=$1 AND id=$2 AND active FOR UPDATE",[s.institution,i.vehicle]);
    if(!selected.rowCount)throw unavailable();
    const key=newKey();
    if(i.kind==="device"){
      const {rows:[r]}=await c.query<{id:string}>(`INSERT INTO transport_boarding_device(institution_id,vehicle_id,label,digest)
        VALUES($1,$2,$3,$4) RETURNING id`,[s.institution,i.vehicle,i.label??"Boarding device",dns(key)]);
      await audit(c,s,r.id,"transport.boarding_device_issued");
      return key;
    }
    await c.query(`INSERT INTO transport_sticker(institution_id,vehicle_id,digest) VALUES($1,$2,$3)
      ON CONFLICT(institution_id,vehicle_id) DO UPDATE SET digest=EXCLUDED.digest,issued_at=clock_timestamp()`,[s.institution,i.vehicle,dns(key)]);
    await audit(c,s,i.vehicle,"transport.sticker_issued");return `b1.${key}`;
  });
}
export function revokeBoardDevice(s:Scope,raw:unknown){
  const id=z.uuid().parse(raw);
  return transaction(async c=>{
    await holdTransportMember(c,s,"transport");
    const last=await c.query("SELECT 1 FROM transport_boarding_device WHERE institution_id=$1 AND id=$2 AND revoked_at IS NULL FOR UPDATE",[s.institution,id]);
    if(!last.rowCount)throw unavailable();
    await c.query("UPDATE transport_boarding_device SET revoked_at=clock_timestamp() WHERE institution_id=$1 AND id=$2",[s.institution,id]);
    await audit(c,s,id,"transport.boarding_device_revoked");
  });
}
export async function officeBoardingDevices(s:Scope){
  if(s.role!=="transport")return [];
  return (await db.query<{id:string;label:string;vehicle:string;revoked:boolean}>(`SELECT b.id,b.label,v.label AS vehicle,b.revoked_at IS NOT NULL AS revoked
    FROM transport_boarding_device b JOIN transport_vehicle v ON (v.institution_id,v.id)=(b.institution_id,b.vehicle_id)
    WHERE b.institution_id=$1 AND EXISTS (${transportMemberSql("$2","'transport'")}) ORDER BY vehicle,b.label`,[s.institution,s.account])).rows;
}
export async function boardDisplay(credential:string) {
  if(!secret()||!keyPattern.test(credential))return null;
  const {rows:[r]}=await db.query<{vehicle:string;vehicle_id:string;id:string|null;started_at:Date|null;mode:string|null}>(`SELECT v.label AS vehicle,
    d.vehicle_id,t.id,t.started_at,t.mode FROM transport_boarding_device d
    JOIN transport_vehicle v ON (v.institution_id,v.id)=(d.institution_id,d.vehicle_id)
    LEFT JOIN transport_trip t ON (t.institution_id,t.vehicle_id)=(d.institution_id,d.vehicle_id) AND t.state='active'
    WHERE d.digest=$1 AND d.revoked_at IS NULL AND v.active`,[dns(credential)]);
  if(!r)return null;
  return {vehicle:r.vehicle,simulated:r.mode==="simulated",
    code:r.id&&r.started_at&&modeAllowed(r.mode??"")?screenCode(r.id,r.vehicle_id,r.started_at):null};
}
export function boardBus(s:Scope,raw:unknown) {
  const code=z.string().trim().min(40).max(160).parse(raw);
  const parsed=code.match(signed);
  const sticker=!parsed && code.startsWith("b1.") && keyPattern.test(code.slice(3));
  if(!parsed&&!sticker)throw unavailable();
  if(parsed&&(!z.uuid().safeParse(parsed[1]).success||!z.uuid().safeParse(parsed[2]).success))throw unavailable();
  return transaction(async c=>{
    await holdTransportMember(c,s,"student",true);await holdRiderDepartment(c,s);
    const {rows:[p]}=await c.query<{trip:string;vehicle_id:string;started_at:Date;mode:string;lat:number;lon:number;
      sample_lat:number|null;sample_lon:number|null;accuracy:number|null;recent:boolean;active:boolean}>(`
      SELECT t.id AS trip,t.vehicle_id,t.started_at,t.mode,r.lat::float AS lat,r.lon::float AS lon,x.latitude AS sample_lat,x.longitude AS sample_lon,
        x.accuracy_m AS accuracy,COALESCE(x.observed_at>=clock_timestamp()-interval '30 seconds'
        AND x.received_at>=clock_timestamp()-interval '30 seconds',false) AS recent,v.active
      FROM transport_trip_rider p JOIN transport_trip t ON (t.institution_id,t.id)=(p.institution_id,p.trip_id)
      JOIN transport_vehicle v ON (v.institution_id,v.id)=(t.institution_id,t.vehicle_id)
      JOIN transport_route_stop r ON (r.institution_id,r.route_id,r.revision,r.stop_id)=(p.institution_id,p.route_id,p.revision,p.stop_id)
      LEFT JOIN transport_latest_position l ON (l.institution_id,l.trip_id)=(t.institution_id,t.id)
      LEFT JOIN transport_position x ON (x.institution_id,x.id)=(l.institution_id,l.position_id) AND x.source=t.mode
      WHERE p.institution_id=$1 AND p.student_id=$2 AND p.released_at IS NULL AND t.state='active' FOR UPDATE OF t`,[s.institution,s.account]);
    if(!p||!p.active||!modeAllowed(p.mode))throw unavailable();
    if(parsed) {
      if(parsed[1]!==p.trip||parsed[2]!==p.vehicle_id)throw unavailable();
      const activeDevice=await c.query("SELECT 1 FROM transport_boarding_device WHERE institution_id=$1 AND vehicle_id=$2 AND revoked_at IS NULL FOR SHARE",[s.institution,p.vehicle_id]);
      if(!activeDevice.rowCount)throw unavailable();
      const expected=screenCode(p.trip,p.vehicle_id,p.started_at);
      if(!timingSafeEqual(Buffer.from(expected),Buffer.from(code)))throw unavailable();
    }else{
      const {rowCount}=await c.query("SELECT 1 FROM transport_sticker WHERE institution_id=$1 AND vehicle_id=$2 AND digest=$3 FOR SHARE",[s.institution,p.vehicle_id,dns(code.slice(3))]);
      if(!rowCount)throw unavailable();
    }
    if(!p.recent || p.sample_lat===null || p.sample_lon===null || (p.accuracy??30)>100 ||
      distanceMeters(p.lat,p.lon,p.sample_lat,p.sample_lon)>150)throw new WorkflowError("The bus location is not confirmed near your assigned stop. Ask the transport office.");
    const saved=await c.query("INSERT INTO transport_boarding(institution_id,trip_id,student_id,method) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
      [s.institution,p.trip,s.account,parsed?"screen":"sticker"]);
    if(!saved.rowCount)throw new WorkflowError("You already boarded this trip.");
    await audit(c,s,p.trip,"transport.boarded",undefined,s.account);return p.trip;
  });
}
export async function riderBoardingHistory(s:Scope){
  if(s.role!=="student")return [];
  return (await db.query<{trip:string;route:string;stop:string;vehicle:string;day:string}>(`SELECT t.id AS trip,v.label AS vehicle,r.label AS route,x.label AS stop,
    to_char(t.service_on,'YYYY-MM-DD') AS day FROM transport_boarding b
    JOIN transport_trip_rider p ON (p.institution_id,p.trip_id,p.student_id)=(b.institution_id,b.trip_id,b.student_id)
    JOIN transport_trip t ON (t.institution_id,t.id)=(p.institution_id,p.trip_id)
    JOIN transport_route r ON (r.institution_id,r.id)=(t.institution_id,t.route_id)
    JOIN transport_vehicle v ON (v.institution_id,v.id)=(t.institution_id,t.vehicle_id)
    JOIN transport_route_stop x ON (x.institution_id,x.route_id,x.revision,x.stop_id)=(p.institution_id,p.route_id,p.revision,p.stop_id)
    WHERE b.institution_id=$1 AND b.student_id=$2 AND EXISTS (${transportMemberSql("$2","'student'")}) AND ${accountInActiveDepartmentSql("$2")}
    ORDER BY b.boarded_at DESC LIMIT 30`,[s.institution,s.account])).rows;
}

export async function officeBoardingLog(s:Scope) {
  if(s.role!=="transport")return [];
  return (await db.query<{trip:string;day:string;vehicle:string;route:string;state:string;seats:number|null;manifest:{name:string;stop:string;boarded:boolean}[]}>(`
    SELECT t.id AS trip,to_char(t.service_on,'YYYY-MM-DD') AS day,v.label AS vehicle,r.label AS route,t.state,t.seats_at_start AS seats,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('name',u.name,'stop',x.label,'boarded',b.student_id IS NOT NULL) ORDER BY x.stop_order,u.name)
        FROM transport_trip_rider p JOIN "user" u ON u.id=p.student_id
        JOIN transport_route_stop x ON (x.institution_id,x.route_id,x.revision,x.stop_id)=(p.institution_id,p.route_id,p.revision,p.stop_id)
        LEFT JOIN transport_boarding b ON (b.institution_id,b.trip_id,b.student_id)=(p.institution_id,p.trip_id,p.student_id)
        WHERE p.institution_id=t.institution_id AND p.trip_id=t.id),'[]') AS manifest
    FROM transport_trip t JOIN transport_vehicle v ON (v.institution_id,v.id)=(t.institution_id,t.vehicle_id)
    JOIN transport_route r ON (r.institution_id,r.id)=(t.institution_id,t.route_id)
    WHERE t.institution_id=$1 AND t.started_at IS NOT NULL AND EXISTS (${transportMemberSql("$2","'transport'")})
    ORDER BY t.service_on DESC,t.started_at DESC LIMIT 30`,[s.institution,s.account])).rows;
}
