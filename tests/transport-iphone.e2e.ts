// covers: TR-006, TO-009 (WebKit software QR decode using a deterministic camera frame)
import "../scripts/environment";
import {test,expect} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {Pool} from "pg";
import {demoEmail,demoPassword,fixtures as f} from "../scripts/fixtures";
import {clearTransportFixture,grantFakeTransportOffice} from "./transport-fixture";
import {changeTransportCatalog,transportCatalog} from "../lib/transport/catalog";
import {changeTransportTrip} from "../lib/transport/trips";
import {boardDisplay,issueBoardCredential} from "../lib/transport/boarding";
import {publishFictionalTransportPosition} from "../lib/transport/telemetry";
import {fictionalTransportRoutes} from "../lib/transport/demo-fixtures";
import qrcodegen from "../lib/transport/vendor/qrcodegen";

test("iPhone WebKit with no native detector decodes a generated bus QR and records boarding",async({browserName,page},info)=>{
  test.skip(browserName!=="webkit"||process.env.NEXUS_TRANSPORT_LOCAL_TEST!=="1","Run via the dedicated WebKit fictional fixture.");
  const owner=new Pool({connectionString:process.env.MIGRATION_DATABASE_URL});
  const gate=await grantFakeTransportOffice(owner);
  const office={institution:f.institution,account:gate.account,role:"transport"} as const;
  const student={institution:f.institution,role:"student",account:(await owner.query('SELECT id FROM "user" WHERE email=$1',[demoEmail("student")])).rows[0].id} as const;
  const tag=randomUUID().slice(0,7),routeCode="IPH"+tag,title="Fictional iPhone bus "+tag;
  let trip="",vehicle="";
  try{
    const route=await changeTransportCatalog(office,{operation:"create-route",code:routeCode,title,direction:"inbound"});
    await changeTransportCatalog(office,{operation:"publish-stops",route,expected:0,stops:fictionalTransportRoutes[0].stops});
    vehicle=await changeTransportCatalog(office,{operation:"create-vehicle",title,seats:36,capacity:40});
    const schedule=await changeTransportCatalog(office,{operation:"create-schedule",route,vehicle,weekday:3,departure:"07:20"});
    const stop=(await transportCatalog(student))!.routes.find(r=>r.id===route)!.stops[0];
    await changeTransportCatalog(student,{operation:"student-choice",route,stop:stop.id});
    const key=await issueBoardCredential(office,{vehicle,kind:"device",label:"iPhone preview fixture"});
    trip=await changeTransportTrip(office,{operation:"create-trip",schedule,day:"2026-12-02",mode:"simulated"});
    await changeTransportTrip(office,{operation:"start-trip",trip});
    const coord=fictionalTransportRoutes[0].stops[0];
    await publishFictionalTransportPosition(office,{trip,fix:{observedAt:new Date().toISOString(),lat:coord.lat,lon:coord.lon,accuracy:8,speedKmh:0}});
    const code=(await boardDisplay(key))!.code!;
    expect(code).toMatch(/^s1\./);
    const qr=qrcodegen.QrCode.encodeText(code,qrcodegen.QrCode.Ecc.MEDIUM),size=qr.size+8;
    const black:string[]=[];
    for(let y=0;y<qr.size;y++)for(let x=0;x<qr.size;x++)if(qr.getModule(x,y))black.push(`M${x} ${y}h1v1h-1z`);
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="-4 -4 ${size} ${size}" shape-rendering="crispEdges"><rect x="-4" y="-4" width="${size}" height="${size}" fill="white"/><path d="${black.join("")}"/></svg>`;
    await page.addInitScript(frame=>{
      // Swap only the camera source. Canvas drawing, image pixels, decoder and form are real.
      const flags={stopped:0,deny:true};
      Object.defineProperty(window,"qaCamera",{value:flags});
      Object.defineProperty(globalThis,"BarcodeDetector",{value:undefined,configurable:true});
      const image=new Image();image.src=frame;
      let ready:Promise<unknown>|undefined;
      Object.defineProperty(navigator,"mediaDevices",{value:{getUserMedia:async()=>{
        if(flags.deny)throw new DOMException("Fixture denies permission","NotAllowedError");
        ready??=image.decode();
        await ready;
        const stream=new MediaStream();Object.defineProperty(stream,"getTracks",{value:()=>[{stop:()=>flags.stopped++}]});return stream;
      }}});
      const play=HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play=async function(){
        if(this instanceof HTMLVideoElement&&this.getAttribute("aria-label")==="QR scanner camera"){
          Object.defineProperties(this,{videoWidth:{value:600},videoHeight:{value:600}});return;
        }
        return play.call(this);
      };
      const draw=CanvasRenderingContext2D.prototype.drawImage as (...args:unknown[])=>void;
      CanvasRenderingContext2D.prototype.drawImage=function(this:CanvasRenderingContext2D,...args:unknown[]){
        if(args[0] instanceof HTMLVideoElement&&args[0].getAttribute("aria-label")==="QR scanner camera") args[0]=image;
        draw.apply(this,args);
      } as typeof CanvasRenderingContext2D.prototype.drawImage;
    },"data:image/svg+xml;base64,"+Buffer.from(svg).toString("base64"));
    await page.setViewportSize({width:390,height:844});
    await page.setExtraHTTPHeaders({"x-forwarded-for":"198.19.208.143"});
    await page.goto("/login");
    await page.getByLabel("Email").fill(demoEmail("student"));
    await page.getByLabel("Password").fill(demoPassword);
    await page.getByRole("button",{name:"Sign in"}).click();
    await expect(page.getByRole("button",{name:"Sign out"})).toBeVisible();
    await page.goto(`/transport?institution=${f.institution}&role=student`);
    await page.getByRole("button",{name:"Scan bus QR"}).click();
    await expect(page.getByText("Camera unavailable. Enter the boarding code instead.")).toBeVisible();
    await expect(page.getByLabel("Boarding code")).toBeEditable();
    await page.evaluate(()=>{(window as unknown as {qaCamera:{deny:boolean}}).qaCamera.deny=false;});
    await page.getByRole("button",{name:"Scan bus QR"}).click();
    await expect(page.getByLabel("Boarding code")).toHaveValue(code,{timeout:15000});
    await expect.poll(()=>page.evaluate(()=>(window as unknown as {qaCamera:{stopped:number}}).qaCamera.stopped)).toBeGreaterThan(0);
    // Refresh only the fictional bus fix to keep the real server near-stop check current.
    await publishFictionalTransportPosition(office,{trip,fix:{observedAt:new Date().toISOString(),lat:coord.lat,lon:coord.lon,accuracy:8,speedKmh:0}});
    await page.getByRole("button",{name:"Confirm boarding"}).click();
    await expect(page.getByText("Your boarding was recorded.")).toBeVisible();
    expect((await owner.query("SELECT 1 FROM transport_boarding WHERE institution_id=$1 AND trip_id=$2 AND student_id=$3",[f.institution,trip,student.account])).rowCount).toBe(1);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
    await page.screenshot({path:info.outputPath("iphone-webkit-qr-boarding-390.png"),fullPage:true});
  }finally{
    if(trip){
      for(const t of ["transport_pickup_alert","transport_boarding","transport_position","transport_trip_rider"])
        await owner.query(`DELETE FROM ${t} WHERE institution_id=$1 AND trip_id=$2`,[f.institution,trip]);
      await owner.query("DELETE FROM transport_trip WHERE institution_id=$1 AND id=$2",[f.institution,trip]);
    }
    if(vehicle)await owner.query("DELETE FROM transport_boarding_device WHERE institution_id=$1 AND vehicle_id=$2",[f.institution,vehicle]);
    await clearTransportFixture(owner,[routeCode],[title],gate);
    await owner.end();
  }
});
