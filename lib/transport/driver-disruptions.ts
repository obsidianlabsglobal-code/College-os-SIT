import {createHash} from "node:crypto";
import type {PoolClient} from "pg";
import {db} from "../db";
import type {Scope} from "../scope";
import {distanceMeters} from "./osmand";
import {transportMemberSql} from "./catalog";

const digest=(token:string)=>createHash("sha256").update(token).digest("hex");
const valid=(token:string)=>/^[A-Za-z0-9_-]{43}$/.test(token);
const enabled=(mode:string)=>mode==="simulated"?process.env.NEXUS_TRANSPORT_SIMULATION_ENABLED==="true":process.env.NEXUS_TRANSPORT_LIVE_ENABLED==="true";
type ParkFix={latitude:number;longitude:number;speed_kmh:number|null;accuracy_m:number|null;observed_at:Date;received_at:Date};
export function stoppedFromBusFixes(fixes:ParkFix[],now:Date) {
  if(fixes.length!==2)return false;
  const earliest=now.getTime()-30_000;
  if(fixes.some(p=>p.speed_kmh===null||p.speed_kmh>3||p.accuracy_m===null||p.accuracy_m>50||
    p.observed_at.getTime()<earliest||p.received_at.getTime()<earliest||p.observed_at.getTime()>now.getTime()+1000))return false;
  const [a,b]=fixes;
  return a.observed_at.getTime()-b.observed_at.getTime()>=3000 &&
    distanceMeters(a.latitude,a.longitude,b.latitude,b.longitude)<=20;
}
export async function stoppedIncidentTarget(dbClient:Pick<PoolClient,"query">,s:Scope,trip:string,token:string,lock=false){
  if(!valid(token))return null;
  const {rows:[t]}=await dbClient.query<{route_id:string;revision:number;mode:string;now:Date}>(`
    SELECT t.route_id,t.revision,t.mode,clock_timestamp() AS now FROM transport_trip t
    JOIN transport_boarding_device b ON (b.institution_id,b.vehicle_id)=(t.institution_id,t.vehicle_id)
    WHERE t.institution_id=$1 AND t.id=$3 AND t.driver_id=$2 AND t.state='active' AND b.digest=$4 AND b.revoked_at IS NULL
    AND EXISTS (${transportMemberSql("$2","'driver'")}) ${lock?"FOR SHARE OF b":""}`,[s.institution,s.account,trip,digest(token)]);
  if(!t||!enabled(t.mode))return null;
  const fixes=(await dbClient.query<ParkFix>(`SELECT latitude,longitude,speed_kmh,accuracy_m,observed_at,received_at
    FROM transport_position WHERE institution_id=$1 AND trip_id=$2 AND source=$3 AND NOT quarantined
    ORDER BY observed_at DESC LIMIT 2`,[s.institution,trip,t.mode])).rows;
  if(!stoppedFromBusFixes(fixes,t.now))return null;
  return (await dbClient.query<{id:string}>(`SELECT stop_id AS id FROM transport_route_stop WHERE institution_id=$1 AND route_id=$2 AND revision=$3
      ORDER BY power(lat::float-$4,2)+power(lon::float-$5,2),stop_order LIMIT 1`,
    [s.institution,t.route_id,t.revision,fixes[0].latitude,fixes[0].longitude])).rows[0]?.id??null;
}
export async function boardDriverContext(token:string){
  if(!valid(token))return null;
  const {rows:[r]}=await db.query<{institution_id:string;account:string;trip:string}>(`SELECT t.institution_id,t.driver_id AS account,t.id AS trip
    FROM transport_boarding_device b JOIN transport_trip t ON (t.institution_id,t.vehicle_id)=(b.institution_id,b.vehicle_id)
    WHERE b.digest=$1 AND b.revoked_at IS NULL AND t.state='active' AND t.driver_id IS NOT NULL`,[digest(token)]);
  if(!r)return null;
  const scope:Scope={institution:r.institution_id,role:"driver",account:r.account};
  const stop=await stoppedIncidentTarget(db,scope,r.trip,token);
  return stop?{scope,trip:r.trip,stop}:null;
}
