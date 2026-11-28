// covers: TO-004, TO-005, TO-006, TR-008, TR-025, TR-026 (driver workspace core)
import "../scripts/environment";
import {test,after} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {Pool} from "pg";
import {db} from "../lib/db";
import {demoEmail,fixtures as f} from "../scripts/fixtures";
import type {Scope} from "../lib/scope";
import {changeTransportCatalog} from "../lib/transport/catalog";
import {changeTransportTrip} from "../lib/transport/trips";
import {fictionalTransportRoutes} from "../lib/transport/demo-fixtures";
import {configureDriverPhone,enrollDriverPhone,unlockDriverPhone} from "../lib/transport/driver-phone";
import {applyDriverCommand,checklist,driverToday} from "../lib/transport/driver-workspace";
import {acceptStockOsmAnd,issueTransportDevice} from "../lib/transport/telemetry";
import {driverOfficeAction,driverOwnRecords,officeDriverQueue,requestDriverLeave} from "../lib/transport/driver-office";
import {clearTransportFixture,grantFakeTransportOffice,scheduledTransportTestPool} from "./transport-fixture";

const owner=new Pool({connectionString:process.env.MIGRATION_DATABASE_URL});
const worker=scheduledTransportTestPool();
let addedGate:Awaited<ReturnType<typeof grantFakeTransportOffice>>|undefined;
let started:Date|undefined,actor="";
const fixtureTrips:string[]=[],vehicles:string[]=[],codes:string[]=[],titles:string[]=[],addedDrivers:string[]=[];
after(async()=>{
  try{
    const tenant=f.institution,refs=[tenant,fixtureTrips],buses=[tenant,vehicles];
    const incidents="SELECT id FROM transport_disruption WHERE institution_id=$1 AND trip_id=ANY($2::uuid[])";
    for(const table of ["transport_driver_report_photo","transport_update_warning","transport_disruption_receipt","transport_disruption_notice"])
      await owner.query(`DELETE FROM ${table} WHERE institution_id=$1 AND disruption_id IN (${incidents})`,refs);
    for(const table of ["transport_disruption","transport_driver_sos","transport_driver_command","transport_driver_check",
      "transport_driver_end_note","transport_driver_message","transport_position","transport_trip_rider"])
      await owner.query(`DELETE FROM ${table} WHERE institution_id=$1 AND trip_id=ANY($2::uuid[])`,refs);
    await owner.query("DELETE FROM transport_trip WHERE institution_id=$1 AND id=ANY($2::uuid[])",refs);
    for(const table of ["transport_device","transport_driver_reminder","transport_driver_document",
      "transport_driver_leave","transport_driver_phone","transport_maintenance"])
      await owner.query(`DELETE FROM ${table} WHERE institution_id=$1 AND vehicle_id=ANY($2::uuid[])`,buses);
    if(started){
      await owner.query(`DELETE FROM push_message WHERE institution_id=$1 AND created_at >= $2 AND title IN ('Driver SOS','Driver report')`,[tenant,started]);
      await owner.query(`DELETE FROM case_record WHERE institution_id=$1 AND created_at >= $2
        AND opened_by=$3 AND title IN ('Pre-trip check needs review','Driver SOS','Bus disruption: puncture')`,[tenant,started,actor]);
    }
    if(addedDrivers.length)await owner.query("DELETE FROM membership WHERE institution_id=$1 AND account_id=ANY($2::text[]) AND role='driver'",
      [tenant,addedDrivers]);
    if(addedGate)await clearTransportFixture(owner,codes,titles,addedGate);
  }finally{await Promise.all([db.end(),owner.end(),worker.end()]);}
});
test("bound phone, role and bus isolation, checklist, active telemetry boundary, offline receipts and SOS",async()=>{
  started=(await owner.query<{now:Date}>("SELECT statement_timestamp() AS now")).rows[0].now;
  const gate=addedGate=await grantFakeTransportOffice(owner);
  const office:Scope={institution:f.institution,account:gate.account,role:"transport"};
  const {rows:people}=await owner.query<{id:string;email:string}>('SELECT id,email FROM "user" WHERE email=ANY($1)',[["outsider","student"].map(demoEmail)]);
  const driver=people.find(p=>p.email===demoEmail("outsider"))!.id;
  const backup=people.find(p=>p.email===demoEmail("student"))!.id;
  actor=driver;
  for(const who of [driver,backup]){
    if((await owner.query("INSERT INTO membership(institution_id,account_id,role) VALUES($1,$2,'driver') ON CONFLICT DO NOTHING",[f.institution,who])).rowCount)
      addedDrivers.push(who);
  }
  process.env.NEXUS_TRANSPORT_LIVE_ENABLED="true";
  const tag=randomUUID().slice(0,8);
  const day=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const weekday=new Date(day+"T00:00:00Z").getUTCDay()||7;
  async function makeTrip(prefix:string){
    const code=prefix+tag,title="Fictional bus "+prefix+tag;
    const route=await changeTransportCatalog(office,{operation:"create-route",code,title:"Fictional "+prefix+tag,direction:"inbound"});
    codes.push(code);
    await changeTransportCatalog(office,{operation:"publish-stops",route,expected:0,stops:fictionalTransportRoutes[0].stops});
    const vehicle=await changeTransportCatalog(office,{operation:"create-vehicle",title,seats:36,capacity:40});
    vehicles.push(vehicle);titles.push(title);
    const schedule=await changeTransportCatalog(office,{operation:"create-schedule",route,vehicle,weekday,departure:"07:20"});
    const trip=await changeTransportTrip(office,{operation:"create-trip",schedule,day,mode:"live",driver});
    fixtureTrips.push(trip);
    return {route,vehicle,trip};
  }
  const assigned=await makeTrip("P"),other=await makeTrip("O");
  const x=(operation:string,trip=assigned.trip)=>({id:randomUUID(),trip,operation});
  const data={operation:"bind-driver-phone",driver,backup,vehicle:assigned.vehicle,primaryPin:"7821",backupPin:"1278"};
  await assert.rejects(()=>configureDriverPhone({...office,role:"student"},data));
  await assert.rejects(()=>configureDriverPhone({...office,institution:f.otherInstitution},data));
  const code=await configureDriverPhone(office,data);
  const phone=(await enrollDriverPhone(code))!;
  assert.ok(phone);
  assert.equal(await enrollDriverPhone(code),null);
  assert.equal(await unlockDriverPhone(phone,"0000"),null);
  const primary=(await unlockDriverPhone(phone,"7821"))!;
  const backupSession=(await unlockDriverPhone(phone,"1278"))!;
  assert.equal(await driverToday(phone,primary),null);
  assert.equal((await driverToday(phone,backupSession))?.trip?.id,assigned.trip);
  const session=(await unlockDriverPhone(phone,"7821"))!;
  await owner.query("UPDATE transport_trip SET scheduled_departure_at=clock_timestamp()+interval '14 minutes' WHERE institution_id=$1 AND id=$2",
    [f.institution,assigned.trip]);
  const seven=(await owner.query<{expiry:string}>(`SELECT ((clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date + 7)::text AS expiry`)).rows[0].expiry;
  await driverOfficeAction(office,{operation:"driver-document-expiry",vehicle:assigned.vehicle,kind:"licence",driver,expiry:seven});
  const reminders=async()=>Number((await worker.query("SELECT public.transport_driver_enqueue_reminders() AS queued")).rows[0].queued);
  assert.equal(await reminders(),2);
  assert.equal(await reminders(),0);
  const view=await driverToday(phone,session);
  assert.deepEqual(view?.reminders?.map(x=>x.lead_minutes).sort((a,b)=>a-b),[15,10080]);
  assert.equal(view?.trip?.id,assigned.trip);
  assert.doesNotMatch(JSON.stringify(view),/outsider|primary_driver|latitude/);
  await assert.rejects(()=>applyDriverCommand(phone,"A".repeat(43),x("start")));
  await assert.rejects(()=>applyDriverCommand(phone,session,x("end")));
  await assert.rejects(()=>applyDriverCommand(phone,session,x("start",other.trip)));
  await assert.rejects(()=>applyDriverCommand(phone,session,x("start")));
  const check={...x("check"),results:Object.fromEntries(checklist.map(i=>[i,i!=="tyres"]))};
  assert.deepEqual(await applyDriverCommand(phone,session,check),{duplicate:false});
  assert.deepEqual(await applyDriverCommand(phone,session,check),{duplicate:true});
  assert.equal((await owner.query("SELECT 1 FROM transport_maintenance WHERE institution_id=$1 AND vehicle_id=$2",[f.institution,assigned.vehicle])).rowCount,1);
  const device=await issueTransportDevice(office,{vehicle:assigned.vehicle,protocol:"stock",label:"Fictional tracker"});
  const fix=(seconds:number,speedKmh:number)=>({observedAt:new Date(Date.now()-seconds*1000).toISOString(),lat:12.25,lon:76.62,speedKmh,accuracy:10});
  assert.equal(await acceptStockOsmAnd(device.token,fix(1,0)),"no-trip");
  const start=x("start");
  await applyDriverCommand(phone,session,start);
  assert.deepEqual(await applyDriverCommand(phone,session,start),{duplicate:true});
  await assert.rejects(()=>applyDriverCommand(phone,session,x("start")));
  await owner.query("UPDATE transport_trip SET started_at=clock_timestamp()-interval '91 seconds' WHERE institution_id=$1 AND id=$2",[f.institution,assigned.trip]);
  assert.equal((await driverToday(phone,session))?.trip?.gpsMissing,true);
  assert.equal(await acceptStockOsmAnd(device.token,fix(20,25)),"accepted");
  assert.equal((await driverToday(phone,session))?.trip?.gpsMissing,false);
  await assert.rejects(()=>applyDriverCommand(phone,session,{...x("report"),kind:"puncture"}));
  await driverOfficeAction(office,{operation:"driver-send-message",trip:assigned.trip,kind:"diversion",bodyEn:"Fictional stop moved.",bodyKn:"ಕಲ್ಪಿತ ನಿಲ್ದಾಣ ಬದಲಾಗಿದೆ."});
  const message=(await driverToday(phone,session))!.trip!.messages[0].id;
  await assert.rejects(()=>applyDriverCommand(phone,session,{...x("ack"),message}));
  const signal=x("sos");await applyDriverCommand(phone,session,signal);await applyDriverCommand(phone,session,x("sos"));
  assert.deepEqual(await applyDriverCommand(phone,session,signal),{duplicate:true});
  assert.equal((await owner.query("SELECT 1 FROM transport_driver_sos WHERE institution_id=$1 AND trip_id=$2",[f.institution,assigned.trip])).rowCount,1);
  assert.equal(await acceptStockOsmAnd(device.token,fix(10,0)),"accepted");
  assert.equal(await acceptStockOsmAnd(device.token,fix(4,0)),"accepted");
  await applyDriverCommand(phone,session,{...x("ack"),message});
  assert.ok((await officeDriverQueue(office)).messages.find(m=>m.id===message)?.read_at);
  const report={...x("report"),kind:"puncture"};
  assert.deepEqual(await applyDriverCommand(phone,session,report),{duplicate:false});
  assert.deepEqual(await applyDriverCommand(phone,session,report),{duplicate:true});
  assert.equal((await owner.query("SELECT 1 FROM transport_disruption WHERE institution_id=$1 AND trip_id=$2",[f.institution,assigned.trip])).rowCount,1);
  await applyDriverCommand(phone,session,{...x("end"),odometer:2500});
  assert.equal(await acceptStockOsmAnd(device.token,fix(1,0)),"no-trip");
  assert.equal((await driverOwnRecords(f.institution,assigned.vehicle,driver)).trips.length,1);
  assert.equal((await driverOwnRecords(f.institution,assigned.vehicle,backup)).trips.length,0);
  await requestDriverLeave(phone,session,{kind:"swap",day:seven});
  const pending=(await officeDriverQueue(office)).requests.find(r=>r.kind==="swap"&&r.day===seven)!;
  assert.ok(pending&&pending.state==="pending");
  await assert.rejects(()=>driverOfficeAction({...office,institution:f.otherInstitution},{operation:"driver-decide-leave",request:pending.id,decision:"approved"}));
  await driverOfficeAction(office,{operation:"driver-decide-leave",request:pending.id,decision:"approved"});
  assert.equal((await officeDriverQueue(office)).requests.find(r=>r.id===pending.id)?.state,"approved");
  const phoneId=(await owner.query<{id:string}>("SELECT id FROM transport_driver_phone WHERE institution_id=$1 AND vehicle_id=$2",[f.institution,assigned.vehicle])).rows[0].id;
  await configureDriverPhone(office,{operation:"revoke-driver-phone",device:phoneId});
  assert.equal(await driverToday(phone,session),null);
});
