// covers: TO-001, TO-002, TO-003, TO-006, TR-001, TR-003, ID-004
import "../scripts/environment";
import assert from "node:assert/strict";
import {after,before,test} from "node:test";
import {randomUUID} from "node:crypto";
import {Pool} from "pg";
import {db} from "../lib/db";
import {WorkflowError} from "../lib/assignments";
import {changeTransportCatalog as change,transportCatalog} from "../lib/transport/catalog";
import {fictionalTransportRoutes,fictionalRiderChoices} from "../lib/transport/demo-fixtures";
import {demoEmail,fixtures as f} from "../scripts/fixtures";
import type {Scope} from "../lib/scope";
import {clearTransportFixture,grantFakeTransportOffice} from "./transport-fixture";
const owner=new Pool({connectionString:process.env.MIGRATION_DATABASE_URL});
const tag=randomUUID().slice(0,8);
const fake=fictionalTransportRoutes.map(r=>({...r,code:r.code+"-"+tag,vehicle:{...r.vehicle,title:r.vehicle.title+" "+tag}}));
const tripCode="TRIP-"+tag, tripVehicle="Fictional Trip Bus "+tag;
let grant: Awaited<ReturnType<typeof grantFakeTransportOffice>>;
let office:Scope,student:Scope,otherSection:Scope,tenant:Scope;
const deny=(op:()=>unknown)=>assert.rejects(async()=>op(),WorkflowError);
before(async()=>{
  grant=await grantFakeTransportOffice(owner);
  const people=await owner.query<{alias:string;id:string}>('SELECT split_part(email,\'@\',1) AS alias,id FROM "user" WHERE email=ANY($1)',[["student","outsider","tenant"].map(demoEmail)]);
  const ids=Object.fromEntries(people.rows.map(r=>[r.alias,r.id]));
  office={account:grant.account,institution:f.institution,role:"transport"};
  student={account:ids.student,institution:f.institution,role:"student"};
  otherSection={...student,account:ids.outsider};
  tenant={account:ids.tenant,institution:f.otherInstitution,role:"student"};
});
after(async()=>{
  try{if(grant) await clearTransportFixture(owner,[...fake.map(r=>r.code),tripCode],[...fake.map(r=>r.vehicle.title),tripVehicle],grant);}
  finally{await Promise.all([owner.end(),db.end()]);}
});
test("office publishes and schedules fictional routes, students choose own stops, scoped denials and locks persist",async()=>{
  assert.equal(fictionalRiderChoices.length,10);
  await deny(()=>change(student,{operation:"create-route",...fake[0]}));
  const routeIds=[];
  for(const r of fake){
    const route=await change(office,{operation:"create-route",...r});routeIds.push(route);
    await change(office,{operation:"publish-stops",route,expected:0,stops:r.stops});
    const vehicle=await change(office,{operation:"create-vehicle",...r.vehicle});
    await change(office,{operation:"create-schedule",route,vehicle,weekday:r.weekday,departure:r.departure});
    await deny(()=>change(office,{operation:"create-schedule",route,vehicle,weekday:r.weekday,departure:r.departure}));
  }
  const store=(await transportCatalog(office))!;
  assert.equal(store.routes.filter(r=>r.code.endsWith(tag)).flatMap(r=>r.stops).length,20);
  assert.equal(store.vehicles.filter(v=>v.label.endsWith(tag)).length,4);
  const [r1,r2]=routeIds.map(id=>store.routes.find(r=>r.id===id)!);
  assert.equal(r1.schedules[0].departure,"07:20");
  const waiting=await transportCatalog(student);
  assert.ok(waiting?.routes.some(r=>r.id===r1.id && r.stops.every(t=>t.lat===null&&t.lon===null)));
  assert.deepEqual(waiting?.vehicles,[]);
  await deny(()=>change(office,{operation:"publish-stops",route:r1.id,expected:0,stops:fake[0].stops}));
  await deny(()=>change(student,{operation:"student-choice",route:r1.id,stop:r2.stops[0].id}));
  await deny(()=>change(tenant,{operation:"student-choice",route:r1.id,stop:r1.stops[1].id}));
  assert.doesNotMatch(JSON.stringify(await transportCatalog(tenant)),/Fictional Cedar line|Fern Square/);
  await change(student,{operation:"student-choice",route:r1.id,stop:r1.stops[1].id});
  await change(office,{operation:"lock-route",route:r1.id,locked:true});
  await deny(()=>change(otherSection,{operation:"student-choice",route:r1.id,stop:r1.stops[1].id}));
  await change(student,{operation:"student-choice",route:r1.id,stop:r1.stops[2].id});
  assert.deepEqual((await transportCatalog(student))?.choice,{route_id:r1.id,stop_id:r1.stops[2].id});
  assert.equal((await transportCatalog(otherSection))?.choice,null);
  await owner.query("UPDATE department SET active=false WHERE institution_id=$1",[f.institution]);
  try{
    assert.equal(await transportCatalog(student),null);
    await deny(()=>change(student,{operation:"student-choice",route:r2.id,stop:r2.stops[1].id}));
  }finally{
    await owner.query("UPDATE department SET active=true WHERE institution_id=$1",[f.institution]);
  }
  const actions=await owner.query<{action:string}>("SELECT action FROM audit_event WHERE institution_id=$1 AND entity_id=$2 ORDER BY id",[f.institution,r1.id]);
  assert.deepEqual(actions.rows.map(x=>x.action),["transport.route_created","transport.stops_published","transport.choice_updated","transport.route_locked","transport.choice_updated"]);
});

