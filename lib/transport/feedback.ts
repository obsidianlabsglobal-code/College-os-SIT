import {z} from "zod";
import {audit,WorkflowError} from "../assignments";
import {db,transaction} from "../db";
import type {Scope} from "../scope";
import {holdRiderDepartment,holdTransportMember,transportMemberSql} from "./catalog";
export function submitEtaFeedback(s:Scope,raw:unknown){
  const i=z.object({trip:z.uuid(),accurate:z.boolean(),comment:z.string().trim().max(250).optional()}).parse(raw);
  return transaction(async c=>{
    await holdTransportMember(c,s,"student",true);
    await holdRiderDepartment(c,s);
    const {rowCount}=await c.query(`SELECT t.id FROM transport_trip t JOIN transport_trip_rider r ON (r.institution_id,r.trip_id)=(t.institution_id,t.id)
      WHERE t.institution_id=$1 AND t.id=$2 AND r.student_id=$3 AND
      (t.state='active' OR (t.state='completed' AND t.ended_at>clock_timestamp()-interval '7 days')) AND
      EXISTS (SELECT 1 FROM transport_position p WHERE p.institution_id=t.institution_id AND p.trip_id=t.id AND NOT p.quarantined) FOR UPDATE OF t`,
      [s.institution,i.trip,s.account]);
    if(!rowCount)throw new WorkflowError("No eligible trip timing to review.");
    const saved=await c.query(`INSERT INTO transport_eta_feedback(institution_id,trip_id,student_id,accurate,comment) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT DO NOTHING`,[s.institution,i.trip,s.account,i.accurate,i.comment||null]);
    if(!saved.rowCount)throw new WorkflowError("You already sent feedback for this trip.");
    await audit(c,s,i.trip,"transport.eta_feedback_recorded");
  });
}
export async function officeEtaFeedback(s:Scope){
  if(s.role!=="transport")return [];
  return (await db.query<{id:string;route:string;day:string;accurate:boolean;comment:string|null}>(`SELECT q.trip_id || '-' || extract(epoch from q.created_at)::text AS id,
     r.label AS route,to_char(t.service_on,'YYYY-MM-DD') AS day,q.accurate,q.comment
     FROM transport_eta_feedback q JOIN transport_trip t ON (t.institution_id,t.id)=(q.institution_id,q.trip_id)
     JOIN transport_route r ON (r.institution_id,r.id)=(t.institution_id,t.route_id)
     WHERE q.institution_id=$1 AND EXISTS (${transportMemberSql("$2","'transport'")}) ORDER BY q.created_at DESC LIMIT 50`,
     [s.institution,s.account])).rows;
}
