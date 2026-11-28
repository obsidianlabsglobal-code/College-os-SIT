import {z} from "zod";
import {audit,WorkflowError} from "../assignments";
import {db,transaction} from "../db";
import type {Scope} from "../scope";
import {holdTransportMember,transportMemberSql} from "./catalog";

const ops=z.discriminatedUnion("operation",[
  z.object({operation:z.literal("maintenance-report"),vehicle:z.uuid(),summary:z.string().trim().min(1).max(180)}),
  z.object({operation:z.literal("maintenance-clear"),maintenance:z.uuid(),day:z.iso.date(),note:z.string().trim().min(1).max(300)}),
]);
export function changeMaintenance(s:Scope,raw:unknown){
  const i=ops.parse(raw);
  return transaction(async c=>{
    await holdTransportMember(c,s,"transport");
    if(i.operation==="maintenance-report"){
      if(!(await c.query("SELECT 1 FROM transport_vehicle WHERE institution_id=$1 AND id=$2 FOR UPDATE",[s.institution,i.vehicle])).rowCount)
        throw new WorkflowError("Choose a vehicle in your institution.");
      const {rows:[entry]}=await c.query<{id:string}>(`INSERT INTO transport_maintenance(institution_id,vehicle_id,opened_by,summary)
        VALUES($1,$2,$3,$4) RETURNING id`,[s.institution,i.vehicle,s.account,i.summary]);
      await audit(c,s,entry.id,"transport.maintenance_recorded");return;
    }
    const {rows:[r]}=await c.query<{cleared_at:Date|null}>("SELECT cleared_at FROM transport_maintenance WHERE institution_id=$1 AND id=$2 FOR UPDATE",[s.institution,i.maintenance]);
    if(!r||r.cleared_at)throw new WorkflowError("This maintenance record is already closed or unavailable.");
    const changed=await c.query(`UPDATE transport_maintenance SET service_on=$3,cleared_by=$4,clearance_note=$5,cleared_at=clock_timestamp()
      WHERE institution_id=$1 AND id=$2 AND $3::date<=(clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date`,
      [s.institution,i.maintenance,i.day,s.account,i.note]);
    if(!changed.rowCount)throw new WorkflowError("Record the actual service date, not an appointment.");
    await audit(c,s,i.maintenance,"transport.maintenance_cleared");
  });
}
export async function maintenanceDesk(s:Scope){
  if(s.role!=="transport")return {items:[],patterns:[]};
  const args=[s.institution,s.account],gate=`EXISTS (${transportMemberSql("$2","'transport'")})`;
  const [items,patterns]=await Promise.all([
    db.query<{id:string;vehicle:string;summary:string;service:string|null;note:string|null}>(`SELECT m.id,v.label AS vehicle,m.summary,
      to_char(m.service_on,'YYYY-MM-DD') AS service,m.clearance_note AS note FROM transport_maintenance m
      JOIN transport_vehicle v ON (v.institution_id,v.id)=(m.institution_id,m.vehicle_id)
      WHERE m.institution_id=$1 AND ${gate} ORDER BY m.recorded_at DESC LIMIT 80`,args),
    db.query<{vehicle:string;route:string;stop:string;kind:string;hour:number;count:number}>(`SELECT v.label AS vehicle,a.label AS route,r.label AS stop,d.kind,
      extract(hour FROM d.created_at AT TIME ZONE 'Asia/Kolkata')::int AS hour,count(*)::int AS count
      FROM transport_disruption d JOIN transport_trip t ON (t.institution_id,t.id)=(d.institution_id,d.trip_id)
      JOIN transport_vehicle v ON (v.institution_id,v.id)=(t.institution_id,t.vehicle_id)
      JOIN transport_route a ON (a.institution_id,a.id)=(d.institution_id,d.route_id)
      JOIN transport_route_stop r ON (r.institution_id,r.route_id,r.revision,r.stop_id)=(d.institution_id,d.route_id,d.revision,d.stop_id)
      WHERE d.institution_id=$1 AND d.created_at>clock_timestamp()-interval '30 days' AND ${gate}
      GROUP BY v.label,a.label,r.label,d.kind,hour ORDER BY count DESC LIMIT 60`,args)
  ]);
  return {items:items.rows,patterns:patterns.rows};
}
