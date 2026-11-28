"use client";
import {useEffect} from "react";
export function OfficeWarningPoll({institution}:{institution:string}){
  useEffect(()=>{
    let timer:number|undefined,disposed=false,abort:AbortController|undefined;
    const stop=()=>{if(timer!==undefined)window.clearTimeout(timer);abort?.abort();};
    const poll=async()=>{
      if(disposed||document.visibilityState!=="visible")return;
      abort=new AbortController();
      try{await fetch(`/api/transport/office-alerts?institution=${encodeURIComponent(institution)}`,{method:"POST",signal:abort.signal,cache:"no-store"});}
      catch{/* Existing notices remain readable even when the signal fails. */}
      if(!disposed&&document.visibilityState==="visible")timer=window.setTimeout(poll,30000);
    };
    const visible=()=>{stop();void poll();};
    document.addEventListener("visibilitychange",visible);
    void poll();return ()=>{disposed=true;stop();document.removeEventListener("visibilitychange",visible);};
  },[institution]);
  return null;
}
