"use client";
import {useEffect,useState} from "react";
import {BoardingQr} from "./qr";
type Data={vehicle:string;simulated:boolean;code:string|null;canReport:boolean};
const reports=[
 ["puncture","Flat tyre"],["breakdown","Breakdown"],["road_block","Road blocked"],
 ["accident_no_injuries","Accident, no injury reported"],["accident_injury","Accident with injury"],
 ["heavy_traffic","Heavy traffic"],["weather_flooding","Weather or flooding"],["fuel","Fuel issue"],
 ["driver_delayed","Departure delayed"],["route_diverted","Route diverted"],["trip_cancelled","Trip cancelled"]
];
export function BoardScreen(){
  const [text,setText]=useState(""),[key,setKey]=useState(""),[data,setData]=useState<Data|null>(null),[status,setStatus]=useState(""),[report,setReport]=useState(""),[sending,setSending]=useState(false);
  useEffect(()=>{
    if(!key)return;
    let disposed=false, timer:number|undefined, controller:AbortController|undefined;
    const poll=async()=>{
      if(disposed||document.visibilityState!=="visible")return;
      controller=new AbortController();
      try{
        const r=await fetch("/api/transport/boarding",{headers:{Authorization:`Bearer ${key}`},cache:"no-store",signal:controller.signal});
        if(disposed)return;
        if(!r.ok){setData(null);setStatus(r.status===401?"Device credential unavailable or revoked.":"Boarding connection unavailable.");}
        else{setData(await r.json() as Data);setStatus("");}
      }catch(e){if(!disposed&&!(e instanceof DOMException&&e.name==="AbortError")){setData(null);setStatus("No connection.");}}
      if(!disposed&&document.visibilityState==="visible")timer=window.setTimeout(poll,7000);
    };
    const visibility=()=>{
      if(timer!==undefined)window.clearTimeout(timer);controller?.abort();
      if(document.visibilityState==="visible")void poll();
    };
    document.addEventListener("visibilitychange",visibility);
    void poll();
    return ()=>{disposed=true;if(timer!==undefined)window.clearTimeout(timer);controller?.abort();document.removeEventListener("visibilitychange",visibility);};
  },[key]);
  const publish=async(kind:string)=>{
    setSending(true);
    try{
      const r=await fetch("/api/transport/boarding",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},
        body:JSON.stringify({kind})});
      setReport(r.ok?"Report recorded for the transport office.":"Not sent. The bus must be confirmed stopped; contact the transport office if needed.");
    }catch{setReport("Not sent. No connection.");}finally{setSending(false);}
  };
  return <div className="stack">
    {!key && <form className="form" onSubmit={e=>{e.preventDefault();setKey(text.trim());setText("");}}>
      <label>Boarding device credential<input type="password" autoComplete="off" value={text} required pattern="[A-Za-z0-9_\-]{43}"
        onChange={e=>setText(e.target.value)} /></label><button className="button">Connect this screen</button>
    </form>}
    {key && <button className="button secondary" onClick={()=>{setKey("");setData(null);setStatus("");}}>Disconnect screen</button>}
    <p role="status">{status||(!data&&key?"Checking device…":data?.vehicle??"")}</p>
    {data?.simulated&&<p><strong>Simulated</strong> · Fictional boarding display</p>}
    {data?.code && <section className="stack" aria-label="Parked driver incident controls">
      <h2>Report a disruption when parked</h2>
      {!data.canReport&&<p>Controls are off until the bus is confirmed stopped.</p>}
      <div className="row" style={{flexWrap:"wrap"}}>{reports.map(([kind,label])=><button type="button" key={kind}
        disabled={!data.canReport||sending} className="button secondary" onClick={()=>void publish(kind)}>{label}</button>)}</div>
      {report&&<p role="status">{report}</p>}
    </section>}
    {data&&(data.code?<><BoardingQr code={data.code} label="Scan this trip’s boarding QR"/><p>Scan using the Transport page.</p></>:<p>No active trip. This screen will update automatically.</p>)}
  </div>;
}
