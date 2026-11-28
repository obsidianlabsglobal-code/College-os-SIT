// covers: TR-006, TO-009, TR-010 (device screen, simulated route and verified boarding)
import "../scripts/environment";
import {expect,test} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {Pool} from "pg";
import {changeTransportCatalog,transportCatalog} from "../lib/transport/catalog";
import {changeTransportTrip} from "../lib/transport/trips";
import {boardDisplay,issueBoardCredential} from "../lib/transport/boarding";
import {publishFictionalTransportPosition} from "../lib/transport/telemetry";
import {fictionalTransportRoutes} from "../lib/transport/demo-fixtures";
import {fixtures as f,demoEmail,demoPassword} from "../scripts/fixtures";
import {clearTransportFixture,grantFakeTransportOffice} from "./transport-fixture";

test("a simulated bus screen shows a trip QR and the student records boarding at their stop",async({page,browser},testInfo)=>{
  test.skip(process.env.NEXUS_TRANSPORT_LOCAL_TEST!=="1","Explicit synthetic board-display test mode only.");
  const owner=new Pool({connectionString:process.env.MIGRATION_DATABASE_URL});
  const tag=randomUUID().slice(0,8),routeCode="QR-"+tag,vehicleName="Fictional Door Screen Bus "+tag;
  const fixture=await grantFakeTransportOffice(owner);
  const office={institution:f.institution,account:fixture.account,role:"transport" as const};
  let vehicle="",trip="";
  const device=await browser.newContext({viewport:{width:390,height:844}});
  try{
    const bus=await device.newPage();
    const {rows:[r]}=await owner.query<{id:string}>('SELECT id FROM "user" WHERE email=$1',[demoEmail("student")]);
    const student={institution:f.institution,account:r.id,role:"student" as const};
    const route=await changeTransportCatalog(office,{operation:"create-route",code:routeCode,title:"Fictional board route",direction:"inbound"});
    await changeTransportCatalog(office,{operation:"publish-stops",route,expected:0,stops:fictionalTransportRoutes[0].stops});
    vehicle=await changeTransportCatalog(office,{operation:"create-vehicle",title:vehicleName,seats:36,capacity:40});
    const dt=await changeTransportCatalog(office,{operation:"create-schedule",route,vehicle,weekday:3,departure:"07:20"});
    const stop=(await transportCatalog(office))!.routes.find(r=>r.id===route)!.stops[1];
    await changeTransportCatalog(student,{operation:"student-choice",route,stop:stop.id});
    const key=await issueBoardCredential(office,{vehicle,kind:"device",label:"Fictional door tablet"});
    await bus.goto("http://127.0.0.1:3000/transport/board");
    await bus.getByLabel("Boarding device credential").fill(key);
    await bus.getByRole("button",{name:"Connect this screen"}).click();
    await expect(bus.getByText("No active trip.",{exact:false})).toBeVisible();
    trip=await changeTransportTrip(office,{operation:"create-trip",schedule:dt,day:"2026-12-02",mode:"simulated"});
    await changeTransportTrip(office,{operation:"start-trip",trip});
    await publishFictionalTransportPosition(office,{trip,fix:{lat:stop.lat,lon:stop.lon,observedAt:new Date().toISOString()}});
    await expect(bus.getByRole("img",{name:"Scan this trip’s boarding QR"})).toBeVisible();
    expect(await bus.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
    await bus.screenshot({path:testInfo.outputPath("transport-boarding-screen-390.png"),fullPage:true});
    const code=(await boardDisplay(key))?.code??"";
    await page.setViewportSize({width:390,height:844});
    await page.setExtraHTTPHeaders({"x-forwarded-for":"198.19.208.85"});
    await page.goto("/login");await page.getByLabel("Email").fill(demoEmail("student"));
    await page.getByLabel("Password").fill(demoPassword);await page.getByRole("button",{name:"Sign in"}).click();
    await expect(page.getByRole("button",{name:"Sign out"})).toBeVisible();
    await page.goto(`/transport?institution=${f.institution}&role=student`);
    await expect(page.getByLabel("Active bus trip")).toContainText("Simulated");
    await page.getByLabel("Boarding code").fill(code);
    await page.getByRole("button",{name:"Confirm boarding"}).click();
    await expect(page.getByText("Your boarding was recorded.")).toBeVisible();
    await expect(page.getByLabel("Active bus trip")).toContainText("About 1 of 36 seats");
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
    await page.screenshot({path:testInfo.outputPath("transport-rider-boarded-390.png"),fullPage:true});
  } finally {
    await device.close();
    if(trip)for(const table of ["transport_pickup_alert","transport_boarding","transport_position","transport_trip_rider"])
      await owner.query(`DELETE FROM ${table} WHERE institution_id=$1 AND trip_id=$2`,[f.institution,trip]);
    if(trip)await owner.query("DELETE FROM transport_trip WHERE institution_id=$1 AND id=$2",[f.institution,trip]);
    if(vehicle)await owner.query("DELETE FROM transport_boarding_device WHERE institution_id=$1 AND vehicle_id=$2",[f.institution,vehicle]);
    await clearTransportFixture(owner,[routeCode],[vehicleName],fixture);
    await owner.end();
  }
});
