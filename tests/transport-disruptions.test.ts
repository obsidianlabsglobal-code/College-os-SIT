// covers: TR-020, TR-021, TR-025, TO-012, TO-013 (office and localized in-app notices only)
import "../scripts/environment";
import {after,before,test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {Pool} from "pg";
import {db} from "../lib/db";
import type {Scope} from "../lib/scope";
import {fixtures as f,demoEmail} from "../scripts/fixtures";
import {changeTransportCatalog,transportCatalog} from "../lib/transport/catalog";
import {changeTransportTrip} from "../lib/transport/trips";
import {changeDisruption,officeDisruptions,riderDisruptions} from "../lib/transport/disruptions";
import {saveTransportPreferences} from "../lib/transport/pickup-alerts";
import {fictionalTransportRoutes} from "../lib/transport/demo-fixtures";
import {clearTransportFixture,grantFakeTransportOffice} from "./transport-fixture";
const owner=new Pool({connectionString:process.env.MIGRATION_DATABASE_URL});
const mark=randomUUID().slice(0,8),code="INC-"+mark,title="Example Disruption Bus "+mark;
let gate:Awaited<ReturnType<typeof grantFakeTransportOffice>>,office:Scope,en:Scope,kn:Scope,tenant:Scope,trip="",incident="",report="";
let options: {student_id:string;notice_language:string;phone_alerts:boolean}[]=[];
before(async()=>{
  gate=await grantFakeTransportOffice(owner);
  office={account:gate.account,role:"transport",institution:f.institution};
  const people=await owner.query<{alias:string;id:string}>('SELECT split_part(email,\'@\',1) AS alias,id FROM "user" WHERE email=ANY($1)',[["student","outsider","tenant"].map(demoEmail)]);
  const ids=Object.fromEntries(people.rows.map(r=>[r.alias,r.id]));
  en={account:ids.student,role:"student",institution:f.institution};kn={...en,account:ids.outsider};tenant={...en,account:ids.tenant,institution:f.otherInstitution};
  options=(await owner.query<typeof options[number]>("SELECT student_id,notice_language,phone_alerts FROM transport_rider_preference WHERE institution_id=$1 AND student_id=ANY($2)",[f.institution,[en.account,kn.account]])).rows;
});
after(async()=>{
  try{
    if(incident) {
      const {rows:[r]}=await owner.query<{case_id:string}>("SELECT case_id FROM transport_disruption WHERE institution_id=$1 AND id=$2",[f.institution,incident]);
      await owner.query("DELETE FROM transport_disruption_receipt WHERE institution_id=$1 AND disruption_id=$2",[f.institution,incident]);
      await owner.query("DELETE FROM transport_disruption_notice WHERE institution_id=$1 AND disruption_id=$2",[f.institution,incident]);
      await owner.query("DELETE FROM transport_disruption WHERE institution_id=$1 AND id=$2",[f.institution,incident]);
      if(r) await owner.query("DELETE FROM case_record WHERE institution_id=$1 AND id=$2",[f.institution,r.case_id]);
    }
    if(report)await owner.query("DELETE FROM case_record WHERE institution_id=$1 AND id=$2",[f.institution,report]);
    if(trip){
      await owner.query("DELETE FROM transport_trip_rider WHERE institution_id=$1 AND trip_id=$2",[f.institution,trip]);
      await owner.query("DELETE FROM transport_trip WHERE institution_id=$1 AND id=$2",[f.institution,trip]);
    }
    if(en&&kn){
      await owner.query("DELETE FROM transport_rider_preference WHERE institution_id=$1 AND student_id=ANY($2)",[f.institution,[en.account,kn.account]]);
      for(const o of options)await owner.query("INSERT INTO transport_rider_preference(institution_id,student_id,notice_language,phone_alerts) VALUES($1,$2,$3,$4)",[f.institution,o.student_id,o.notice_language,o.phone_alerts]);
    }
    if(gate)await clearTransportFixture(owner,[code],[title],gate);
  }finally{await Promise.all([owner.end(),db.end()]);}
});
test("office posts English and Kannada trip-scoped messages, counts reads, warns overdue and closes once",async()=>{
  const route=await changeTransportCatalog(office,{operation:"create-route",code,title,direction:"inbound"});
  await changeTransportCatalog(office,{operation:"publish-stops",route,expected:0,stops:fictionalTransportRoutes[0].stops});
  const vehicle=await changeTransportCatalog(office,{operation:"create-vehicle",title,seats:36,capacity:40});
  const schedule=await changeTransportCatalog(office,{operation:"create-schedule",route,vehicle,weekday:3,departure:"07:20"});
  const stop=(await transportCatalog(en))!.routes.find(r=>r.id===route)!.stops[1].id;
  for(const r of [en,kn])await changeTransportCatalog(r,{operation:"student-choice",route,stop});
  await saveTransportPreferences(en,{locale:"en",phoneAlerts:false});
  await saveTransportPreferences(kn,{locale:"kn",phoneAlerts:false});
  trip=await changeTransportTrip(office,{operation:"create-trip",schedule,day:"2026-12-02",mode:"simulated"});
  const input={operation:"open-disruption",trip,kind:"puncture",stop,clock:"update",when:new Date(Date.now()+120_000).toISOString(),action:"wait_at_stop"};
  await assert.rejects(()=>changeDisruption(office,input));
  await changeTransportTrip(office,{operation:"start-trip",trip});
  await assert.rejects(()=>changeDisruption(en,input));
  await assert.rejects(()=>changeDisruption({...office,institution:f.otherInstitution},input));
  incident=await changeDisruption(office,input);
  const enNotice=(await riderDisruptions(en))[0],knNotice=(await riderDisruptions(kn))[0];
  assert.match(enNotice.body,/flat tyre.+update/);
  assert.match(knNotice.body,/ಕ್ಷಮಿಸಿ/);
  assert.doesNotMatch(knNotice.body,/flat tyre/);
  assert.doesNotMatch(JSON.stringify(await riderDisruptions(tenant)),/Fern Square/);
  await changeDisruption(en,{operation:"read-disruption",incident,sequence:1});
  assert.equal((await officeDisruptions(office)).events[0].history[0].read,1);
  report=await changeDisruption(en,{operation:"report-bus",trip,summary:"Fixture ride report",body:"The usual stop was not used."});
  await assert.rejects(()=>changeDisruption(tenant,{operation:"report-bus",trip,summary:"x",body:"x"}));
  await owner.query("UPDATE transport_disruption SET update_by=clock_timestamp()-interval '1 minute' WHERE institution_id=$1 AND id=$2",[f.institution,incident]);
  assert.equal((await officeDisruptions(office)).events[0].overdue,true);
  const resolve={operation:"publish-disruption",incident,expected:1,stage:"all_clear",clock:"actual",when:new Date(Date.now()-1000).toISOString(),action:"resume"};
  await changeDisruption(office,resolve);
  await assert.rejects(()=>changeDisruption(office,resolve));
  assert.equal((await riderDisruptions(en))[0].stage,"all_clear");
  assert.equal((await riderDisruptions(kn))[0].stage,"all_clear");
  const event=(await officeDisruptions(office)).events[0];
  assert.equal(event.overdue,false);
  assert.equal(event.history.at(-1)?.receipts,2);
});
