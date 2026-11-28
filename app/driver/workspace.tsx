"use client";
import {useCallback,useEffect,useRef,useState,type FormEvent,type ReactNode} from "react";
import {BoardingQr} from "../transport/board/qr";
import type {driverOwnRecords} from "../../lib/transport/driver-office";
import type {DriverView} from "../../lib/transport/driver-workspace";

const endpoint="/api/transport/driver", pendingKey="nexus-driver-pending-v1";
const checks={
  tyres:["ಟೈರ್‌ಗಳು","Tyres"],brakes:["ಬ್ರೇಕ್‌ಗಳು","Brakes"],lights:["ದೀಪಗಳು","Lights"],horn:["ಹಾರ್ನ್","Horn"],
  wipers:["ವೈಪರ್‌ಗಳು","Wipers"],firstAid:["ಪ್ರಥಮ ಚಿಕಿತ್ಸಾ ಪೆಟ್ಟಿಗೆ","First-aid box"],
  extinguisher:["ಅಗ್ನಿಶಾಮಕ ಸಾಧನ","Fire extinguisher"],fuel:["ಇಂಧನ ಮಟ್ಟ","Fuel level"],charging:["ಫೋನ್ ಚಾರ್ಜಿಂಗ್","Phone charging"],
};
const reports=[
  ["heavy_traffic","traffic","ಸಂಚಾರ ದಟ್ಟಣೆ","Traffic"],["weather_flooding","rain","ಮಳೆ","Rain"],["road_block","road_block","ರಸ್ತೆ ತಡೆ","Road block"],
  ["driver_delayed","waiting_at_stop","ನಿಲ್ದಾಣದಲ್ಲಿ ಕಾಯುತ್ತಿದೆ","Waiting at stop"],["driver_delayed","other","ಇತರ ವಿಳಂಬ","Other delay"],
  ["breakdown","","ಬಸ್ ಕೆಟ್ಟಿದೆ","Breakdown"],["puncture","","ಪಂಕ್ಚರ್","Puncture"],["accident_no_injuries","","ಅಪಘಾತ · ಗಾಯವಿಲ್ಲ","Accident · no injuries"],
  ["accident_injury","","ಅಪಘಾತ · ಗಾಯವಾಗಿದೆ","Accident · injuries"],["fuel","","ಇಂಧನ ಸಮಸ್ಯೆ","Fuel"],["route_diverted","","ಮಾರ್ಗ ಬದಲಾವಣೆ","Diversion"],
] as const;
type Command={id:string;trip:string;operation:string;[key:string]:unknown};
type Pending={issuedAt:number;action:Command};

async function post(data:Record<string,unknown>) {
  try {
    const r=await fetch(endpoint,{method:"POST",body:JSON.stringify(data),headers:{"content-type":"application/json"},cache:"no-store"});
    return r.ok?"sent":r.status>=500?"queued":"rejected";
  } catch {return "queued";}
}
function pending(tag:string):Pending[]{
  try{
    const stored=JSON.parse(localStorage.getItem(pendingKey+":"+tag)??"[]");
    return Array.isArray(stored)?stored.filter(x=>x&&Date.now()-x.issuedAt<(x.action?.operation==="sos"?120_000:15*60_000)).slice(0,12):[];
  }catch{return [];}
}
function setPending(tag:string,values:Pending[]) {
  try{if(values.length)localStorage.setItem(pendingKey+":"+tag,JSON.stringify(values));else localStorage.removeItem(pendingKey+":"+tag);return true;}catch{return false;}
}

