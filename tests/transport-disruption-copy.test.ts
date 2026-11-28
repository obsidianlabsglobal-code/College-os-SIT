// covers: TR-020, TR-021, TR-025, TO-012, TO-013 (5b notice copy only)
import test from "node:test";
import assert from "node:assert/strict";
import {disruptionKinds,renderDisruption} from "../lib/transport/disruption-copy";

const now="2026-12-02T07:50:00+05:30";
const future="2026-12-02T08:10:00+05:30";
const earlier="2026-12-02T07:48:00+05:30";
const base={kind:"puncture",locale:"en",audience:"waiting",stage:"initial",vehicle:"Bus 4",nearestStop:"Cedar Square",now,clock:{kind:"update",updateBy:future},action:{kind:"await_staff"}};
test("all 11 incident types render in each chosen language for both rider audiences",()=>{
  let variants=0;
  for(const kind of disruptionKinds) for(const locale of ["en","kn"]) {
    const waiting=renderDisruption({...base,kind,locale});
    const aboard=renderDisruption({...base,kind,locale,audience:"aboard"});
    for(const message of [waiting,aboard]){
      assert.equal(message.locale,locale);
      assert.match(message.body,/Bus 4/);
      assert.match(message.body,/Cedar Square/);
      assert.match(message.body,/08:10 IST/);
      assert.match(message.body,locale==="en"?/Sorry/:/ಕ್ಷಮಿಸಿ/);
      variants++;
    }
    assert.notEqual(waiting.body,aboard.body);
  }
  assert.equal(variants,44);
});
test("puncture includes nearest named stop, explicit delay, ETA and update deadline",()=>{
  const m=renderDisruption({...base,clock:{kind:"eta",expectedAt:"2026-12-02T08:15:00+05:30",delayMinutes:25,updateBy:future},action:{kind:"wait_at_stop"}});
  for(const x of [/flat tyre/,/Cedar Square/,/25 minutes late/,/08:15 IST/,/wait at your stop/,/08:10 IST/]) assert.match(m.body,x);
});
test("accident check-in only for stranded recipients; no collection or send here",()=>{
  assert.equal(renderDisruption({...base,kind:"accident_injury",audience:"aboard",stranded:true}).accidentCheckIn,true);
  assert.equal(renderDisruption({...base,kind:"accident_injury"}).accidentCheckIn,false);
  assert.equal(renderDisruption({...base,kind:"accident_no_injuries",stranded:true}).accidentCheckIn,true);
  assert.equal(renderDisruption({...base,kind:"puncture",audience:"aboard"}).accidentCheckIn,false);
});
test("wrong locale, raw coordinates, missing ETA/update and past promises are rejected",()=>{
  for(const o of [{locale:"hi"},{nearestStop:"12.30/76.60"},{clock:{kind:"update"}},{clock:{kind:"update",updateBy:earlier}}]) assert.throws(()=>renderDisruption({...base,...o}));
});
test("onboard and high-risk incidents do not get unsafe walk instructions",()=>{
  const action={kind:"walk_to_stop",stop:"Lotus Square",safePathConfirmed:true};
  for(const o of [{audience:"aboard"},{kind:"accident_injury"},{kind:"weather_flooding"},{kind:"road_block"}]) assert.throws(()=>renderDisruption({...base,...o,action}));
  assert.throws(()=>renderDisruption({...base,action:{...action,safePathConfirmed:false}}));
});
test("cancellation cannot create an ETA for the cancelled bus",()=>{
  assert.throws(()=>renderDisruption({...base,kind:"trip_cancelled",clock:{kind:"eta",expectedAt:future},action:{kind:"take_route",route:"Route 6"}}));
  assert.match(renderDisruption({...base,kind:"trip_cancelled",action:{kind:"take_route",route:"Route 6"}}).body,/take route Route 6/);
});
test("all-clear has an actual, non-future recorded arrival and an explicit instruction",()=>{
  assert.match(renderDisruption({...base,stage:"all_clear",clock:{kind:"actual",arrivedAt:earlier},action:{kind:"resume"}}).body,/Recorded arrival at Cedar Square: 07:48 IST/);
  assert.throws(()=>renderDisruption({...base,stage:"all_clear",clock:{kind:"actual",arrivedAt:future},action:{kind:"resume"}}));
  assert.throws(()=>renderDisruption({...base,stage:"all_clear",action:{kind:"resume"}}));
});

import {allClearRecipients,busDelayAnnotation,promisedUpdateWarning} from "../lib/transport/disruption-planning";
const active={institution:"NF",trip:"SIM-4",id:"I1",status:"open" as const,updateBy:future,missingUpdateWarningKey:null};
test("promised update warns once at the due time, not before or after resolution",()=>{
  assert.equal(promisedUpdateWarning(active,new Date(earlier)),null);
  const warning=promisedUpdateWarning(active,new Date(future));
  assert.ok(warning);
  assert.equal(promisedUpdateWarning({...active,missingUpdateWarningKey:warning.key},new Date(future)),null);
  assert.equal(promisedUpdateWarning({...active,status:"resolved"},new Date(future)),null);
});
test("all-clear uses recorded recipients of exactly this incident and trip, without duplicates",()=>{
  const student={institution:"NF",trip:"SIM-4",incident:"I1",recipient:"Asha",locale:"en" as const,audience:"waiting" as const};
  const latest={...student,locale:"kn" as const,audience:"aboard" as const};
  const receipts=[student,{...student,institution:"WH",recipient:"Ira"},latest,{...student,trip:"SIM-5",recipient:"Other"},{...student,incident:"I2",recipient:"Older"}];
  assert.deepEqual(allClearRecipients(active,receipts),[]);
  assert.deepEqual(allClearRecipients({...active,status:"resolved"},receipts),[latest]);
});
test("reason applies only to a confirmed delayed rider's first-period lateness that day, never overriding staff",()=>{
  const day="2026-12-02";
  const e={institution:"NF",trip:"SIM-4",serviceDay:day,student:"Asha",confirmedAffected:true};
  const p={institution:"NF",serviceDay:day,student:"Asha",periodNumber:1,status:"late" as const,manuallyDecided:false};
  assert.equal(busDelayAnnotation(active,day,e,p)?.reason,"bus_delay");
  for(const revised of [{student:"Ira"},{serviceDay:"2026-12-03"},{institution:"WH"},{periodNumber:2},{manuallyDecided:true},{status:"absent" as const}])
    assert.equal(busDelayAnnotation(active,day,e,{...p,...revised}),null);
  assert.equal(busDelayAnnotation(active,day,{...e,trip:"SIM-5"},p),null);
  assert.equal(busDelayAnnotation(active,day,{...e,confirmedAffected:false},p),null);
});
