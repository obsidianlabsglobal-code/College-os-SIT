import {z} from "zod";
import {audit,WorkflowError} from "../assignments";
import {transaction,db} from "../db";
import type {Scope} from "../scope";
import {holdRiderDepartment,holdTransportMember,transportMemberSql} from "./catalog";
const notAvailable=()=>new WorkflowError("This action is not available for your current trip.");

export function assignRouteTeacher(s:Scope,raw:unknown){
  const i=z.object({route:z.uuid(),faculty:z.string().trim().min(1).max(100)}).parse(raw);
  return transaction(async c=>{
    await holdTransportMember(c,s,"transport");
    if(!(await c.query(`${transportMemberSql("$2","'faculty'")} FOR SHARE`,[s.institution,i.faculty])).rowCount)throw notAvailable();
    if(!(await c.query("SELECT 1 FROM transport_route WHERE institution_id=$1 AND id=$2 AND active FOR UPDATE",[s.institution,i.route])).rowCount)throw notAvailable();
    await c.query(`INSERT INTO transport_route_teacher(institution_id,route_id,faculty_id) VALUES($1,$2,$3)
      ON CONFLICT (institution_id,route_id) DO UPDATE SET faculty_id=EXCLUDED.faculty_id`,[s.institution,i.route,i.faculty]);
    await audit(c,s,i.route,"transport.sos_teacher_assigned");
  });
}
export function signalBusSos(s:Scope,raw:unknown) {
  const i=z.object({trip:z.uuid(),confirmed:z.literal(true)}).parse(raw);
  const tenant=s.institution;
  return transaction(async c=>{
    await holdTransportMember(c,s,"student",true);await holdRiderDepartment(c,s);
    const {rows:[trip]}=await c.query<{id:string;route_id:string;revision:number;mode:string;vehicle:string;lat:number|null;lon:number|null;at:Date|null}>(`
      SELECT t.id,t.route_id,t.revision,t.mode,v.label AS vehicle,p.latitude AS lat,p.longitude AS lon,p.observed_at AS at
      FROM transport_trip t JOIN transport_boarding b ON (b.institution_id,b.trip_id)=(t.institution_id,t.id)
      JOIN transport_vehicle v ON (v.institution_id,v.id)=(t.institution_id,t.vehicle_id)
      LEFT JOIN transport_latest_position l ON (l.institution_id,l.trip_id)=(t.institution_id,t.id)
      LEFT JOIN transport_position p ON (p.institution_id,p.id)=(l.institution_id,l.position_id) AND p.observed_at>=clock_timestamp()-interval '168 hours'
      WHERE t.institution_id=$1 AND t.id=$2 AND b.student_id=$3 AND t.state='active' FOR UPDATE OF t`,[tenant,i.trip,s.account]);
    if(!trip || (trip.mode==="live"?process.env.NEXUS_TRANSPORT_LIVE_ENABLED!=="true":process.env.NEXUS_TRANSPORT_SIMULATION_ENABLED!=="true"))throw notAvailable();
    const {rows:[near]}=trip.lat===null || trip.lon===null ? {rows:[]} : await c.query<{label:string}>(`
      SELECT label FROM transport_route_stop WHERE institution_id=$1 AND route_id=$2 AND revision=$3
      ORDER BY power(lat::float-$4,2)+power(lon::float-$5,2) LIMIT 1`,[tenant,trip.route_id,trip.revision,trip.lat,trip.lon]);
    const {rows:[existing]}=await c.query<{id:string;quiet:boolean}>("SELECT id,latest_signal_at<clock_timestamp()-interval '60 seconds' AS quiet FROM transport_sos WHERE institution_id=$1 AND trip_id=$2 AND student_id=$3 FOR UPDATE",
      [tenant,i.trip,s.account]);
    let id:string;
    if(existing){
      await c.query("UPDATE transport_sos SET latest_signal_at=clock_timestamp(),repeats=LEAST(repeats::bigint+1,2147483647)::int,stop_name=$3,position_at=$4 WHERE institution_id=$1 AND id=$2",
        [tenant,existing.id,near?.label??null,trip.at]);
      id=existing.id; // A repeat always refreshes the existing urgent event; only duplicate notifications are coalesced.
    } else {
      const {rows:[log]}=await c.query<{id:string}>(`INSERT INTO case_record(institution_id,kind,subject_id,opened_by,title,body)
        VALUES($1,'transport_incident',$2,$2,'Bus SOS','A checked-in rider confirmed a request for transport assistance. See the transport SOS record.') RETURNING id`,[tenant,s.account]);
      await audit(c,s,log.id,"case.opened",1);
      const {rows:[signal]}=await c.query<{id:string}>(`INSERT INTO transport_sos(institution_id,trip_id,student_id,case_id,stop_name,position_at)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[tenant,i.trip,s.account,log.id,near?.label??null,trip.at]);
      id=signal.id;
    }
    if(!existing||existing.quiet){
      // The addressed in-app queue is transactional. No external emergency service is called.
      const localTime=trip.at?new Intl.DateTimeFormat("en-IN",{timeZone:"Asia/Kolkata",hour:"2-digit",minute:"2-digit"}).format(trip.at)+" IST":"unknown";
      const position=near?.label?`Last bus position near ${near.label}, ${localTime}.`:"Last bus position unavailable.";
      const body=`${trip.mode==="simulated"?"SIMULATED. ":""}${trip.vehicle}: checked-in rider asks for assistance. ${position}`.slice(0,300);
      await c.query(`INSERT INTO push_message(institution_id,account_id,title,body,url)
        SELECT $1,agent.account_id,'Bus SOS',$3,'/transport?institution='||$1::text||'&role='||agent.role FROM (
          SELECT DISTINCT account_id,'transport' AS role FROM membership WHERE institution_id=$1 AND role='transport' AND ended_at IS NULL
          UNION SELECT t.faculty_id,'faculty' FROM transport_route_teacher t WHERE t.institution_id=$1 AND t.route_id=$2
          AND EXISTS (${transportMemberSql("t.faculty_id","'faculty'")})
        ) agent`,[tenant,trip.route_id,body]);
    }
    await audit(c,s,id,existing?"transport.sos_signal_refreshed":"transport.sos_signal_recorded",undefined,s.account);
    return {id,updated:Boolean(existing)};
  });
}
export async function busSosDesk(s:Scope) {
  if(s.role!=="transport"&&s.role!=="faculty")return [];
  return (await db.query<{id:string;vehicle:string;student:string;position:string|null;at:Date|null;signal:Date;repeats:number;mode:string}>(`
    SELECT a.id,v.label AS vehicle,u.name AS student,a.stop_name AS position,a.position_at AS at,a.latest_signal_at AS signal,a.repeats,t.mode
    FROM transport_sos a JOIN transport_trip t ON (t.institution_id,t.id)=(a.institution_id,a.trip_id)
    JOIN transport_vehicle v ON (v.institution_id,v.id)=(t.institution_id,t.vehicle_id) JOIN "user" u ON u.id=a.student_id
    WHERE a.institution_id=$1 AND EXISTS (${transportMemberSql("$2","$3")})
      AND ($3='transport' OR EXISTS (SELECT 1 FROM transport_route_teacher x WHERE (x.institution_id,x.route_id)=(t.institution_id,t.route_id) AND x.faculty_id=$2))
      AND a.latest_signal_at>clock_timestamp()-interval '7 days'
    ORDER BY a.latest_signal_at DESC LIMIT 50`,[s.institution,s.account,s.role])).rows;
}
export async function availableRouteTeachers(s:Scope){
  if(s.role!=="transport")return [];
  return (await db.query<{id:string;name:string}>(`SELECT DISTINCT u.id,u.name FROM membership m JOIN "user" u ON u.id=m.account_id
    WHERE m.institution_id=$1 AND m.role='faculty' AND m.ended_at IS NULL AND EXISTS (${transportMemberSql("$2","'transport'")}) ORDER BY u.name`,[s.institution,s.account])).rows;
}