export function DriverConsole(){
  const [english,language]=useState(false),[enrolled,enroll]=useState<boolean|null>(null);
  const [view,setView]=useState<DriverView>(null),[reachable,online]=useState(false),[status,setStatus]=useState("");
  const [busy,busySet]=useState(false),[now,setNow]=useState(0);
  const [showDoor,door]=useState(false);
  const [reportPhoto,setReportPhoto]=useState("");
  const [records,showRecords]=useState<Awaited<ReturnType<typeof driverOwnRecords>>|null>(null);
  const [voiceUnavailable,setVoiceUnavailable]=useState(false);
  const [checksDone,updateChecks]=useState<Record<string,boolean>>({});
  const sosTimer=useRef<ReturnType<typeof setTimeout>|null>(null), syncLock=useRef(false), queueTag=useRef("");
  const tx=(kn:string,en:string)=>english?en:kn;
  const refresh=useCallback(async()=>{
    try {
      const res=await fetch(endpoint,{cache:"no-store"});
      online(true);
      if(res.status===401){const info=await res.json();queueTag.current="";enroll(info.enrolled);setView(null);return;}
      if(!res.ok){queueTag.current="";enroll(null);setView(null);return;}
      const data=await res.json();queueTag.current=data.queueTag;enroll(true);setView(data);
    } catch {online(false);}
  },[]);
  const sync=useCallback(async ()=>{
    const tag=queueTag.current;
    if(!tag||syncLock.current||!navigator.onLine)return;
    syncLock.current=true;
    try{
      const jobs=pending(tag),finished=new Set<string>();
      for(const job of jobs){
        if(queueTag.current!==tag)break;
        const result=await post(job.action);
        if(result==="queued")break;
        finished.add(job.action.id);
        setStatus(result); // never display a sent tick until the server confirms it
      }
      const remaining=pending(tag).filter(x=>!finished.has(x.action.id));
      setPending(tag,remaining);
      if(remaining.length&&queueTag.current===tag)setStatus("queued");
      if(finished.size)await refresh();
    }finally{syncLock.current=false;}
  },[refresh]);
  useEffect(()=>{
    const tick=()=>{setNow(Date.now());if(!document.hidden)void refresh().then(sync);};
    tick();
    const timer=setInterval(tick,5000);
    window.addEventListener("online",tick);
    return()=>{clearInterval(timer);window.removeEventListener("online",tick);};
  },[refresh,sync]);
  useEffect(()=>{if("serviceWorker" in navigator)void navigator.serviceWorker.register("/driver/sw.js",{scope:"/driver"}).catch(()=>undefined);},[]);
  useEffect(()=>()=>{if(sosTimer.current)clearTimeout(sosTimer.current);},[]);
  const trip=view?.trip, active=trip?.state==="active", locked=Boolean(view?.inUse)||Boolean(active&&(!reachable||!trip.stopped));
  const submitSession=async(e:FormEvent<HTMLFormElement>,operation:string,key:string)=>{
    e.preventDefault();
    const form=new FormData(e.currentTarget);
    busySet(true);
    try{
      const result=await post({operation,[key]:form.get(key)});
      if(result==="sent"){if(queueTag.current)setPending(queueTag.current,[]);await refresh();}
      setStatus(result);
    }finally{busySet(false);}
  };
  async function preparePhoto(file:File|undefined){
    setReportPhoto("");
    if(!file)return;
    if(file.size>8_000_000){setStatus("rejected");return;}
    try{
      const image=await createImageBitmap(file);
      const ratio=Math.min(1,560/Math.max(image.width,image.height)),canvas=document.createElement("canvas");
      canvas.width=Math.max(1,Math.round(image.width*ratio));canvas.height=Math.max(1,Math.round(image.height*ratio));
      const context=canvas.getContext("2d");if(!context){image.close();throw Error();}
      context.drawImage(image,0,0,canvas.width,canvas.height);image.close();
      const encoded=canvas.toDataURL("image/jpeg",0.60).split(",")[1];
      if(!encoded||encoded.length>146_668)throw Error();
      setReportPhoto(encoded);
    }catch{setStatus("rejected");}
  }
  async function act(operation:string,fields:Record<string,unknown>={}){
    if(!trip||busy)return;
    busySet(true);
    try{
      const action={id:crypto.randomUUID(),trip:trip.id,operation,...fields};
      const result=await post(action);
      if(result==="queued"){
        // Never retain arbitrary problem text or a photo in browser storage.
        if(fields.photo||fields.problems){setStatus("rejected");return;}
        const tag=queueTag.current,values=tag?pending(tag):[];
        if(!tag||values.length>=12||!setPending(tag,[...values,{issuedAt:Date.now(),action}])){setStatus("rejected");return;}
      }
      setStatus(result);if(result==="sent"){if(operation==="report")setReportPhoto("");await refresh();}
    }finally{busySet(false);}
  }
  const cancelSos=()=>{if(sosTimer.current)clearTimeout(sosTimer.current);sosTimer.current=null;};
  const armSos=()=>{if(sosTimer.current===null)sosTimer.current=setTimeout(()=>{sosTimer.current=null;void act("sos");},2000);};
  function speak(message:{body_en:string;body_kn:string}){
    if(!window.speechSynthesis||typeof window.SpeechSynthesisUtterance!=="function"){setVoiceUnavailable(true);return;}
    const synth=window.speechSynthesis,voices=synth.getVoices();
    const kannada=voices.find(v=>v.lang.toLowerCase().startsWith("kn"));
    const indianEnglish=voices.find(v=>v.lang.toLowerCase()==="en-in");
    const speech=new SpeechSynthesisUtterance(!english&&kannada?message.body_kn:message.body_en);
    speech.lang=!english&&kannada?"kn-IN":"en-IN";
    if(!english&&kannada)speech.voice=kannada;else if(indianEnglish)speech.voice=indianEnglish;
    speech.onerror=()=>setVoiceUnavailable(true);setVoiceUnavailable(false);synth.cancel();synth.speak(speech);
  }
  async function recordsToggle(){
    if(records){showRecords(null);return;}
    try{const r=await fetch(endpoint+"?records=1",{cache:"no-store"});if(!r.ok)throw Error();showRecords(await r.json());}
    catch{setStatus("rejected");}
  }
  async function leaveForm(e:FormEvent<HTMLFormElement>){
    e.preventDefault();const f=new FormData(e.currentTarget);const result=await post({operation:"leave",kind:f.get("kind"),day:f.get("day")});
    setStatus(result==="queued"?"rejected":result);
  }
  const next=trip?.stops.find(s=>!s.passed);
  const time=(v:string)=>new Intl.DateTimeFormat(english?"en-IN":"kn-IN",{timeZone:"Asia/Kolkata",hour:"2-digit",minute:"2-digit"}).format(new Date(v));
  const icon=(glyph:string)=><span aria-hidden="true">{glyph}</span>;
  function action(label:string,glyph:string,onClick:()=>void,child?:ReactNode){
    return <button type="button" className="driver-action" disabled={busy||Boolean(locked)} onClick={onClick}>{icon(glyph)} {label}{child}</button>;
  }
  return <main className="driver-console" lang={english?"en-IN":"kn-IN"}>
    <header className="driver-row"><div><p>{tx("ಸಾರಿಗೆ ಸೇವೆ","Transport service")}</p><h1>NEXUS Driver</h1></div>
      {!locked&&action(tx("English","ಕನ್ನಡ"),"◉",()=>language(!english))}
    </header>
    <p role="status" aria-live="polite">{status==="sent"?tx("✓ ಕಳುಹಿಸಲಾಗಿದೆ","✓ Sent"):status==="queued"?tx("ಸಂಪರ್ಕ ಕಾಯುತ್ತಿದೆ. ಇನ್ನೂ ಕಳುಹಿಸಿಲ್ಲ.","Waiting for connection. Not sent."):
      status==="rejected"?tx("ಕಳುಹಿಸಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ. ಸಾರಿಗೆ ಕಚೇರಿಯನ್ನು ಸಂಪರ್ಕಿಸಿ.","Could not send. Contact the transport office."):null}</p>
    {!locked&&view?.reminders?.filter(x=>x.kind!=="duty").map(r=><p className="driver-warn" role="status" key={r.kind}>
      {tx(`ದಾಖಲೆ ನವೀಕರಿಸಿ: ${r.kind} · ${r.lead_minutes/1440} ದಿನಗಳು`,`Document renewal: ${r.kind} · ${r.lead_minutes/1440} day reminder`)}
    </p>)}
    {enrolled===null&&<section>{tx("ಸಂಪರ್ಕವನ್ನು ಪರಿಶೀಲಿಸಲಾಗುತ್ತಿದೆ","Checking connection")}</section>}
    {enrolled===false&&<section><h2>{tx("ಫೋನ್ ಜೋಡಿಸಿ","Bind this phone")}</h2><form onSubmit={e=>void submitSession(e,"enroll","code")}>
      <label>{tx("ಕಚೇರಿಯ ಜೋಡಣೆ ಕೋಡ್","Office enrollment code")}<input name="code" required maxLength={43} autoComplete="off"/></label>
      <button className="driver-action" disabled={busy}>{icon("↔")} {tx("ಜೋಡಿಸಿ","Bind phone")}</button></form></section>}
    {enrolled&&view===null&&<section><h2>{tx("ಚಾಲಕರ ಪ್ರವೇಶ","Driver sign-in")}</h2><form onSubmit={e=>void submitSession(e,"unlock","pin")}>
      <label>{tx("ನಾಲ್ಕು ಅಂಕಿಯ PIN","Four-digit PIN")}<input type="password" name="pin" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} required autoComplete="off"/></label>
      <button className="driver-action" disabled={busy}>{icon("➜")} {tx("ಪ್ರವೇಶಿಸಿ","Unlock")}</button></form></section>}
    {view&&!trip&&<section><h2>{tx("ಇಂದು","Today")}</h2><p>{tx("ನಿಮ್ಮ ಬಸ್‌ಗೆ ಯಾವುದೇ ಸೇವೆ ನಿಗದಿಯಾಗಿಲ್ಲ.","No assigned duty for this bus today.")}</p></section>}
    {trip&&<>
      <section><h2>{tx("ಇಂದು","Today")}</h2><p><strong>{trip.vehicle}</strong> · {trip.route}</p>
        <p>{tx("ಸೇವೆಯ ಸಮಯ","Duty start")}: {time(trip.departure)} IST {trip.simulated&&tx("· ಕಲ್ಪಿತ ಪರೀಕ್ಷೆ","· Simulation")}</p>
        {!active&&now>0&&<p>{Math.max(0,Math.ceil((Date.parse(trip.departure)-now)/60000))} {tx("ನಿಮಿಷ ಉಳಿದಿವೆ","min to duty")}</p>}
        {!active&&now>0&&Date.parse(trip.departure)>=now&&Date.parse(trip.departure)-now<=900000&&
          <p className="driver-warn" role="status">{tx("ಸೇವೆಗೆ ಸಿದ್ಧರಾಗಿ · 15 ನಿಮಿಷದ ಒಳಗೆ","Get ready · duty starts within 15 minutes")}</p>}
      </section>
      {!active&&<section><h2>{tx("ಪ್ರಯಾಣದ ಮುಂಚಿನ ಪರಿಶೀಲನೆ","Pre-trip check")}</h2>
        {trip.checked?<p>{tx("✓ ಪರಿಶೀಲನೆ ಉಳಿಸಲಾಗಿದೆ","✓ Check recorded")}</p>:<div>{Object.entries(checks).map(([key,[kn,en]])=>
          <div key={key} className="driver-row"><strong>{tx(kn,en)}</strong><div>
            <button className="driver-action" type="button" aria-pressed={checksDone[key]===true}
              aria-label={tx(kn,en)+": "+tx("ಸರಿ","OK")} onClick={()=>updateChecks(prev=>({...prev,[key]:true}))}>{icon("✓")}</button>{" "}
            <button className="driver-action driver-danger" type="button" aria-pressed={checksDone[key]===false}
              aria-label={tx(kn,en)+": "+tx("ಸಮಸ್ಯೆ","Not OK")} onClick={()=>updateChecks(prev=>({...prev,[key]:false}))}>{icon("!")}</button></div></div>)}
          <button type="button" className="driver-action" disabled={busy||Object.keys(checksDone).length!==9}
            onClick={()=>void act("check",{results:checksDone})}>{icon("✓")} {tx("ಪರಿಶೀಲನೆ ಉಳಿಸಿ","Send check")}</button></div>}
        <button type="button" className="driver-action" disabled={busy||!trip.checked} onClick={()=>void act("start")}>{icon("▶")} {tx("ಪ್ರಯಾಣ ಆರಂಭಿಸಿ","Start trip")}</button>
      </section>}
      {active&&<>
        {trip.gpsMissing&&<section className="driver-warn" role="status"><strong>{tx("GPS ಕಾಲೇಜ್ OS ಗೆ ತಲುಪುತ್ತಿಲ್ಲ","GPS not reaching College OS")}</strong>
          <ol><li>{tx("Traccar ತೆರೆಯಿರಿ","Open Traccar")}</li><li>{tx("ಸ್ಥಳ ಸೇವೆಯನ್ನು ಆನ್ ಮಾಡಿ","Turn on location")}</li><li>{tx("ಬ್ಯಾಟರಿ ಸೇವರ್ ಆಫ್ ಮಾಡಿ","Turn off battery saver")}</li></ol>
        </section>}
        <section><h2>{tx("ಮುಂದಿನ ನಿಲ್ದಾಣ","Next stop")}</h2>
          {next&&<p>{next.label} · {time(next.scheduled)} · {next.riders} {tx("ಪ್ರಯಾಣಿಕರು","riders")}</p>}
          <p>{trip.boarded===null?tx("ಆಸನಗಳ ಬಳಕೆ ತಿಳಿದಿಲ್ಲ","Seat use unknown"):tx(`ಸುಮಾರು ${trip.boarded}/${trip.seats} ಆಸನಗಳು`,`About ${trip.boarded} of ${trip.seats} seats`)}</p>
          {!locked&&trip.qrCode&&action(tx(showDoor?"QR ಮುಚ್ಚಿ":"ಬೋರ್ಡಿಂಗ್ QR ತೆರೆಯಿರಿ",showDoor?"Close boarding QR":"Open boarding QR"),"▦",()=>door(!showDoor))}
          {!locked&&showDoor&&trip.qrCode&&<BoardingQr code={trip.qrCode} label={tx("ಬೋರ್ಡಿಂಗ್ QR","Boarding QR")}/>}
          {!locked&&<ul>{trip.stops.map((stop,i)=><li key={i}>{stop.passed?"✓":i===trip.stops.indexOf(next??stop)?"➜":"·"} {stop.label} · {time(stop.scheduled)}</li>)}</ul>}
        </section>
        {locked&&<p className="driver-warn">{tx("ನಿಯಂತ್ರಣಗಳು ಲಾಕ್ ಆಗಿವೆ. ಸುರಕ್ಷಿತವಾಗಿ ನಿಲ್ಲಿಸಿ.","Controls locked. Stop safely to use other controls.")}</p>}
        {!locked&&<section><h2>{tx("ತ್ವರಿತ ವರದಿ","Quick reports")}</h2><p>{tx("ತಡದ ಕಾರಣ ಅಥವಾ ಸಮಸ್ಯೆಯನ್ನು ಆರಿಸಿ.","Choose a delay reason or issue.")}</p>
          <label>{tx("ಐಚ್ಛಿಕ ಚಿತ್ರ · ಜನರಿಲ್ಲದೆ","Optional photo · avoid including people")}
            <input type="file" accept="image/*" capture="environment" onChange={e=>void preparePhoto(e.target.files?.[0])}/></label>
          {reportPhoto&&<p>{tx("ಚಿತ್ರ ಸಿದ್ಧವಾಗಿದೆ · ಆನ್‌ಲೈನ್‌ನಲ್ಲಿ ಮಾತ್ರ","Photo ready · online only")} {action(tx("ತೆಗೆದುಹಾಕಿ","Remove"),"×",()=>setReportPhoto(""))}</p>}
          <div className="driver-row">{reports.map(([kind,reason,kn,en])=>
            <div key={kind+reason}>{action(tx(kn,en),"!",()=>void act("report",{kind,reason:reason||undefined,photo:reportPhoto||undefined}))}</div>)}</div>
        </section>}
        <section><h2>{tx("ತುರ್ತು ಸಹಾಯ","SOS")}</h2>
          <button type="button" className="driver-action driver-danger"
            onPointerDown={armSos} onPointerUp={cancelSos} onPointerLeave={cancelSos} onPointerCancel={cancelSos}
            onKeyDown={e=>{if(e.key===" "||e.key==="Enter"){e.preventDefault();armSos();}}}
            onKeyUp={e=>{if(e.key===" "||e.key==="Enter"){e.preventDefault();cancelSos();}}}
            onBlur={cancelSos}>{icon("!")} {tx("SOS ಕಳುಹಿಸಲು 2 ಸೆಕೆಂಡ್ ಹಿಡಿಯಿರಿ","Hold 2 seconds to send SOS")}</button>
          {trip.contact&&<p><a className="driver-action" href={"tel:"+trip.contact}>{icon("☎")} {tx("ಸಾರಿಗೆ ಕಚೇರಿಗೆ ಕರೆ ಮಾಡಿ","Call transport office")}</a></p>}
        </section>
        {trip.messages.length>0&&<section><h2>{tx("ಕಚೇರಿ ಸಂದೇಶಗಳು","Office messages")}</h2>
          {(locked?trip.messages.slice(0,1):trip.messages).map(message=><div key={message.id}>
            <p>{english?message.body_en:message.body_kn}</p>
            <button type="button" className="driver-action" onClick={()=>speak(message)}>{icon("◖")} {tx("ಧ್ವನಿಯಲ್ಲಿ ಓದಿ","Read aloud")}</button>{" "}
            {!locked&&!message.read&&action(tx("ಸರಿ, ಅರ್ಥವಾಯಿತು","OK, understood"),"✓",()=>void act("ack",{message:message.id}))}
          </div>)}
          {voiceUnavailable&&<p role="status">{tx("ಧ್ವನಿ ಲಭ್ಯವಿಲ್ಲ. ಮೇಲಿನ ಸಂದೇಶವನ್ನು ಓದಿ.","Speech is unavailable. The written message is above.")}</p>}
        </section>}
        {!locked&&<section><h2>{tx("ಪ್ರಯಾಣ ಮುಗಿಸಿ","End trip")}</h2><form onSubmit={e=>{
          e.preventDefault();const f=new FormData(e.currentTarget),odo=f.get("odometer");
          void act("end",{odometer:odo?Number(odo):undefined,problems:String(f.get("problems")??"")});
        }}>
          <label>{tx("ಓಡೋಮೀಟರ್ (ಐಚ್ಛಿಕ)","Odometer (optional)")}<input type="number" name="odometer" min={0} max={9999999}/></label>
          <label>{tx("ಯಾವುದೇ ಸಮಸ್ಯೆಗಳಿವೆಯೇ?","Any problems?")}<input name="problems" maxLength={240}/></label>
          <button className="driver-action" disabled={busy}>{icon("■")} {tx("ಪ್ರಯಾಣ ಮುಗಿಸಿ","End trip")}</button></form></section>}
      </>}
    </>}
    {view&&!active&&!locked&&<>
      <section><h2>{tx("ನನ್ನ ದಾಖಲೆಗಳು","My records")}</h2>
        {action(tx(records?"ದಾಖಲೆ ಮುಚ್ಚಿ":"ದಾಖಲೆ ತೆರೆಯಿರಿ",records?"Close records":"Open records"),"▤",()=>void recordsToggle())}
        {records&&<>
          <p>{records.trips.length} {tx("ಪ್ರಯಾಣಗಳು","trips")} · {Math.round(records.trips.reduce((sum,r)=>sum+r.minutes,0)/6)/10} {tx("ಈ ತಿಂಗಳ ಗಂಟೆಗಳು","hours this month")}</p>
          <ul>{records.trips.map((r,i)=><li key={i}>{r.day} · {r.route} · {r.minutes} min</li>)}</ul>
          <ul>{records.reports.map(r=><li key={r.date+r.kind}>{r.kind.replaceAll("_"," ")} · {r.state}</li>)}</ul>
          <ul>{records.documents.map(r=><li key={r.kind}>{r.kind} · {r.expiry}{r.days>=0&&r.days<=30?tx(` · ${r.days} ದಿನಗಳು ಉಳಿದಿವೆ`,` · ${r.days} days remaining`):""}</li>)}</ul>
          <ul>{records.requests.map(r=><li key={r.day+r.kind}>{r.day} · {r.kind} · {r.state}</li>)}</ul>
        </>}
      </section>
      <section><h2>{tx("ರಜೆ ಅಥವಾ ಪಾಳಿ ಬದಲಾವಣೆ","Leave or swap")}</h2><form onSubmit={e=>void leaveForm(e)}>
        <label>{tx("ದಿನಾಂಕ","Date")}<input name="day" type="date" required /></label>
        <label>{tx("ವಿನಂತಿ","Request")}<select name="kind"><option value="leave">{tx("ರಜೆ","Leave")}</option><option value="swap">{tx("ಬದಲಿ ಚಾಲಕರೊಂದಿಗೆ ಬದಲಾವಣೆ","Swap with backup driver")}</option></select></label>
        <button className="driver-action">{icon("➜")} {tx("ಕಚೇರಿಗೆ ಕಳುಹಿಸಿ","Send to office")}</button>
      </form></section>
    </>}
    {view&&!locked&&<button type="button" className="driver-action" disabled={busy}
      onClick={()=>{if(queueTag.current)setPending(queueTag.current,[]);void post({operation:"lock"}).then(refresh);}}>
      {icon("▣")} {tx("ಫೋನ್ ಲಾಕ್ ಮಾಡಿ","Lock this phone")}
    </button>}
  </main>;
}
