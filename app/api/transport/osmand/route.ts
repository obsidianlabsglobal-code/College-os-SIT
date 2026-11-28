import { NextResponse } from "next/server";
import { decodeOsmAnd } from "../../../../lib/transport/osmand";
import { acceptOsmAnd,acceptStockOsmAnd } from "../../../../lib/transport/telemetry";

const respond=(status:number)=>new NextResponse(null,{status,headers:{"Cache-Control":"no-store"}});
async function ingest(req:Request) {
  if(process.env.NEXUS_TRANSPORT_LIVE_ENABLED!=="true")return respond(404);
  const url=new URL(req.url);
  if(url.protocol!=="https:" && !(process.env.NEXUS_TRANSPORT_LOCAL_TEST==="1" && ["localhost","127.0.0.1"].includes(url.hostname)))return respond(403);
  // The documented stock upload puts the editable ID in a form body. An issued, high-entropy stock
  // ID may be used there as a credential; never accept a secret ID from a URL or mix auth methods.
  const header=req.headers.get("authorization");
  const auth=header?.match(/^Bearer ([A-Za-z0-9_-]{43})$/);
  const stock=!header&&req.method==="POST"&&!url.search&&Boolean(req.body);
  if(!auth&&!stock)return respond(401);
  if(url.search.length>4096)return respond(413);
  const p=new URLSearchParams(url.search);
  if(req.method==="POST" && req.body){
    if(!req.headers.get("content-type")?.toLowerCase().startsWith("application/x-www-form-urlencoded"))return respond(415);
    const reader=req.body.getReader();
    const dec=new TextDecoder("utf-8",{fatal:true});
    let body="",total=0;
    try {
      for(;;){
        const part=await reader.read();if(part.done)break;
        total+=part.value.byteLength;
        if(total>4096){void reader.cancel().catch(()=>undefined);return respond(413);}
        body+=dec.decode(part.value,{stream:true});
      }
      body+=dec.decode();
      for(const [k,v] of new URLSearchParams(body))p.append(k,v);
    }catch{return respond(400);}
  }
  let report;
  try{report=decodeOsmAnd(p);}catch{return respond(400);}
  try {
    const result=auth?await acceptOsmAnd(auth[1],report.deviceId,report.fix):await acceptStockOsmAnd(report.deviceId,report.fix);
    switch(result){
      case "unauthorized":return respond(401);
      case "rate-limited":return new NextResponse(null,{status:429,headers:{"Retry-After":"60","Cache-Control":"no-store"}});
      case "invalid-time":case "no-trip":case "duplicate-or-old":case "quarantined":case "accepted":
        // Ack harmless reports so the phone does not retry and overload its local queue.
        return respond(200);
    }
  }catch{return respond(503);}
}
export const GET=ingest;
export const POST=ingest;
