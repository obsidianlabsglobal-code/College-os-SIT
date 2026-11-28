// covers: TR-006, TO-009 (local service and QR credential lifecycle)
import "../scripts/environment";
import {after,before,test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {Pool} from "pg";
import {db} from "../lib/db";
import {fixtures as f,demoEmail} from "../scripts/fixtures";
import type {Scope} from "../lib/scope";
import {changeTransportCatalog,transportCatalog} from "../lib/transport/catalog";
import {changeTransportTrip} from "../lib/transport/trips";
import {boardBus,boardDisplay,issueBoardCredential,officeBoardingDevices,officeBoardingLog,revokeBoardDevice,riderBoardingHistory} from "../lib/transport/boarding";
import {publishFictionalTransportPosition} from "../lib/transport/telemetry";
import {submitEtaFeedback,officeEtaFeedback} from "../lib/transport/feedback";
import { assignRouteTeacher,signalBusSos,busSosDesk } from "../lib/transport/sos";
import { changeBackupConsent,submitBackupFix } from "../lib/transport/rider-backup";
import { studentTimeline } from "../lib/transport/student-timeline";
import { changeTransportOversight,transportOversight } from "../lib/transport/oversight";
import {fictionalTransportRoutes} from "../lib/transport/demo-fixtures";
import {clearTransportFixture,grantFakeTransportOffice} from "./transport-fixture";
const owner=new Pool({connectionString:process.env.MIGRATION_DATABASE_URL});
const tag=randomUUID().slice(0,8),code="BOARD-"+tag,title="Fixture bus boarding "+tag;
let gate:Awaited<ReturnType<typeof grantFakeTransportOffice>>,office:Scope,student:Scope,unboarded:Scope,tenant:Scope,faculty:Scope,trip="",vehicle="",routeId="";
const env=["NEXUS_TRANSPORT_SIMULATION_ENABLED","NEXUS_TRANSPORT_BOARDING_SECRET","NEXUS_TRANSPORT_RIDER_BACKUP_ENABLED"] as const;
const savedEnv=env.map(k=>process.env[k]);
before(async()=>{
  gate=await grantFakeTransportOffice(owner);office={institution:f.institution,role:"transport",account:gate.account};
  const {rows}=await owner.query<{alias:string;id:string}>('SELECT split_part(email,\'@\',1) AS alias,id FROM "user" WHERE email=ANY($1)',[["student","outsider","tenant","faculty"].map(demoEmail)]);
  const ids=Object.fromEntries(rows.map(r=>[r.alias,r.id]));
  student={institution:f.institution,role:"student",account:ids.student};
  unboarded={...student,account:ids.outsider};
  tenant={...student,institution:f.otherInstitution,account:ids.tenant};
  faculty={institution:f.institution,role:"faculty",account:ids.faculty};
  process.env.NEXUS_TRANSPORT_SIMULATION_ENABLED="true";
  process.env.NEXUS_TRANSPORT_BOARDING_SECRET="fictional-test-key-never-set-in-production";
});
after(async()=>{
  for(const [i,key] of env.entries()) {if(savedEnv[i]===undefined)delete process.env[key];else process.env[key]=savedEnv[i];}
  try{
    if(trip){
      const {rows:cases}=await owner.query<{case_id:string}>("DELETE FROM transport_sos WHERE institution_id=$1 AND trip_id=$2 RETURNING case_id",[f.institution,trip]);
      for(const e of cases) await owner.query("DELETE FROM case_record WHERE institution_id=$1 AND id=$2",[f.institution,e.case_id]);
      await owner.query("DELETE FROM push_message WHERE institution_id=$1 AND title='Bus SOS' AND body LIKE $2",[f.institution,"%"+title+"%"]);
    }
    if(routeId){
      await owner.query("DELETE FROM transport_route_teacher WHERE institution_id=$1 AND route_id=$2",[f.institution,routeId]);
      await owner.query("DELETE FROM transport_fee_status WHERE institution_id=$1 AND student_id=$2",[f.institution,student.account]);
    }
    if(trip)for(const table of ["transport_backup_fix","transport_backup_consent","transport_eta_feedback","transport_pickup_alert","transport_boarding","transport_position","transport_trip_rider"])
      await owner.query(`DELETE FROM ${table} WHERE institution_id=$1 AND trip_id=$2`,[f.institution,trip]);
    if(trip)await owner.query("DELETE FROM transport_trip WHERE institution_id=$1 AND id=$2",[f.institution,trip]);
    if(vehicle)for(const table of ["transport_boarding_device","transport_sticker"])
      await owner.query(`DELETE FROM ${table} WHERE institution_id=$1 AND vehicle_id=$2`,[f.institution,vehicle]);
    if(gate)await clearTransportFixture(owner,[code],[title],gate);
  }finally{await Promise.all([owner.end(),db.end()]);}
});
test("boarding screen, rotated sticker, own route/stop and daily log use the bus position only",async()=>{
  const route=await changeTransportCatalog(office,{operation:"create-route",code,title,direction:"inbound"});
  routeId=route;
  await changeTransportCatalog(office,{operation:"publish-stops",route,expected:0,stops:fictionalTransportRoutes[0].stops});
  vehicle=await changeTransportCatalog(office,{operation:"create-vehicle",title,seats:36,capacity:40});
  const schedule=await changeTransportCatalog(office,{operation:"create-schedule",route,vehicle,weekday:3,departure:"07:20"});
  const [depot,stop]=(await transportCatalog(office))!.routes.find(r=>r.id===route)!.stops;
  await changeTransportCatalog(student,{operation:"student-choice",route,stop:stop.id});
  const screen=await issueBoardCredential(office,{vehicle,kind:"device",label:"Fictional mounted display"});
  const oldSticker=await issueBoardCredential(office,{vehicle,kind:"sticker"});
  const sticker=await issueBoardCredential(office,{vehicle,kind:"sticker"});
  const fake=(lat:number,lon:number)=>publishFictionalTransportPosition(office,{trip,fix:{lat,lon,observedAt:new Date().toISOString()}});
  assert.equal((await boardDisplay(screen))?.code,null);
  trip=await changeTransportTrip(office,{operation:"create-trip",schedule,day:"2026-12-02",mode:"simulated"});
  await changeTransportTrip(office,{operation:"start-trip",trip});
  const qr=(await boardDisplay(screen))?.code;
  assert.ok(qr);
  assert.equal((await boardDisplay(screen))?.code,qr);
  await assert.rejects(()=>boardBus(student,sticker)); // no bus position yet
  assert.equal(await fake(depot.lat!,depot.lon!),"accepted");
  assert.ok((await studentTimeline(student))?.alertedAt,"fresh bus approaching the saved stop has a durable in-app alert");
  await assert.rejects(()=>signalBusSos(unboarded,{trip,confirmed:true}));
  await assert.rejects(()=>signalBusSos(tenant,{trip,confirmed:true}));
  await assert.rejects(()=>boardBus(student,qr),/not confirmed near/);
  await owner.query("UPDATE transport_position SET observed_at=clock_timestamp()-interval '60 seconds' WHERE institution_id=$1 AND trip_id=$2",[f.institution,trip]);
  assert.equal(await fake(stop.lat!,stop.lon!),"accepted");
  await assert.rejects(()=>boardBus(student,oldSticker));
  await assert.rejects(()=>boardBus(unboarded,sticker));
  await assert.rejects(()=>boardBus(tenant,qr));
  await assert.rejects(()=>boardBus(student,qr.replace(trip,randomUUID())));
  const device=(await officeBoardingDevices(office))[0];
  await revokeBoardDevice(office,device.id);
  assert.equal(await boardDisplay(screen),null);
  await assert.rejects(()=>boardBus(student,qr));
  assert.equal(await boardBus(student,sticker),trip);
  await assert.rejects(()=>boardBus(student,sticker),/already boarded/);
  assert.equal((await riderBoardingHistory(student))[0].stop,"Fern Square");
  assert.deepEqual(await riderBoardingHistory(unboarded),[]);
  const report=(await officeBoardingLog(office))[0];
  assert.equal(report.seats,36);
  assert.equal(report.manifest.filter(m=>m.boarded).length,1);
  await submitEtaFeedback(student,{trip,accurate:false,comment:"Fictional late pickup"});
  assert.match(JSON.stringify(await officeEtaFeedback(office)),/Fictional late pickup/);
  await assert.rejects(()=>submitEtaFeedback(unboarded,{trip,accurate:false}));
  await assert.rejects(()=>submitEtaFeedback(student,{trip,accurate:true}));
  await assignRouteTeacher(office,{route,faculty:faculty.account});
  const sos=await signalBusSos(student,{trip,confirmed:true});
  assert.equal((await signalBusSos(student,{trip,confirmed:true})).id,sos.id);
  assert.equal((await busSosDesk(office)).find(x=>x.id===sos.id)?.repeats,2);
  assert.ok((await busSosDesk(faculty)).some(x=>x.id===sos.id));
  assert.deepEqual(await busSosDesk(unboarded),[]);
  assert.equal((await owner.query("SELECT 1 FROM push_message WHERE institution_id=$1 AND title='Bus SOS' AND body LIKE $2",[f.institution,"%"+title+"%"])).rowCount,2);
  await changeTransportOversight(office,{operation:"fee-status",student:student.account,status:"due"});
  assert.equal((await transportOversight(office)).fees.find(f=>f.id===student.account)?.status,"due");
  assert.deepEqual((await transportOversight(student)).fees,[]);
  assert.deepEqual((await transportOversight(faculty)).fees,[]);
  await assert.rejects(()=>changeTransportOversight({...office,institution:f.otherInstitution},{operation:"fee-status",student:student.account,status:"paid"}));
  await assert.rejects(async()=>changeBackupConsent(student,{trip,enabled:true}));
  process.env.NEXUS_TRANSPORT_RIDER_BACKUP_ENABLED="true";
  const backup={trip,lat:stop.lat!,lon:stop.lon!,accuracy:12};
  await assert.rejects(()=>changeBackupConsent(unboarded,{trip,enabled:true}));
  // The service refuses writes while there is a valid main feed even for opted-in people.
  await changeBackupConsent(student,{trip,enabled:true});
  assert.equal(await submitBackupFix(student,backup),"bus-signal-available");
  await owner.query("UPDATE transport_position SET observed_at=observed_at-interval '2 minutes' WHERE institution_id=$1 AND trip_id=$2",[f.institution,trip]);
  assert.equal(await submitBackupFix(student,backup),"saved");
  assert.ok((await studentTimeline(student))?.usedBackup);
  await changeTransportTrip(office,{operation:"complete-trip",trip});
  assert.equal((await owner.query("SELECT 1 FROM transport_backup_fix WHERE institution_id=$1 AND trip_id=$2",[f.institution,trip])).rowCount,0);
  await assert.rejects(()=>submitBackupFix(student,backup));
  await assert.rejects(()=>signalBusSos(student,{trip,confirmed:true}));
  await assert.rejects(()=>boardBus(student,sticker));
});
