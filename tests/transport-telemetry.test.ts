// covers: TR-008, TO-005, TR-010 (local adapter and retention only)
import "../scripts/environment";
import assert from "node:assert/strict";
import { after,before,test } from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { db } from "../lib/db";
import { fixtures as f,demoEmail } from "../scripts/fixtures";
import { changeTransportCatalog } from "../lib/transport/catalog";
import { fictionalTransportRoutes } from "../lib/transport/demo-fixtures";
import { changeTransportTrip } from "../lib/transport/trips";
import { acceptOsmAnd,acceptStockOsmAnd,issueTransportDevice,purgeTransportHistory,revokeTransportDevice,transportDevices } from "../lib/transport/telemetry";
import { decodeOsmAnd } from "../lib/transport/osmand";
import { clearTransportFixture,grantFakeTransportOffice,scheduledTransportTestPool } from "./transport-fixture";
import type { Scope } from "../lib/scope";
const owner=new Pool({connectionString:process.env.MIGRATION_DATABASE_URL});
const worker=scheduledTransportTestPool();
const marker=randomUUID().slice(0,8),code="GPS-"+marker,title="Fictional GPS test "+marker;
const priorLive=process.env.NEXUS_TRANSPORT_LIVE_ENABLED;
let gate:Awaited<ReturnType<typeof grantFakeTransportOffice>>,office:Scope,rider:Scope,driver:string,driverGranted=false;
let vehicle:string|null=null,trip:string|null=null;
before(async()=>{
  gate=await grantFakeTransportOffice(owner);
  office={account:gate.account,role:"transport",institution:f.institution};
  const people=await owner.query<{alias:string;id:string}>('SELECT split_part(email,\'@\',1) AS alias,id FROM "user" WHERE email=ANY($1)',[["student","outsider"].map(demoEmail)]);
  const ids=Object.fromEntries(people.rows.map(r=>[r.alias,r.id]));
  rider={account:ids.student,role:"student",institution:f.institution};
  driver=ids.outsider;
  driverGranted=Boolean((await owner.query("INSERT INTO membership(institution_id,account_id,role) VALUES ($1,$2,'driver') ON CONFLICT DO NOTHING",[f.institution,driver])).rowCount);
  process.env.NEXUS_TRANSPORT_LIVE_ENABLED="true";
});
after(async()=>{
  if(priorLive===undefined) delete process.env.NEXUS_TRANSPORT_LIVE_ENABLED; else process.env.NEXUS_TRANSPORT_LIVE_ENABLED=priorLive;
  try{
    if(trip){
      await owner.query("DELETE FROM transport_position WHERE institution_id=$1 AND trip_id=$2",[f.institution,trip]);
      await owner.query("DELETE FROM transport_trip_rider WHERE institution_id=$1 AND trip_id=$2",[f.institution,trip]);
      await owner.query("DELETE FROM transport_trip WHERE institution_id=$1 AND id=$2",[f.institution,trip]);
    }
    if(vehicle)await owner.query("DELETE FROM transport_device WHERE institution_id=$1 AND vehicle_id=$2",[f.institution,vehicle]);
    if(driverGranted)await owner.query("DELETE FROM membership WHERE institution_id=$1 AND account_id=$2 AND role='driver'",[f.institution,driver]);
    if(gate)await clearTransportFixture(owner,[code],[title],gate);
  }finally{await Promise.all([owner.end(),db.end(),worker.end()]);}
});
test("OsmAnd form accepts documented timestamp and coordinate formats and converts default knots",()=>{
  const p=decodeOsmAnd(new URLSearchParams({deviceid:"fake-1",timestamp:"2026-11-28 08:00:00",location:"12.2,76.2",speed:"10",valid:"true",accuracy:"5"}));
  assert.equal(p.deviceId,"fake-1");
  assert.equal(p.fix.observedAt,"2026-11-28T08:00:00Z");
  assert.ok(Math.abs(p.fix.speedKmh!-18.52)<0.00001);
  assert.equal(decodeOsmAnd(new URLSearchParams({id:"fake-1",timestamp:"1609459200000",lat:"12",lon:"76"})).fix.observedAt,"2021-01-01T00:00:00.000Z");
  assert.throws(()=>decodeOsmAnd(new URLSearchParams({id:"test",lat:"91",lon:"76",timestamp:"1609459200"})));
  assert.throws(()=>decodeOsmAnd(new URLSearchParams("id=fake&id=two&lat=12&lon=76&timestamp=1609459200")));
  assert.throws(()=>decodeOsmAnd(new URLSearchParams({id:"test",lat:"12",lon:"76",valid:"0",timestamp:"1609459200"})));
});
test("device token, trip, ordering, revocation, plausibility, limit and seven-day retention", async()=>{
  const route=await changeTransportCatalog(office,{operation:"create-route",code,title,direction:"inbound"});
  await changeTransportCatalog(office,{operation:"publish-stops",route,expected:0,stops:fictionalTransportRoutes[0].stops});
  vehicle=await changeTransportCatalog(office,{operation:"create-vehicle",title,seats:36,capacity:40});
  const primaryId="fixture-main-"+marker, backupId="fixture-backup-"+marker;
  const d=await issueTransportDevice(office,{vehicle,label:"Lab fixture primary",clientId:primaryId});
  const b=await issueTransportDevice(office,{vehicle,label:"Lab fixture backup",clientId:backupId});
  const stock=await issueTransportDevice(office,{vehicle,label:"Lab fixture stock",protocol:"stock"});
  await assert.rejects(()=>issueTransportDevice(rider,{vehicle,label:"not allowed",clientId:"fake"}));
  assert.deepEqual(await transportDevices(rider),[]);
  const tenant={...office,institution:f.otherInstitution};
  assert.doesNotMatch(JSON.stringify(await transportDevices(tenant)),/Lab fixture primary/);
  const fix=(age:number,lat=12.25,lon=76.62)=>({observedAt:new Date(Date.now()-age*1000).toISOString(),lat,lon,accuracy:8,speedKmh:10});
  assert.equal(await acceptOsmAnd(d.token,"not-bound",fix(1)),"unauthorized");
  assert.equal(await acceptOsmAnd(d.token,primaryId,fix(1)),"no-trip");
  assert.equal(await acceptStockOsmAnd(stock.token,fix(1)),"no-trip");
  assert.equal(await acceptStockOsmAnd(primaryId,fix(1)),"unauthorized");
  const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const weekday=new Date(today+"T00:00:00Z").getUTCDay()||7;
  const schedule=await changeTransportCatalog(office,{operation:"create-schedule",route,vehicle,weekday,departure:"07:20"});
  trip=await changeTransportTrip(office,{operation:"create-trip",schedule,day:today,mode:"live",driver});
  await changeTransportTrip(office,{operation:"start-trip",trip});
  await owner.query("UPDATE transport_trip SET started_at=clock_timestamp()-interval '2 minutes' WHERE institution_id=$1 AND id=$2",[f.institution,trip]);
  const initial=fix(60);
  assert.equal(await acceptOsmAnd(d.token,primaryId,initial),"accepted");
  assert.equal(await acceptOsmAnd(d.token,primaryId,initial),"duplicate-or-old");
  assert.equal(await acceptOsmAnd(d.token,primaryId,fix(70)),"duplicate-or-old");
  assert.equal(await acceptOsmAnd(d.token,primaryId,fix(50,22,83)),"quarantined");
  assert.equal(await acceptOsmAnd(d.token,primaryId,fix(604801)),"invalid-time");
  assert.equal(await acceptOsmAnd(b.token,backupId,fix(40,12.2505)),"accepted");
  const latest=await owner.query<{latitude:number}>(`SELECT p.latitude FROM transport_latest_position l JOIN transport_position p
    ON (l.institution_id,l.position_id)=(p.institution_id,p.id) WHERE l.institution_id=$1 AND l.trip_id=$2`,[f.institution,trip]);
  assert.equal(latest.rows[0].latitude,12.2505);
  await revokeTransportDevice(office,stock.id);
  assert.equal(await acceptStockOsmAnd(stock.token,fix(15)),"unauthorized");
  await revokeTransportDevice(office,d.id);
  assert.equal(await acceptOsmAnd(d.token,primaryId,fix(20)),"unauthorized");
  for(let n=0;n<15;n++)assert.equal(await acceptOsmAnd(b.token,backupId,initial),"duplicate-or-old");
  assert.equal(await acceptOsmAnd(b.token,backupId,fix(20)),"rate-limited");
  const aged=await owner.query<{id:string}>(`INSERT INTO transport_position(institution_id,trip_id,vehicle_id,device_id,source,observed_at,latitude,longitude)
    VALUES ($1,$2,$3,$4,'live',clock_timestamp()-interval '169 hours',12.25,76.62) RETURNING id`,[f.institution,trip,vehicle,b.id]);
  await assert.rejects(()=>purgeTransportHistory(rider), "manual purge requires the office role");
  await assert.rejects(()=>db.query("SELECT * FROM public.transport_scheduled_maintenance()"),{code:"42501"});
  await assert.rejects(()=>worker.query("SELECT latitude FROM transport_position"),{code:"42501"});
  const sweep=async()=>Number((await worker.query("SELECT positions_removed FROM public.transport_scheduled_maintenance()")).rows[0].positions_removed);
  assert.equal(await sweep(),1);
  assert.equal(await sweep(),0);
  assert.equal(await purgeTransportHistory(office),0);
  assert.equal((await owner.query("SELECT 1 FROM transport_latest_position WHERE institution_id=$1 AND trip_id=$2",[f.institution,trip])).rowCount,1);
  assert.equal((await owner.query("SELECT 1 FROM transport_position WHERE institution_id=$1 AND id=$2",[f.institution,aged.rows[0].id])).rowCount,0);
  await changeTransportTrip(office,{operation:"complete-trip",trip});
  await owner.query("UPDATE transport_device SET rate_count=0 WHERE institution_id=$1 AND id=$2",[f.institution,b.id]);
  assert.equal(await acceptOsmAnd(b.token,backupId,fix(1)),"no-trip");
});
