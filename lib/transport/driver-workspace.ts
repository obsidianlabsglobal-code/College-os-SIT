import {createHash} from "node:crypto";
import {z} from "zod";
import type {PoolClient} from "pg";
import {audit,WorkflowError} from "../assignments";
import {db,transaction} from "../db";
import type {Scope} from "../scope";
import {holdTransportMember,transportMemberSql} from "./catalog";
import {resolveDriverPhone} from "./driver-phone";
import {stoppedFromBusFixes} from "./driver-disruptions";
import {activateTransportTrip,closeTransportTrip} from "./trips";
import {screenCode} from "./boarding";
import {writeStoppedDriverReport} from "./disruptions";
import {disruptionKinds} from "./disruption-copy";
import {computeTransportEta} from "./eta";

export const checklist = ["tyres","brakes","lights","horn","wipers","firstAid","extinguisher","fuel","charging"] as const;
const reportReasons=["traffic","rain","road_block","waiting_at_stop","other"] as const;
const reasonCopy={
  traffic:["Traffic is delaying the trip.","ಸಂಚಾರ ದಟ್ಟಣೆಯಿಂದ ಬಸ್ ತಡವಾಗಿದೆ."],
  rain:["Rain is delaying the trip.","ಮಳೆಯಿಂದ ಬಸ್ ತಡವಾಗಿದೆ."],
  road_block:["A road block is delaying the trip.","ರಸ್ತೆ ತಡೆಯಿಂದ ಬಸ್ ತಡವಾಗಿದೆ."],
  waiting_at_stop:["The bus is waiting at a stop.","ಬಸ್ ನಿಲ್ದಾಣದಲ್ಲಿ ಕಾಯುತ್ತಿದೆ."],
  other:["The office will confirm the reason.","ಸಾರಿಗೆ ಕಚೇರಿ ಕಾರಣವನ್ನು ದೃಢಪಡಿಸುತ್ತದೆ."],
};
const common={id:z.uuid(),trip:z.uuid()};
const command=z.discriminatedUnion("operation",[
  z.object({...common,operation:z.literal("check"),results:z.record(z.enum(checklist),z.boolean())}),
  z.object({...common,operation:z.literal("start")}),
  z.object({...common,operation:z.literal("end"),odometer:z.number().int().min(0).max(9999999).optional(),problems:z.string().trim().max(240).optional()}),
  z.object({...common,operation:z.literal("sos")}),
  z.object({...common,operation:z.literal("ack"),message:z.uuid()}),
  z.object({...common,operation:z.literal("report"),kind:z.enum(disruptionKinds).exclude(["trip_cancelled"]),
    reason:z.enum(reportReasons).optional(),photo:z.string().max(146668).regex(/^[A-Za-z0-9+/]+={0,2}$/).optional()}),
]);
const allowed=(mode:string)=>mode==="live"?process.env.NEXUS_TRANSPORT_LIVE_ENABLED==="true":process.env.NEXUS_TRANSPORT_SIMULATION_ENABLED==="true";
const unavailable=()=>new WorkflowError("This driver action is unavailable.");
const identity=(b:{institution_id:string;session_driver:string}):Scope=>({institution:b.institution_id,account:b.session_driver,role:"driver"});
const activeForDriver = `(CASE WHEN t.state='scheduled' THEN (t.driver_id=$3 OR t.driver_id=$4) ELSE t.driver_id=$3 END)`;
async function fixesFor(q:Pick<PoolClient,"query">,tenant:string,trip:string,mode:string){
  return (await q.query<Parameters<typeof stoppedFromBusFixes>[0][number]>(`
    SELECT latitude,longitude,speed_kmh,accuracy_m,observed_at,received_at FROM transport_position
    WHERE institution_id=$1 AND trip_id=$2 AND source=$3 AND NOT quarantined ORDER BY observed_at DESC LIMIT 2`,[tenant,trip,mode])).rows;
}
export async function driverToday(phone:unknown,session:unknown) {
  const b=await resolveDriverPhone(db,phone,session);
  if(!b)return null;
  const queueTag=createHash("sha256").update("nexus-driver-queue:"+String(session)).digest("hex").slice(0,32);
  const {rowCount:another}=await db.query(`SELECT 1 FROM transport_trip
    WHERE institution_id=$1 AND vehicle_id=$2 AND state='active' AND driver_id IS DISTINCT FROM $3`,
    [b.institution_id,b.vehicle_id,b.session_driver]);
  if(another)return {trip:null,inUse:true,queueTag};
  const reminders=(await db.query<{kind:string;lead_minutes:number}>(`SELECT kind,lead_minutes FROM transport_driver_reminder d
    WHERE d.institution_id=$1 AND d.vehicle_id=$2 AND d.driver_id=$3 AND d.due_at>statement_timestamp()
      AND (d.kind!='duty' OR EXISTS (SELECT 1 FROM transport_trip t
        WHERE (t.institution_id,t.id)=(d.institution_id,d.ref_id) AND t.driver_id=$3 AND t.state='scheduled'))
      AND (d.kind='duty' OR EXISTS (SELECT 1 FROM transport_driver_document x
        WHERE (x.institution_id,x.id)=(d.institution_id,d.ref_id) AND x.expiry=(d.due_at AT TIME ZONE 'Asia/Kolkata')::date))
    ORDER BY d.due_at LIMIT 10`,[b.institution_id,b.vehicle_id,b.session_driver])).rows;
  const {rows:[trip]}=await db.query<{id:string;vehicle:string;route:string;route_id:string;revision:number;departure:Date;
    started_at:Date|null;now:Date;state:string;mode:string;seats:number|null;boarded:number;checked:boolean;contact:string|null;door:boolean}>(`
    SELECT t.id,v.label AS vehicle,r.label AS route,t.route_id,t.revision,t.scheduled_departure_at AS departure,t.started_at,
      statement_timestamp() AS now,t.state,t.mode,t.seats_at_start AS seats,
      (SELECT count(*)::int FROM transport_boarding b WHERE (b.institution_id,b.trip_id)=(t.institution_id,t.id)) AS boarded,
      EXISTS(SELECT 1 FROM transport_driver_check b WHERE (b.institution_id,b.trip_id,b.driver_id)=(t.institution_id,t.id,$3)) AS checked,
      (SELECT phone FROM transport_driver_contact WHERE institution_id=$1) AS contact,
      EXISTS(SELECT 1 FROM transport_boarding_device d WHERE d.institution_id=t.institution_id AND d.vehicle_id=t.vehicle_id AND d.revoked_at IS NULL) AS door
    FROM transport_trip t JOIN transport_vehicle v ON (v.institution_id,v.id)=(t.institution_id,t.vehicle_id)
    JOIN transport_route r ON (r.institution_id,r.id)=(t.institution_id,t.route_id)
    WHERE t.institution_id=$1 AND t.vehicle_id=$2 AND v.active AND
      ((t.state='scheduled' AND t.service_on=(statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date) OR t.state='active')
      AND ${activeForDriver} AND EXISTS (${transportMemberSql("$3","'driver'")})
    ORDER BY (t.state='active') DESC,t.scheduled_departure_at LIMIT 1`,[b.institution_id,b.vehicle_id,b.session_driver,b.primary_driver]);
  if(!trip||!allowed(trip.mode)) {
    const inUse=await db.query("SELECT 1 FROM transport_trip WHERE institution_id=$1 AND vehicle_id=$2 AND state='active' LIMIT 1",[b.institution_id,b.vehicle_id]);
    return {trip:null,inUse:Boolean(inUse.rowCount),reminders,queueTag};
  }
  const fixes=trip.state==="active"?await fixesFor(db,b.institution_id,trip.id,trip.mode):[];
  const received=fixes[0]?.received_at??trip.started_at;
  const gpsMissing=Boolean(trip.state==="active"&&received&&trip.now.getTime()-received.getTime()>=90_000);
  const stopped=trip.state!=="active"||stoppedFromBusFixes(fixes,trip.now);
  const stopRows=trip.state==="active"?(await db.query<{id:string;label:string;lat:number;lon:number;offset:number;riders:number}>(`
    SELECT r.stop_id AS id,r.label,r.lat::float,r.lon::float,r.arrival_offset_min AS offset,
      (SELECT count(*)::int FROM transport_trip_rider p WHERE p.institution_id=$1 AND p.trip_id=$4 AND p.stop_id=r.stop_id AND p.released_at IS NULL) AS riders
    FROM transport_route_stop r WHERE r.institution_id=$1 AND r.route_id=$2 AND r.revision=$3 ORDER BY r.stop_order`,
    [b.institution_id,trip.route_id,trip.revision,trip.id])).rows:[];
  const f=fixes[0];
  const timing=computeTransportEta({departure:trip.departure.toISOString(),stops:stopRows,pickup:"",now:trip.now,
    fix:f?{lat:f.latitude,lon:f.longitude,observedAt:f.observed_at.toISOString(),receivedAt:f.received_at.toISOString()}:null});
  const qrCode=trip.state==="active"&&stopped&&trip.door&&trip.started_at&&(process.env.NEXUS_TRANSPORT_BOARDING_SECRET?.length??0)>=32
    ?screenCode(trip.id,b.vehicle_id,trip.started_at):null;
  const messages=(await db.query<{id:string;body_en:string;body_kn:string;read:boolean}>(`SELECT id,body_en,body_kn,read_at IS NOT NULL AS read
    FROM transport_driver_message WHERE institution_id=$1 AND trip_id=$2 ORDER BY issued_at DESC LIMIT 6`,[b.institution_id,trip.id])).rows;
  return {reminders,queueTag,trip:{id:trip.id,vehicle:trip.vehicle,route:trip.route,departure:trip.departure.toISOString(),state:trip.state,
    simulated:trip.mode==="simulated",seats:trip.seats,boarded:trip.boarded||null,checked:trip.checked,contact:trip.contact,stopped,gpsMissing,qrCode,messages,
    stops:timing.timeline.map((row,index)=>({label:row.label,scheduled:row.scheduled,passed:row.passed,riders:stopRows[index].riders}))}};
}
export type DriverView=Awaited<ReturnType<typeof driverToday>>;

