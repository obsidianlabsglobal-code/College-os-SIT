"use client";
import {BackupSignal} from "./backup";
import {transportMapLayout} from "../../lib/transport/map-layout";
import {useEffect,useState} from "react";
import type {StudentTimeline} from "../../lib/transport/student-timeline";
const fmt=new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Kolkata",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
const time=(v:string)=>fmt.format(new Date(v));

function Schematic({data,tiles}:{data:StudentTimeline;tiles:string|null}){
  const layout=tiles?transportMapLayout(data.timeline):null;
  const lats=data.timeline.map(t=>t.lat),lons=data.timeline.map(t=>t.lon);
  const minLa=Math.min(...lats),maxLa=Math.max(...lats),minLo=Math.min(...lons),maxLo=Math.max(...lons);
  const pt=(p:{lat:number;lon:number})=>layout?.trans(p)??[32+(p.lon-minLo)/Math.max(.001,maxLo-minLo)*256,206-(p.lat-minLa)/Math.max(.001,maxLa-minLa)*172];
  const path=data.timeline.map(p=>pt(p).join(",")).join(" ");
  const bus=data.position?pt(data.position):null;
  return <div className="stack">
    <p>{layout?"Bus route map. Use official instructions for changes.":"Route schematic, not street navigation."}</p>
    <div style={{width:"100%",maxWidth:"320px",overflow:"hidden",borderRadius:"20px",aspectRatio:"4 / 3",position:"relative",background:"#eee9fc"}}>
      {layout && tiles && layout.tiles.map(t=>{
        const src=tiles.replace("{z}",String(t.z)).replace("{x}",String(t.x)).replace("{y}",String(t.y));
        // Tiles are public imagery; no tenant, student or device identifiers go in the referrer or URL.
        // eslint-disable-next-line @next/next/no-img-element
        return <img key={src} src={src} alt="" referrerPolicy="origin" width={256} height={256}
          style={{position:"absolute",left:`${t.left/320*100}%`,top:`${t.top/240*100}%`,width:"80%",height:"auto",maxWidth:"none"}}/>;
      })}
      <svg role="img" aria-label={data.next?`Bus before ${data.next.name}`:"Ordered route stops"} viewBox="0 0 320 240"
        style={{width:"100%",height:"100%",position:"relative",display:"block"}}>
        <polyline points={path} fill="none" stroke="#6547b5" strokeWidth="5" strokeLinejoin="round"/>
        {data.timeline.map((p,i)=>{const [x,y]=pt(p);return <g key={p.id}><title>{p.label}</title><circle cx={x} cy={y} r="10" fill={p.pickup?"#20212b":"#6547b5"}/>
          <text x={x} y={y+4} fontSize="9" textAnchor="middle" fill="white">{i+1}</text></g>;})}
        {bus && <circle cx={bus[0]} cy={bus[1]} r="8" fill="#00836e" stroke="white" strokeWidth="2"/>}
      </svg>
    </div>
    {layout && <p className="meta"><a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a></p>}
    <ol className="items">{data.timeline.map(t=><li key={t.id}>{t.label}{t.pickup?" · Your pickup":""}</li>)}</ol>
  </div>;
}
export function BusTimeline({initial,institution,tiles,backupOpted}:{initial:StudentTimeline;institution:string;tiles:string|null;backupOpted:boolean}){
  const [data,setData]=useState<StudentTimeline|null>(initial);
  const [tab,setTab]=useState<"stops"|"map">("stops");
  const [offline,setOffline]=useState(false);
  useEffect(()=>{
    let timer:number|undefined, controller:AbortController|undefined, ended=false, disposed=false, wait=15000;
    const clear=()=>{if(timer!==undefined)window.clearTimeout(timer);timer=undefined;controller?.abort();};
    const poll=async()=>{
      if(disposed||ended||document.visibilityState!=="visible")return;
      controller=new AbortController();
      try{
        const r=await fetch(`/api/transport/timeline?institution=${encodeURIComponent(institution)}`,{cache:"no-store",signal:controller.signal});
        if(!r.ok||!r.headers.get("content-type")?.includes("application/json"))throw Error("Unavailable");
        const payload=await r.json() as StudentTimeline|null;
        if(disposed)return;
        setData(payload);setOffline(false);wait=15000;ended=payload===null;
      }catch(e){
        if(disposed || e instanceof DOMException && e.name==="AbortError")return;
        setOffline(true);wait=Math.min(60_000,wait*2);
      }
      if(!disposed&&!ended&&document.visibilityState==="visible")timer=window.setTimeout(poll,wait);
    };
    const visibility=()=>{clear();if(document.visibilityState==="visible")void poll();};
    document.addEventListener("visibilitychange",visibility);
    if(document.visibilityState==="visible")timer=window.setTimeout(poll,15000);
    return ()=>{disposed=true;clear();document.removeEventListener("visibilitychange",visibility);};
  },[institution,initial.trip]);
  if(!data)return <p className="panel">Your trip ended or is no longer available. Refresh to check another trip.</p>;
  const signal=offline?"No connection":data.usedBackup?"Approximate rider backup · bus signal unavailable":data.state==="no-signal"?"No signal":data.state==="recent"?"Recently updated":data.mode==="simulated"?"Simulated signal":"Live signal";
  return <section className="panel stack" aria-label="Active bus trip">
    <h2>{data.vehicle} · {data.route}</h2>
    {data.mode==="simulated" && <p><strong>Simulated</strong> · Fictional trip, not real bus tracking.</p>}
    <p>{data.boarded&&data.seats?(data.boarded>data.seats?`About ${data.boarded} riders checked in; ${data.seats} seats.`:`About ${data.boarded} of ${data.seats} seats taken, based on boarding check-ins.`):"Seat count is unknown."}</p>
    <p role="status"><strong>{signal}</strong>{data.observedAt?` · Last updated ${time(data.observedAt)} IST`:" · Waiting for a position"}</p>
    {backupOpted&&<BackupSignal institution={institution} trip={data.trip} ready={!offline&&(data.state==="no-signal"||data.usedBackup)}/>}
    {data.next&&!offline && <p>{data.next.km.toFixed(1)} km to {data.next.name}</p>}
    {data.closeToPickup&&!offline ? <p className="tag"><strong>Your bus is estimated about 5 minutes away.</strong></p> :
      data.alertedAt && <p className="meta">Pickup proximity alert issued at {time(data.alertedAt)} IST. Check the current signal above.</p>}
    <div className="row" aria-label="Route view">
      <button type="button" className="button secondary" aria-pressed={tab==="stops"} onClick={()=>setTab("stops")}>Stops</button>
      <button type="button" className="button secondary" aria-pressed={tab==="map"} onClick={()=>setTab("map")}>Map</button>
    </div>
    {tab==="map" ? <Schematic data={offline?{...data,position:null,next:null}:data} tiles={offline||data.mode==="simulated"?null:tiles}/> :
      <ol className="items" style={{borderInlineStart:"3px solid #8061cb",paddingInlineStart:"1rem"}}>
        {data.timeline.map((t,index)=><li key={t.id}>
          {data.next&&!offline && data.timeline[index+1]?.label===data.next.name && <p className="meta">Bus between this stop and {data.next.name}</p>}
          <p><strong>{t.label}</strong>{t.pickup?" · Your pickup":""}{t.passed?" · Passed":""}</p>
          <p>Scheduled {time(t.scheduled)} IST · {t.expected&&!offline?`Expected ${time(t.expected)} IST`:"No current estimate"}</p>
          {t.delay!==null&&t.delay>0&&!offline&&<p style={{color:"#a3272c"}}>Delayed by about {t.delay} min</p>}
        </li>)}
      </ol>}
  </section>;
}
