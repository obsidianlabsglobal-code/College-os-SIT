"use client";
import {useEffect,useRef,useState} from "react";
type Detector=new (settings:{formats:string[]})=>{detect(video:HTMLVideoElement):Promise<{rawValue:string}[]>};
export function BoardingInput(){
  const [code,setCode]=useState(""),[status,setStatus]=useState(""),[camera,setCamera]=useState(false);
  const ref=useRef<HTMLVideoElement>(null);
  useEffect(()=>{
    if(!camera)return;
    const Type=(globalThis as typeof globalThis & {BarcodeDetector?:Detector}).BarcodeDetector;
    let stream:MediaStream|undefined,timer:number|undefined,dead=false;
    const release=()=>{stream?.getTracks().forEach(t=>t.stop());if(timer!==undefined)window.clearTimeout(timer);};
    const work=async()=>{
      if(!Type||!ref.current||!navigator.mediaDevices){setStatus("This browser has no built-in QR scanner. Use your phone’s camera and paste the code.");setCamera(false);return;}
      try{
        const detector=new Type({formats:["qr_code"]});
        stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}},audio:false});
        if(dead){release();return;}
        const video=ref.current!;video.srcObject=stream;await video.play();
        const scan=async()=>{
          if(dead)return;
          try{
            const found=(await detector.detect(video)).find(x=>/^(?:s1|b1)\./.test(x.rawValue));
            if(found&&!dead){setCode(found.rawValue);setStatus("Code read. Confirm your boarding below.");setCamera(false);return;}
          }catch{/* The next frame may be ready. */}
          if(!dead)timer=window.setTimeout(scan,350);
        };
        void scan();
      }catch{if(!dead){setStatus("Camera unavailable. Paste the boarding code instead.");setCamera(false);}}
    };
    void work();
    return ()=>{dead=true;release();};
  },[camera]);
  return <>
    <label>Boarding code<input name="boardingCode" maxLength={160} autoComplete="off" value={code} onChange={e=>setCode(e.target.value)} required/></label>
    <button type="button" className="button secondary" onClick={()=>{setStatus("");setCamera(!camera);}}>{camera?"Turn camera off":"Scan bus QR"}</button>
    {camera&&<video ref={ref} muted playsInline aria-label="QR scanner camera" style={{maxWidth:"100%",display:"block"}}/>}
    {status&&<p role="status">{status}</p>}
  </>;
}