import {changeTransportTrip as tripChange,studentActiveTrip} from "../lib/transport/trips";
test("an active simulated trip freezes the old stop until the next trip",async()=>{
  const route=await change(office,{operation:"create-route",...fake[0],code:tripCode});
  const vehicle=await change(office,{operation:"create-vehicle",...fake[0].vehicle,title:tripVehicle});
  let first="",next="";
  try{
    await change(office,{operation:"publish-stops",route,expected:0,stops:fake[0].stops});
    const schedule=await change(office,{operation:"create-schedule",route,vehicle,weekday:3,departure:"07:20"});
    const [depot,fern,amber]=(await transportCatalog(student))!.routes.find(r=>r.id===route)!.stops;
    await change(student,{operation:"student-choice",route,stop:fern.id});
    await deny(()=>tripChange(office,{operation:"create-trip",schedule,day:"2026-12-02",mode:"live"}));
    await deny(()=>tripChange(office,{operation:"create-trip",schedule,day:"2026-12-03",mode:"simulated"}));
    first=await tripChange(office,{operation:"create-trip",schedule,day:"2026-12-02",mode:"simulated"});
    next=await tripChange(office,{operation:"create-trip",schedule,day:"2026-12-09",mode:"simulated"});
    await deny(()=>tripChange(student,{operation:"start-trip",trip:first}));
    await tripChange(office,{operation:"start-trip",trip:first});
    await deny(()=>tripChange(office,{operation:"start-trip",trip:first}));
    await deny(()=>tripChange(office,{operation:"start-trip",trip:next}));
    const current=await studentActiveTrip(student);
    assert.equal(current?.stop,"Fern Square");
    assert.equal(current?.scheduled_at,"07:25");
    assert.equal(current?.mode,"simulated");
    assert.equal(await studentActiveTrip(otherSection),null);
    assert.equal(await studentActiveTrip(tenant),null);
    await change(student,{operation:"student-choice",route,stop:amber.id});
    assert.equal((await studentActiveTrip(student))?.stop,fern.label);
    await tripChange(office,{operation:"complete-trip",trip:first});
    assert.equal(await studentActiveTrip(student),null);
    await tripChange(office,{operation:"start-trip",trip:next});
    assert.equal((await studentActiveTrip(student))?.stop,amber.label);
    assert.notEqual((await studentActiveTrip(student))?.stop,depot.label);
    await tripChange(office,{operation:"cancel-trip",trip:next});
    assert.equal(await studentActiveTrip(student),null);
  }finally{
    const relevant=[first,next].filter(Boolean);
    await owner.query("DELETE FROM transport_trip_rider WHERE institution_id=$1 AND trip_id=ANY($2)",[f.institution,relevant]);
    await owner.query("DELETE FROM transport_trip WHERE institution_id=$1 AND id=ANY($2)",[f.institution,relevant]);
  }
});
