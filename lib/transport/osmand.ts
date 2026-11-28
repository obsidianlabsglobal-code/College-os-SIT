// Traccar documents these OsmAnd query/POST fields: https://www.traccar.org/osmand/
import { z } from "zod";

const coordinate=(lo:number,hi:number)=>z.number().finite().min(lo).max(hi);
export const observation=z.object({
  observedAt:z.iso.datetime({offset:true}), lat:coordinate(-90,90),lon:coordinate(-180,180),
  accuracy:coordinate(0,5000).optional(),speedKmh:coordinate(0,500).optional(),
});
export type Observation=z.infer<typeof observation>;
const numeric=(s:string|null)=>s&&/^-?(?:\d+\.?\d*|\.\d+)$/.test(s)?Number(s):NaN;
const validTimestamp=(raw:string|null)=>{
  if(!raw)return undefined;
  if(/^\d{10}$/.test(raw))return new Date(Number(raw)*1000).toISOString();
  if(/^\d{13}$/.test(raw))return new Date(Number(raw)).toISOString();
  if(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(raw))return raw.replace(" ","T")+"Z";
  return raw;
};
export function decodeOsmAnd(v:URLSearchParams){
  const single=(key:string)=>{const x=v.getAll(key);if(x.length>1)throw Error("Duplicate field");return x[0]??null;};
  const a=single("id"),b=single("deviceid");
  const deviceId=z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/).parse(a??b);
  if(a&&b&&a!==b)throw Error("Conflicting device identifier");
  const valid=single("valid");
  if(valid!==null&&!["1","true"].includes(valid))throw Error("Client has no valid location fix");
  const coord=single("location")?.split(",");
  const lat=single("lat"),lon=single("lon"),acc=single("accuracy"),speed=single("speed");
  if(coord && (coord.length!==2 || lat!==null || lon!==null))throw Error("Ambiguous coordinates");
  const fix=observation.parse({
    observedAt:validTimestamp(single("timestamp")),
    lat:numeric(coord?.[0]??lat),lon:numeric(coord?.[1]??lon),
    accuracy:acc===null?undefined:numeric(acc),
    speedKmh:speed===null?undefined:numeric(speed)*1.852,
  });
  return {deviceId,fix};
}
export function distanceMeters(lat1:number,lon1:number,lat2:number,lon2:number) {
  const rad=(n:number)=>n*Math.PI/180;
  const a=Math.sin(rad(lat2-lat1)/2)**2+Math.cos(rad(lat1))*Math.cos(rad(lat2))*Math.sin(rad(lon2-lon1)/2)**2;
  return 2*6371000*Math.asin(Math.sqrt(Math.min(1,Math.max(0,a))));
}
