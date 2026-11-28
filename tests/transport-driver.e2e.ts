// covers: TO-004, TO-005, TO-006, TR-008, TR-025, TR-026 (driver foundation)
import "../scripts/environment";
import {test,expect} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {Pool} from "pg";
import {demoEmail,fixtures as f} from "../scripts/fixtures";
import {clearTransportFixture,grantFakeTransportOffice} from "./transport-fixture";
import {changeTransportCatalog} from "../lib/transport/catalog";
import {changeTransportTrip} from "../lib/transport/trips";
import {fictionalTransportRoutes} from "../lib/transport/demo-fixtures";
import {driverOfficeAction} from "../lib/transport/driver-office";
import {configureDriverPhone} from "../lib/transport/driver-phone";

test("NEXUS Driver binds to the assigned bus, replays a queued pre-trip check, and locks controls",async({page,context,request},info)=>{
  test.skip(process.env.NEXUS_TRANSPORT_LOCAL_TEST!=="1","Explicit driver local test mode.");
  test.setTimeout(80_000);
  const owner=new Pool({connectionString:process.env.MIGRATION_DATABASE_URL});
  const grant=await grantFakeTransportOffice(owner);
  const scope={institution:f.institution,account:grant.account,role:"transport"} as const;
  const driver=(await owner.query<{id:string}>('SELECT id FROM "user" WHERE email=$1',[demoEmail("outsider")])).rows[0].id;
  const driverAdded=(await owner.query("INSERT INTO membership(institution_id,account_id,role) VALUES($1,$2,'driver') ON CONFLICT DO NOTHING",[f.institution,driver])).rowCount;
  const sid=randomUUID().slice(0,8),code="DRV"+sid,title="Fictional driver vehicle "+sid;
  let trip="",vehicle="";
  try{
    const route=await changeTransportCatalog(scope,{operation:"create-route",code,title,direction:"inbound"});
    await changeTransportCatalog(scope,{operation:"publish-stops",route,expected:0,stops:fictionalTransportRoutes[0].stops});
    vehicle=await changeTransportCatalog(scope,{operation:"create-vehicle",title,seats:36,capacity:40});
    const day=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
    const weekday=new Date(day+"T00:00:00Z").getUTCDay()||7;
    const schedule=await changeTransportCatalog(scope,{operation:"create-schedule",route,vehicle,weekday,departure:"07:20"});
    trip=await changeTransportTrip(scope,{operation:"create-trip",schedule,day,mode:"simulated",driver});
    const enrollment=await configureDriverPhone(scope,{operation:"bind-driver-phone",vehicle,driver,primaryPin:"4973"});
    expect(enrollment).toBeTruthy();
    await driverOfficeAction(scope,{operation:"driver-send-message",trip,kind:"diversion",bodyEn:"Fictional stop change.",bodyKn:"ಕಲ್ಪಿತ ನಿಲ್ದಾಣ ಬದಲಾವಣೆ."});
    await page.addInitScript(()=>{
      Object.defineProperty(window,"speechSynthesis",{value:undefined,configurable:true});
      Object.defineProperty(window,"SpeechSynthesisUtterance",{value:undefined,configurable:true});
    });
    const manifest=await request.get("/driver/manifest.webmanifest");
    expect(manifest.ok()).toBeTruthy();
    expect(await manifest.json()).toMatchObject({name:"NEXUS Driver",start_url:"/driver",display:"standalone"});
    await page.setViewportSize({width:390,height:844});
    await page.goto("/driver");
    await expect(page.getByRole("main")).toHaveAttribute("lang","kn-IN");
    await page.getByRole("button",{name:"English"}).click();
    await page.getByLabel("Office enrollment code").fill(enrollment!);
    const enrollmentReply=page.waitForResponse(r=>r.url().endsWith("/api/transport/driver")&&r.request().method()==="POST",{timeout:8000});
    await page.getByRole("button",{name:"Bind phone"}).click();
    expect((await enrollmentReply).status()).toBe(200);
    await page.getByLabel("Four-digit PIN").fill("4973");
    await page.getByRole("button",{name:"Unlock"}).click();
    await expect(page.getByRole("heading",{name:"Pre-trip check"})).toBeVisible();
    await expect(page.getByRole("button",{name:"Start trip"})).toBeDisabled();
    for(const name of ["Tyres","Brakes","Lights","Horn","Wipers","First-aid box","Fire extinguisher","Fuel level","Phone charging"]){
      await page.getByRole("button",{name:name+": OK",exact:true}).click();
    }
    await context.setOffline(true);
    await page.getByRole("button",{name:"Send check"}).click();
    await expect(page.getByText("Waiting for connection. Not sent.")).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByRole("button",{name:"Start trip"})).toBeEnabled({timeout:16000});
    await expect(page.getByText("Check recorded",{exact:false})).toBeVisible();
    expect((await owner.query("SELECT 1 FROM transport_driver_check WHERE institution_id=$1 AND trip_id=$2",[f.institution,trip])).rowCount).toBe(1);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
    expect((await page.getByRole("button",{name:"Start trip"}).boundingBox())!.height).toBeGreaterThanOrEqual(64);
    await page.screenshot({path:info.outputPath("driver-ready-390.png"),fullPage:true});
    await page.getByRole("button",{name:"Start trip"}).click();
    await expect(page.getByText("Controls locked.",{exact:false})).toBeVisible();
    await expect(page.getByRole("button",{name:"Hold 2 seconds to send SOS"})).toBeVisible();
    await expect(page.getByRole("heading",{name:"Quick reports"})).toHaveCount(0);
    await page.getByRole("button",{name:"Read aloud"}).click();
    await expect(page.getByText("Speech is unavailable.",{exact:false})).toBeVisible();
    await expect(page.getByRole("button",{name:"OK, understood"})).toHaveCount(0);
    await page.setViewportSize({width:1366,height:768});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(1366);
    await page.screenshot({path:info.outputPath("driver-locked-1366.png"),fullPage:true});
  }finally{
    await context.setOffline(false);
    if(trip){
      for(const table of ["transport_driver_command","transport_driver_check","transport_driver_message","transport_trip_rider"])
        await owner.query(`DELETE FROM ${table} WHERE institution_id=$1 AND trip_id=$2`,[f.institution,trip]);
      await owner.query("DELETE FROM transport_trip WHERE institution_id=$1 AND id=$2",[f.institution,trip]);
    }
    if(vehicle)await owner.query("DELETE FROM transport_driver_phone WHERE institution_id=$1 AND vehicle_id=$2",[f.institution,vehicle]);
    if(driverAdded)await owner.query("DELETE FROM membership WHERE institution_id=$1 AND account_id=$2 AND role='driver'",[f.institution,driver]);
    await clearTransportFixture(owner,[code],[title],grant);
    await owner.end();
  }
});
