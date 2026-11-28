import type {PoolClient} from "pg";
import {z} from "zod";
import {audit,WorkflowError} from "../assignments";
import {db,transaction} from "../db";
import type {Scope} from "../scope";
import {accountInActiveDepartmentSql} from "../active-departments";
import {holdRiderDepartment,holdTransportMember,transportMemberSql} from "./catalog";
import {stoppedIncidentTarget} from "./driver-disruptions";
import {disruptionKinds,renderDisruption,type NoticeDraft} from "./disruption-copy";

const roleProblem=()=>new WorkflowError("This transport incident is not available to this workspace.");
const text=(n:number)=>z.string().trim().min(1).max(n);
const detail=z.object({clock:z.enum(["eta","update","actual"]),when:z.iso.datetime({offset:true}),delay:z.number().int().min(0).max(240).optional(),
  action:z.enum(["wait_at_stop","await_staff","take_route","replacement","resume"]),alternative:z.uuid().optional(),stop:z.uuid().optional(),
  noteEn:z.string().trim().max(160).optional(),noteKn:z.string().trim().max(160).optional()});
const input=z.discriminatedUnion("operation",[
  detail.extend({operation:z.literal("open-disruption"),trip:z.uuid(),stop:z.uuid(),kind:z.enum(disruptionKinds)}),
  detail.extend({operation:z.literal("publish-disruption"),incident:z.uuid(),expected:z.number().int().min(1),stage:z.enum(["update","all_clear"])}),
  z.object({operation:z.literal("read-disruption"),incident:z.uuid(),sequence:z.number().int().min(1)}),
  z.object({operation:z.literal("report-bus"),trip:z.uuid(),summary:text(120),body:text(1000)}),
]);
export function changeDisruption(s:Scope,raw:unknown,boardKey?:string){
  const i=input.parse(raw);
  return transaction(c=>writeDisruption(c,s,i,boardKey?{boardKey}:undefined));
}
async function writeDisruption(c:PoolClient,s:Scope,i:z.infer<typeof input>,driver?:{boardKey:string}|{stopped:true}){
    const tenant=s.institution;
    if(i.operation==="report-bus"||i.operation==="read-disruption"){
      await holdTransportMember(c,s,"student",true);
      await holdRiderDepartment(c,s);
      if(i.operation==="read-disruption"){
        const row=await c.query("SELECT 1 FROM transport_disruption_receipt WHERE institution_id=$1 AND disruption_id=$2 AND notice_sequence=$3 AND student_id=$4 FOR UPDATE",
          [tenant,i.incident,i.sequence,s.account]);
        if(!row.rowCount)throw roleProblem();
        const marked=await c.query("UPDATE transport_disruption_receipt SET read_at=clock_timestamp() WHERE institution_id=$1 AND disruption_id=$2 AND notice_sequence=$3 AND student_id=$4 AND read_at IS NULL",
          [tenant,i.incident,i.sequence,s.account]);
        if(marked.rowCount)await audit(c,s,i.incident,"transport.notice_read",i.sequence);
        return i.incident;
      }
      const valid=await c.query(`SELECT t.id FROM transport_trip t JOIN transport_trip_rider r ON (r.institution_id,r.trip_id)=(t.institution_id,t.id)
        WHERE t.institution_id=$1 AND t.id=$2 AND t.state='active' AND r.student_id=$3 AND r.released_at IS NULL FOR UPDATE OF t`,
        [tenant,i.trip,s.account]);
      if(!valid.rowCount)throw roleProblem();
      const {rows:[entry]}=await c.query<{id:string}>(`INSERT INTO case_record(institution_id,kind,subject_id,opened_by,title,body)
        VALUES($1,'transport_incident',$2,$2,$3,$4) RETURNING id`,[tenant,s.account,i.summary,i.body]);
      await audit(c,s,entry.id,"case.opened",1);
      return entry.id;
    }
    if(s.role==="driver"){
      if(!driver||i.operation!=="open-disruption")throw roleProblem();
      await holdTransportMember(c,s,"driver");
    }else await holdTransportMember(c,s,"transport");
    let id:string,tripId:string,kind:typeof disruptionKinds[number],seq:number,location:string,vehicle:string,routeId:string,state:string,mode:string;
    if(i.operation==="open-disruption"){
      const {rows:[t]}=await c.query<{route_id:string;revision:number;mode:string;state:string;label:string;vehicle:string}>(`
        SELECT t.route_id,t.revision,t.mode,t.state,r.label,v.label AS vehicle FROM transport_trip t
        JOIN transport_route_stop r ON (r.institution_id,r.route_id,r.revision)=(t.institution_id,t.route_id,t.revision)
        JOIN transport_vehicle v ON (v.institution_id,v.id)=(t.institution_id,t.vehicle_id)
        WHERE t.institution_id=$1 AND t.id=$2 AND r.stop_id=$3 FOR UPDATE OF t`,[tenant,i.trip,i.stop]);
      if(!t || (t.state!=="active" && !(t.state==="scheduled"&&i.kind==="trip_cancelled")))throw roleProblem();
      if(s.role==="driver"){
        if(driver&&"boardKey" in driver&&await stoppedIncidentTarget(c,s,i.trip,driver.boardKey,true)!==i.stop)
          throw new WorkflowError("The bus must be confirmed stopped before using the driver controls.");
        const {rows:[already]}=await c.query<{id:string}>(`SELECT id FROM transport_disruption WHERE institution_id=$1 AND trip_id=$2 AND kind=$3
          AND created_by=$4 AND created_at>clock_timestamp()-interval '60 seconds' ORDER BY created_at DESC LIMIT 1`,[tenant,i.trip,i.kind,s.account]);
        if(already)return already.id;
      }
      const {rows:[entry]}=await c.query<{id:string}>(`INSERT INTO case_record(institution_id,kind,subject_id,opened_by,title,body)
        VALUES($1,'transport_incident',$2,$2,$3,'Office-reported bus disruption. Use the transport incident history.') RETURNING id`,
        [tenant,s.account,`Bus disruption: ${i.kind.replaceAll("_"," ")}`]);
      await audit(c,s,entry.id,"case.opened",1);
      const {rows:[incident]}=await c.query<{id:string}>(`INSERT INTO transport_disruption(institution_id,trip_id,route_id,revision,stop_id,case_id,kind,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,[tenant,i.trip,t.route_id,t.revision,i.stop,entry.id,i.kind,s.account]);
      [id,tripId,kind,seq,location,vehicle,routeId,state,mode]=[incident.id,i.trip,i.kind,1,t.label,t.vehicle,t.route_id,t.state,t.mode];
    }else{
      const {rows:[t]}=await c.query<{route_id:string;trip_id:string;kind:typeof disruptionKinds[number];latest_sequence:number;state:string;trip_state:string;mode:string;label:string;vehicle:string}>(`
        SELECT d.route_id,d.trip_id,d.kind,d.latest_sequence,d.state,t.state AS trip_state,t.mode,r.label,v.label AS vehicle FROM transport_disruption d
        JOIN transport_trip t ON (t.institution_id,t.id)=(d.institution_id,d.trip_id)
        JOIN transport_route_stop r ON (r.institution_id,r.route_id,r.revision,r.stop_id)=(d.institution_id,d.route_id,d.revision,d.stop_id)
        JOIN transport_vehicle v ON (v.institution_id,v.id)=(t.institution_id,t.vehicle_id)
        WHERE d.institution_id=$1 AND d.id=$2 FOR UPDATE OF d,t`,[tenant,i.incident]);
      if(!t||t.state!=="open"||t.latest_sequence!==i.expected)throw new WorkflowError("That incident was already updated. Reload before posting.");
      [id,tripId,kind,seq,location,vehicle,routeId,state,mode]=[i.incident,t.trip_id,t.kind,t.latest_sequence+1,t.label,t.vehicle,t.route_id,t.trip_state,t.mode];
    }
    const stage=i.operation==="open-disruption"?"initial":i.stage;
    const now=new Date().toISOString();
    const timing:NoticeDraft["clock"]=i.clock==="actual"?{kind:"actual",arrivedAt:i.when}:
      i.clock==="eta"?{kind:"eta",expectedAt:i.when,delayMinutes:i.delay}:{kind:"update",updateBy:i.when};
    let act:NoticeDraft["action"]={kind:"await_staff"};
    if(i.action==="wait_at_stop")act={kind:"wait_at_stop"};
    else if(i.action==="resume")act={kind:"resume"};
    else if(i.action==="take_route"){
      const {rows:[r]}=await c.query<{code:string}>("SELECT code FROM transport_route WHERE institution_id=$1 AND id=$2 AND active AND published_revision IS NOT NULL",
        [tenant,i.alternative??null]);
      if(!r)throw new WorkflowError("Choose an active alternative route.");
      act={kind:"take_route",route:r.code};
    }else if(i.action==="replacement"){
      const {rows:[meeting]}=await c.query<{label:string}>(`SELECT s.label FROM transport_replacement r JOIN transport_route_stop s ON
        (s.institution_id,s.route_id,s.revision,s.stop_id)=(r.institution_id,r.route_id,r.revision,r.stop_id)
        WHERE r.institution_id=$1 AND r.disruption_id=$2`,[tenant,id]);
      if(!meeting)throw new WorkflowError("Assign an active replacement trip and meeting stop before publishing replacement instructions.");
      act={kind:"replacement",stop:meeting.label};
    }
    const aboard=act.kind==="wait_at_stop"?{kind:"await_staff"} as const:act;
    // Any nonliteral invalid combination raises and rolls back the incident and case together.
    const common={kind,stage,vehicle,nearestStop:location,now,clock:timing};
    const variant=(locale:"en"|"kn",audience:"waiting"|"aboard")=>{
      const base=renderDisruption({...common,locale,audience,action:audience==="waiting"?act:aboard}).body;
      const extra=locale==="en"?i.noteEn:i.noteKn;
      if(!extra)return base;
      if(/(?:[0-9+][\d -]{7,}|[+-]?\d+\.\d{3,}\s*[,/]\s*[+-]?\d+\.\d{3,}|https?:\/\/)/i.test(extra))
        throw new WorkflowError("Keep personal phone numbers, raw coordinates and links out of public rider notes.");
      return base+" "+extra;
    };
    const en=variant("en","waiting"),kn=variant("kn","waiting"),enA=variant("en","aboard"),knA=variant("kn","aboard");
    const deadline=i.clock==="update"?i.when:null;
    await c.query(`INSERT INTO transport_disruption_notice(institution_id,disruption_id,sequence,stage,body_en,body_kn,aboard_en,aboard_kn,published_by,update_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[tenant,id,seq,stage,en,kn,enA,knA,s.account,deadline]);
    if(stage==="all_clear"){
      await c.query(`INSERT INTO transport_disruption_receipt(institution_id,disruption_id,notice_sequence,student_id,locale,audience)
        SELECT DISTINCT ON (p.student_id) p.institution_id,p.disruption_id,$3,p.student_id,p.locale,p.audience FROM transport_disruption_receipt p
        WHERE p.institution_id=$1 AND p.disruption_id=$2 AND EXISTS (${transportMemberSql("p.student_id","'student'")}) AND ${accountInActiveDepartmentSql("p.student_id")}
        ORDER BY p.student_id,p.notice_sequence DESC`,[tenant,id,seq]);
    }else{
      // A recipient receives aboard wording only after a validated check-in with the bus near their assigned stop.
      await c.query(`INSERT INTO transport_disruption_receipt(institution_id,disruption_id,notice_sequence,student_id,locale,audience)
         SELECT $1,$2,$3,s.student_id,COALESCE(p.notice_language,'en'),CASE WHEN b.student_id IS NULL THEN 'waiting' ELSE 'aboard' END FROM (
           SELECT student_id FROM transport_trip_rider WHERE institution_id=$1 AND trip_id=$4 AND released_at IS NULL
           UNION SELECT student_id FROM transport_choice WHERE institution_id=$1 AND route_id=$5 AND $6='scheduled'
           UNION SELECT student_id FROM transport_disruption_receipt WHERE institution_id=$1 AND disruption_id=$2
         ) s LEFT JOIN transport_rider_preference p ON p.institution_id=$1 AND p.student_id=s.student_id
         LEFT JOIN transport_boarding b ON b.institution_id=$1 AND b.trip_id=$4 AND b.student_id=s.student_id
         WHERE EXISTS (${transportMemberSql("s.student_id","'student'")}) AND ${accountInActiveDepartmentSql("s.student_id")}`,
        [tenant,id,seq,tripId,routeId,state]);
    }
    await c.query(`UPDATE transport_disruption SET latest_sequence=$3,update_by=$4,state=$5,
      resolution_at=CASE WHEN $5='resolved' THEN clock_timestamp() END WHERE institution_id=$1 AND id=$2`,
      [tenant,id,seq,deadline,stage==="all_clear"?"resolved":"open"]);
    if(stage==="initial"&&kind==="trip_cancelled"){
      await c.query("UPDATE transport_trip SET state='cancelled',ended_at=clock_timestamp() WHERE institution_id=$1 AND id=$2",[tenant,tripId]);
      await c.query("UPDATE transport_trip_rider SET released_at=clock_timestamp() WHERE institution_id=$1 AND trip_id=$2 AND released_at IS NULL",[tenant,tripId]);
      await c.query("DELETE FROM transport_backup_fix WHERE institution_id=$1 AND trip_id=$2",[tenant,tripId]);
      await audit(c,s,tripId,"transport.trip_cancelled");
    }
    await audit(c,s,id,`transport.disruption_${stage}`,seq);
    if(stage==="initial" && s.role==="driver"){
      await c.query(`INSERT INTO push_message(institution_id,account_id,title,body,url)
        SELECT DISTINCT m.institution_id,m.account_id,'Driver report',$2,'/transport?institution='||m.institution_id::text||'&role=transport'
        FROM membership m WHERE m.institution_id=$1 AND m.role='transport' AND m.ended_at IS NULL`,
        [tenant,`${mode==="simulated"?"SIMULATED. ":""}${vehicle}: ${kind.replaceAll("_"," ")} near ${location}. Open Transport to review.`.slice(0,300)]);
    }
    return id;
}
export function writeStoppedDriverReport(c:PoolClient,s:Scope,raw:unknown) {
  if(s.role!=="driver")throw roleProblem();
  const i=input.parse(raw);
  if(i.operation!=="open-disruption")throw roleProblem();
  return writeDisruption(c,s,i,{stopped:true});
}
export async function riderDisruptions(s:Scope){
  if(s.role!=="student")return [];
  return (await db.query<{id:string;seq:number;locale:"en"|"kn";body:string;read:boolean;stage:string;check_in:boolean}>(`
    SELECT n.disruption_id AS id,n.sequence AS seq,r.locale,
      CASE WHEN r.audience='aboard' THEN CASE WHEN r.locale='kn' THEN n.aboard_kn ELSE n.aboard_en END
      ELSE CASE WHEN r.locale='kn' THEN n.body_kn ELSE n.body_en END END AS body,
      r.read_at IS NOT NULL AS read,n.stage,(r.audience='aboard' AND d.kind IN ('accident_no_injuries','accident_injury')
        AND n.published_at>clock_timestamp()-interval '24 hours' AND d.state='open') AS check_in FROM transport_disruption_receipt r JOIN transport_disruption_notice n
      ON (n.institution_id,n.disruption_id,n.sequence)=(r.institution_id,r.disruption_id,r.notice_sequence)
    JOIN transport_disruption d ON (d.institution_id,d.id)=(n.institution_id,n.disruption_id)
    JOIN transport_trip t ON (t.institution_id,t.id)=(d.institution_id,d.trip_id)
    WHERE r.institution_id=$1 AND r.student_id=$2 AND (t.mode='simulated' OR $3::boolean)
      AND n.published_at>clock_timestamp()-interval '7 days'
      AND EXISTS (${transportMemberSql("$2","'student'")}) AND ${accountInActiveDepartmentSql("$2")}
    ORDER BY n.published_at DESC,n.sequence DESC LIMIT 30`,[s.institution,s.account,process.env.NEXUS_TRANSPORT_LIVE_ENABLED==="true"])).rows;
}
export async function officeDisruptions(s:Scope){
  if(s.role!=="transport")return {events:[],trips:[]};
  const args=[s.institution,s.account];
  const [events,trips]=await Promise.all([
    db.query<{id:string;kind:string;state:string;sequence:number;location:string;vehicle:string;overdue:boolean;age:number;photo:boolean;history:{sequence:number;stage:string;read:number;receipts:number;at:string;readers:string[]}[]}>(`
      SELECT d.id,d.kind,d.state,d.latest_sequence AS sequence,l.label AS location,v.label AS vehicle,
        d.state='open' AND COALESCE(d.update_by<=clock_timestamp(),false) AS overdue,
        EXISTS (SELECT 1 FROM transport_driver_report_photo p
          WHERE (p.institution_id,p.disruption_id)=(d.institution_id,d.id)) AS photo,
        floor(EXTRACT(epoch FROM (COALESCE(d.resolution_at,clock_timestamp())-d.created_at))/60)::int AS age,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('sequence',n.sequence,'stage',n.stage,'at',n.published_at,
          'read',(SELECT count(*) FROM transport_disruption_receipt r WHERE (r.institution_id,r.disruption_id,r.notice_sequence)=(d.institution_id,d.id,n.sequence) AND r.read_at IS NOT NULL),
          'receipts',(SELECT count(*) FROM transport_disruption_receipt r WHERE (r.institution_id,r.disruption_id,r.notice_sequence)=(d.institution_id,d.id,n.sequence)),
          'readers',(SELECT COALESCE(jsonb_agg(u.name ORDER BY u.name),'[]') FROM transport_disruption_receipt r
            JOIN "user" u ON u.id=r.student_id WHERE (r.institution_id,r.disruption_id,r.notice_sequence)=(d.institution_id,d.id,n.sequence) AND r.read_at IS NOT NULL))
          ORDER BY n.sequence)
          FROM transport_disruption_notice n WHERE (n.institution_id,n.disruption_id)=(d.institution_id,d.id)),'[]') AS history
      FROM transport_disruption d JOIN transport_trip t ON (t.institution_id,t.id)=(d.institution_id,d.trip_id)
      JOIN transport_vehicle v ON (v.institution_id,v.id)=(t.institution_id,t.vehicle_id)
      JOIN transport_route_stop l ON (l.institution_id,l.route_id,l.revision,l.stop_id)=(d.institution_id,d.route_id,d.revision,d.stop_id)
      WHERE d.institution_id=$1 AND EXISTS (${transportMemberSql("$2","'transport'")}) ORDER BY d.created_at DESC LIMIT 40`,args),
    db.query<{id:string;name:string;state:string;mode:string;stops:{id:string;label:string}[]}>(`
      SELECT t.id,r.label AS name,t.state,t.mode,COALESCE((SELECT jsonb_agg(jsonb_build_object('id',x.stop_id,'label',x.label) ORDER BY x.stop_order)
         FROM transport_route_stop x WHERE (x.institution_id,x.route_id,x.revision)=(t.institution_id,t.route_id,t.revision)),'[]') AS stops
      FROM transport_trip t JOIN transport_route r ON (r.institution_id,r.id)=(t.institution_id,t.route_id)
      WHERE t.institution_id=$1 AND t.state IN ('active','scheduled') AND EXISTS (${transportMemberSql("$2","'transport'")})
      ORDER BY (t.state='active') DESC,t.service_on DESC LIMIT 25`,args)
  ]);
  return {events:events.rows,trips:trips.rows};
}
