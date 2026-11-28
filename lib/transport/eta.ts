import {distanceMeters} from "./osmand";

export type RoutePoint={id:string;label:string;lat:number;lon:number;offset:number};
type Fix={lat:number;lon:number;observedAt:string;receivedAt:string};
type EtaInput={departure:string;stops:RoutePoint[];pickup:string;fix:Fix|null;now:Date};
export function routeProjection(stops:RoutePoint[],fix:{lat:number;lon:number}) {
  const candidates:{segment:number;distance:number}[]=[];
  let best:{segment:number;fraction:number;distance:number;offset:number;toNext:number}|null=null;
  for(let j=0;j+1<stops.length;j++){
    const a=stops[j],b=stops[j+1],sx=Math.cos(a.lat*Math.PI/180);
    const x=(b.lon-a.lon)*sx,y=b.lat-a.lat,dx=(fix.lon-a.lon)*sx,dy=fix.lat-a.lat;
    const f=Math.min(1,Math.max(0,(dx*x+dy*y)/Math.max(1e-14,x*x+y*y)));
    const lat=a.lat+(b.lat-a.lat)*f,lon=a.lon+(b.lon-a.lon)*f;
    const dist=distanceMeters(fix.lat,fix.lon,lat,lon);
    const p={segment:j,fraction:f,distance:dist,offset:a.offset+(b.offset-a.offset)*f,toNext:distanceMeters(lat,lon,b.lat,b.lon)};
    candidates.push(p);
    if(!best || p.distance<best.distance)best=p;
  }
  if (!best || best.distance>300) return null;
  // Without an earlier route-progress observation, identical nearby loop legs are ambiguous.
  const nearest=best;
  if(candidates.some(p=>Math.abs(p.segment-nearest.segment)>1 && p.distance<=nearest.distance+12)) return null;
  return best;
}
export function computeTransportEta(i:EtaInput){
  const departure=Date.parse(i.departure), observed=i.fix ? Date.parse(i.fix.observedAt):0, received=i.fix ? Date.parse(i.fix.receivedAt):0;
  const n=i.now.getTime();
  const age=i.fix?Math.max(0,n-observed,n-received):Infinity;
  const state=!i.fix || age>90_000 ? "no-signal" : age>30_000 ? "recent" : "fresh";
  const p=i.fix && state!=="no-signal"?routeProjection(i.stops,i.fix):null;
  const delayMs=p ? observed-departure-p.offset*60_000:null;
  const timeline=i.stops.map((s,index)=>{
    const scheduled=departure+s.offset*60_000;
    const passed=!!p && (index<=p.segment && p.fraction>0.03 || index<p.segment);
    const expected=p && !passed && delayMs!==null ? Math.max(n,scheduled+delayMs):null;
    return {...s,pickup:s.id===i.pickup,passed,scheduled:new Date(scheduled).toISOString(),
      expected:expected===null?null:new Date(expected).toISOString(),
      delay:expected===null?null:Math.round((expected-scheduled)/60_000)};
  });
  const upcoming=i.stops[p===null?-1:p.segment+1];
  const pickup=timeline.find(t=>t.pickup);
  const toPickup=pickup?.expected?Math.ceil((Date.parse(pickup.expected)-n)/60_000):null;
  return {timeline,state,observedAt:i.fix?.observedAt??null,position:p && i.fix?{lat:i.fix.lat,lon:i.fix.lon}:null,
    next:upcoming && p ? {name:upcoming.label,km:Math.round(p.toNext/100)/10} : null,
    closeToPickup:state==="fresh" && !pickup?.passed && toPickup!==null && toPickup>0 && toPickup<=5};
}
export type TransportEta=ReturnType<typeof computeTransportEta>;
