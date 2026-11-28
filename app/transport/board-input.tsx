"use client";
import {useEffect,useRef,useState} from "react";
type NativeDetector={
  new (settings:{formats:string[]}):{detect(video:HTMLVideoElement):Promise<{rawValue:string}[]>};
  getSupportedFormats?:()=>Promise<string[]>;
};
const valid=(code:string)=>/^(?:b1\.[A-Za-z0-9_-]{43}|s1\.[0-9a-f-]{36}\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43})$/.test(code);
function softwareScanner(){
  const canvas=document.createElement("canvas");
  const ctx=canvas.getContext("2d",{willReadFrequently:true});
  let decode:Promise<typeof import("../../lib/transport/vendor/jsqr.cjs").default>|undefined;
  return async(video:HTMLVideoElement)=>{
    if(!ctx||!video.videoWidth||!video.videoHeight)return null;
    const scale=Math.min(1,720/Math.max(video.videoWidth,video.videoHeight));
    const w=Math.round(video.videoWidth*scale),h=Math.round(video.videoHeight*scale);
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
    // Nothing leaves this device: only the decoded text reaches the existing authenticated form.
    decode??=import("../../lib/transport/vendor/jsqr.cjs").then(x=>x.default);
    const qr=await decode;
    ctx.drawImage(video,0,0,w,h);
    return qr(ctx.getImageData(0,0,w,h).data,w,h,{inversionAttempts:"dontInvert"})?.data??null;
  };
}
export function BoardingInput(){
  const [code,setCode]=useState(""),[status,setStatus]=useState(""),[camera,setCamera]=useState(false);
  const ref=useRef<HTMLVideoElement>(null);
  useEffect(()=>{
    if(!camera)return;
    const Type=(globalThis as typeof globalThis & {BarcodeDetector?:NativeDetector}).BarcodeDetector;
    let stream:MediaStream|undefined,timer:number|undefined,dead=false;
    const release=()=>{stream?.getTracks().forEach(t=>t.stop());if(timer!==undefined)window.clearTimeout(timer);};
    const close=()=>{setCamera(false);release();};
    const work=async()=>{
      try {
        if(!ref.current||!navigator.mediaDevices)throw new Error("Camera unavailable");
        let detector:InstanceType<NativeDetector>|undefined;
        try{if(Type&&(!Type.getSupportedFormats||(await Type.getSupportedFormats()).includes("qr_code")))detector=new Type({formats:["qr_code"]});}catch{/* use JS */}
        if(dead)return;
        stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"},width:{ideal:960},height:{ideal:720}},audio:false});
        if(dead){release();return;}
        const video=ref.current!;video.srcObject=stream;await video.play();
        const software=softwareScanner();
        const scan=async()=>{
          if(dead)return;
          let found:string|null=null;
          try {
            if(detector){
              try{found=(await detector.detect(video)).map(x=>x.rawValue).find(valid)??null;}
              catch{if(video.readyState>=2)detector=undefined;}
            }
            if(!detector&&!dead)found=await software(video);
          }catch{if(!dead){setStatus("Scanner unavailable. Enter the boarding code instead.");close();}return;}
          if(found&&valid(found)&&!dead){setCode(found);setStatus("Code read. Confirm your boarding below.");close();return;}
          if(!dead)timer=window.setTimeout(scan,350);
        };
        void scan();
      }catch{if(!dead){setStatus("Camera unavailable. Enter the boarding code instead.");close();}}
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