export function applyDriverCommand(phone:unknown,session:unknown,raw:unknown) {
  const i=command.parse(raw);
  const payloadHash=createHash("sha256").update(JSON.stringify(i)).digest("hex");
  return transaction(async c=>{
    const b=await resolveDriverPhone(c,phone,session,true);
    if(!b)throw unavailable();
    const s=identity(b),tenant=s.institution;
    await holdTransportMember(c,s,"driver");
    const {rows:[prior]}=await c.query<{trip_id:string;operation:string;payload_hash:string}>(
      "SELECT trip_id,operation,payload_hash FROM transport_driver_command WHERE institution_id=$1 AND driver_id=$2 AND id=$3",[tenant,s.account,i.id]);
    if(prior){
      if(prior.trip_id!==i.trip||prior.operation!==i.operation||prior.payload_hash!==payloadHash)throw unavailable();
      return {duplicate:true};
    }
    const {rows:[candidate]}=await c.query<{route_id:string}>(`SELECT route_id FROM transport_trip t
      WHERE t.institution_id=$1 AND t.vehicle_id=$2 AND t.id=$5 AND ${activeForDriver}`,[tenant,b.vehicle_id,s.account,b.primary_driver,i.trip]);
    if(!candidate||!(await c.query("SELECT 1 FROM transport_route WHERE institution_id=$1 AND id=$2 AND active FOR UPDATE",
      [tenant,candidate.route_id])).rowCount)throw unavailable();
    const {rows:[t]}=await c.query<{id:string;revision:number;route_id:string;mode:string;state:string;today:boolean;now:Date}>(`
      SELECT t.id,t.revision,t.route_id,t.mode,t.state,t.service_on=(clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date AS today,
        clock_timestamp() AS now FROM transport_trip t JOIN transport_vehicle v
      ON (v.institution_id,v.id)=(t.institution_id,t.vehicle_id) WHERE t.institution_id=$1 AND t.vehicle_id=$2 AND v.active
      AND t.id=$5 AND ${activeForDriver} FOR UPDATE OF t`,[tenant,b.vehicle_id,s.account,b.primary_driver,i.trip]);
    if(!t||!allowed(t.mode))throw unavailable();
    if(t.state==="scheduled"&&(await c.query("SELECT 1 FROM transport_trip WHERE institution_id=$1 AND vehicle_id=$2 AND state='active' LIMIT 1",
      [tenant,b.vehicle_id])).rowCount)throw unavailable();
    if((i.operation==="check"||i.operation==="start")&&(!t.today||t.state!=="scheduled"))throw unavailable();
    if((i.operation==="sos"||i.operation==="end"||i.operation==="report")&&t.state!=="active")throw unavailable();
    const requiresParked=i.operation==="end"||i.operation==="report"||(i.operation==="ack"&&t.state==="active");
    const fixes=requiresParked?await fixesFor(c,tenant,t.id,t.mode):[];
    if(requiresParked&&!stoppedFromBusFixes(fixes,t.now))throw unavailable();
    const receipt=await c.query(`INSERT INTO transport_driver_command(institution_id,driver_id,id,trip_id,operation,payload_hash)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,[tenant,s.account,i.id,t.id,i.operation,payloadHash]);
    if(!receipt.rowCount)throw unavailable(); // concurrent different-phone retry is safe and can retry the lookup
    if(i.operation==="check"){
      const {rowCount}=await c.query(`INSERT INTO transport_driver_check(institution_id,trip_id,driver_id,results)
        VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,[tenant,t.id,s.account,JSON.stringify(i.results)]);
      if(!rowCount)throw unavailable();
      const problems=checklist.filter(x=>!i.results[x]);
      if(problems.length) {
        await c.query(`INSERT INTO transport_maintenance(institution_id,vehicle_id,opened_by,summary) VALUES($1,$2,$3,$4)`,
          [tenant,b.vehicle_id,s.account,"Driver pre-trip check: "+problems.join(", ")]);
        await c.query(`INSERT INTO case_record(institution_id,kind,subject_id,opened_by,title,body)
          VALUES($1,'transport_incident',$2,$2,'Pre-trip check needs review',$3)`,
          [tenant,s.account,"Driver reported: "+problems.join(", ")]);
      }
    }
    if(i.operation==="start"){
      const check=await c.query("SELECT 1 FROM transport_driver_check WHERE institution_id=$1 AND trip_id=$2 AND driver_id=$3",[tenant,t.id,s.account]);
      if(!check.rowCount)throw unavailable();
      await c.query("UPDATE transport_trip SET driver_id=$3 WHERE institution_id=$1 AND id=$2",[tenant,t.id,s.account]);
      await activateTransportTrip(c,tenant,t.id,t.route_id,t.revision);
    }
    if(i.operation==="end"){
      await c.query(`INSERT INTO transport_driver_end_note(institution_id,trip_id,driver_id,odometer,problems) VALUES($1,$2,$3,$4,$5)`,
        [tenant,t.id,s.account,i.odometer??null,i.problems||null]);
      await closeTransportTrip(c,tenant,t.id,"completed");
    }
    if(i.operation==="ack"){
      if(t.state!=="scheduled"&&t.state!=="active")throw unavailable();
      if(!(await c.query(`UPDATE transport_driver_message SET read_at=COALESCE(read_at,clock_timestamp()),read_by=COALESCE(read_by,$4)
        WHERE institution_id=$1 AND trip_id=$2 AND id=$3`,[tenant,t.id,i.message,s.account])).rowCount)throw unavailable();
    }
    if(i.operation==="report"){
      const {rows:[near]}=await c.query<{stop_id:string}>(`SELECT stop_id FROM transport_route_stop
        WHERE institution_id=$1 AND route_id=$2 AND revision=$3 ORDER BY power(lat::float-$4,2)+power(lon::float-$5,2),stop_order LIMIT 1`,
        [tenant,t.route_id,t.revision,fixes[0].latitude,fixes[0].longitude]);
      if(!near)throw unavailable();
      const detail=i.reason?reasonCopy[i.reason]:[];
      const disruption=await writeStoppedDriverReport(c,s,{operation:"open-disruption",trip:t.id,stop:near.stop_id,kind:i.kind,
        clock:"update",when:new Date(t.now.getTime()+600_000).toISOString(),action:"await_staff",noteEn:detail[0],noteKn:detail[1]});
      if(i.photo){
        const jpeg=Buffer.from(i.photo,"base64");
        if(jpeg.length<100||jpeg.length>110000||jpeg[0]!==255||jpeg[1]!==216||jpeg[2]!==255||jpeg.at(-2)!==255||jpeg.at(-1)!==217)throw unavailable();
        await c.query(`INSERT INTO transport_driver_report_photo(institution_id,disruption_id,jpeg) VALUES($1,$2,$3)
          ON CONFLICT DO NOTHING`,[tenant,disruption,jpeg]);
      }
    }
    if(i.operation==="sos"){
      const {rows:[vehicle]}=await c.query<{label:string}>(`SELECT label FROM transport_vehicle
        WHERE institution_id=$1 AND id=$2`,[tenant,b.vehicle_id]);
      const lastFix=(await fixesFor(c,tenant,t.id,t.mode))[0];
      const {rows:[position]}=lastFix?await c.query<{label:string}>(`SELECT label FROM transport_route_stop WHERE institution_id=$1 AND route_id=$2 AND revision=$3
        ORDER BY power(lat::float-$4,2)+power(lon::float-$5,2),stop_order LIMIT 1`,[tenant,t.route_id,t.revision,lastFix.latitude,lastFix.longitude]):{rows:[]};
      const alert=`${t.mode==="simulated"?"SIMULATED. ":""}${vehicle.label}: driver requested urgent assistance.${position?` Last bus fix near ${position.label}.`:" Bus position not available."}`.slice(0,300);
      const {rows:[last]}=await c.query<{quiet:boolean}>(`SELECT signal_at<clock_timestamp()-interval '60 seconds' AS quiet
        FROM transport_driver_sos WHERE institution_id=$1 AND trip_id=$2 FOR UPDATE`,[tenant,t.id]);
      if(last) await c.query("UPDATE transport_driver_sos SET signal_at=clock_timestamp() WHERE institution_id=$1 AND trip_id=$2",[tenant,t.id]);
      else {
        const {rows:[record]}=await c.query<{id:string}>(`INSERT INTO case_record(institution_id,kind,subject_id,opened_by,title,body)
          VALUES($1,'transport_incident',$2,$2,'Driver SOS','A bus driver requested urgent assistance. Check the active bus trip.') RETURNING id`,[tenant,s.account]);
        await c.query("INSERT INTO transport_driver_sos(institution_id,trip_id,case_id) VALUES($1,$2,$3)",[tenant,t.id,record.id]);
      }
      if(!last||last.quiet)await c.query(`INSERT INTO push_message(institution_id,account_id,title,body,url)
        SELECT $1,x.account_id,'Driver SOS',$3, '/transport?institution='||$1::text||'&role='||x.role FROM (
          SELECT DISTINCT account_id,'transport' AS role FROM membership WHERE institution_id=$1 AND role='transport' AND ended_at IS NULL
          UNION SELECT rt.faculty_id,'faculty' FROM transport_route_teacher rt WHERE rt.institution_id=$1 AND rt.route_id=$2
            AND EXISTS (${transportMemberSql("rt.faculty_id","'faculty'")})
        ) x`,[tenant,t.route_id,alert]);
    }
    await audit(c,s,t.id,`transport.driver_${i.operation}`);
    return {duplicate:false};
  });
}
