"use client";
import {useEffect,useState} from "react";
export function BackupSignal({institution,trip,ready}:{institution:string;trip:string;ready:boolean}){
  const [sharing,setSharing]=useState(false),[status,setStatus]=useState("");
  useEffect(()=>{
    if(!ready||!sharing)return;
    let watch:number|undefined,last=0,dead=false;
    const stop=()=>{if(watch!==undefined){navigator.geolocation.clearWatch(watch);watch=undefined;}};
    const start=()=>{
      stop();if(document.visibilityState!=="visible"||dead)return;
      if(!navigator.geolocation){setStatus("This browser cannot share a backup fix.");return;}
      watch=navigator.geolocation.watchPosition(async p=>{
        if(dead||document.visibilityState!=="visible"||Date.now()-last<15000)return;
        last=Date.now();
        try{
          const r=await fetch(`/api/transport/backup?institution=${encodeURIComponent(institution)}`,{
            method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({trip,
              lat:p.coords.latitude,lon:p.coords.longitude,accuracy:p.coords.accuracy}),cache:"no-store"});
          if(dead)return;
          const d=r.ok ? await r.json() as {result?:string} : null;
          if(d?.result==="bus-signal-available"){setStatus("The bus signal returned. Sharing stopped.");setSharing(false);}
          else setStatus(d?.result==="saved"?"Backup position received.":d?.result==="rate-limited"?"Waiting for the next permitted backup fix.":"Backup position not accepted.");
        }catch{if(!dead)setStatus("No connection. No backup sent.");}
      },()=>{if(!dead)setStatus("Phone location unavailable.");},{enableHighAccuracy:false,maximumAge:5000,timeout:12000});
    };
    document.addEventListener("visibilitychange",start);start();
    return ()=>{dead=true;stop();document.removeEventListener("visibilitychange",start);};
  },[institution,trip,ready,sharing]);
  return <div className="stack">
    {ready?<button type="button" className="button secondary" onClick={()=>{setSharing(!sharing);setStatus("");}}>
      {sharing?"Stop sharing phone location":"Start sharing a backup position"}
    </button>:<p className="meta">No backup is needed while the bus signal is available.</p>}
    {status&&<p role="status">{status}</p>}
  </div>;
}
