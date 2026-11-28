// covers: TR-010, TR-011 (timing projections), TR-009 (named-stop order only)
import assert from "node:assert/strict";
import {test} from "node:test";
import {computeTransportEta,routeProjection} from "../lib/transport/eta";
const point=(id:string,offset:number,lat:number,lon:number)=>({id,label:id,offset,lat,lon});
const stops=[point("A",0,12.25,76.62),point("B",5,12.254,76.615),point("C",10,12.258,76.61),point("D",15,12.262,76.605)];
const departure="2026-12-02T01:50:00Z";
const time=(t:string)=>"2026-12-02T01:"+t+"Z";
test("fresh position distinguishes scheduled, expected, passed and pickup proximity",()=>{
  const t=computeTransportEta({departure,stops,pickup:"B",now:new Date(time("55:05")),fix:{lat:12.252,lon:76.6175,observedAt:time("55:00"),receivedAt:time("55:03")}});
  assert.equal(t.state,"fresh");
  assert.equal(t.timeline[0].passed,true);
  assert.equal(t.timeline[1].scheduled,"2026-12-02T01:55:00.000Z");
  assert.ok((t.timeline[1].delay??0)>0);
  assert.equal(t.next?.name,"B");
  assert.equal(t.closeToPickup,true);
});
test("stale or disconnected input exposes no prediction, moving position or five-minute alert",()=>{
  const t=computeTransportEta({departure,stops,pickup:"B",now:new Date(time("56:45")),fix:{lat:12.252,lon:76.6175,observedAt:time("55:00"),receivedAt:time("56:44")}});
  assert.equal(t.state,"no-signal");
  assert.ok(t.timeline.every(s=>s.expected===null));
  assert.equal(t.position,null);
  assert.equal(t.closeToPickup,false);
});
test("off-route and ambiguous loop fixes do not generate route progress",()=>{
  assert.equal(routeProjection(stops,{lat:13,lon:77}),null);
  const loop=[point("A",0,12.25,76.62),point("B",5,12.254,76.615),point("C",10,12.255,76.615),point("D",15,12.251,76.620)];
  assert.equal(routeProjection(loop,{lat:12.2525,lon:76.6175}),null);
});
