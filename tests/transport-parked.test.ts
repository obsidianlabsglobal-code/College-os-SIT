// covers: TO-012, TR-025 stopped driver gate (pure evidence policy)
import {test} from "node:test";
import assert from "node:assert/strict";
import {stoppedFromBusFixes} from "../lib/transport/driver-disruptions";
const t=Date.parse("2026-12-02T01:50:15Z");
const a={latitude:12.25,longitude:76.62,speed_kmh:1,accuracy_m:8,observed_at:new Date(t-3000),received_at:new Date(t-2000)};
const b={...a,observed_at:new Date(t-9000),received_at:new Date(t-8000)};
test("driver gate allows sufficiently distinct fresh slow fixes only",()=>{
  assert.equal(stoppedFromBusFixes([a,b],new Date(t)),true);
  assert.equal(stoppedFromBusFixes([{...a,speed_kmh:15},b],new Date(t)),false);
  assert.equal(stoppedFromBusFixes([{...a,speed_kmh:null},b],new Date(t)),false);
  assert.equal(stoppedFromBusFixes([{...a,latitude:12.26},b],new Date(t)),false);
  assert.equal(stoppedFromBusFixes([a,b],new Date(t+60000)),false);
  assert.equal(stoppedFromBusFixes([],new Date(t)),false);
});
