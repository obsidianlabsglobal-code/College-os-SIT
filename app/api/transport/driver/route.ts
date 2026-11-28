import {NextRequest,NextResponse} from "next/server";
import {z} from "zod";
import {driverToday,applyDriverCommand} from "../../../../lib/transport/driver-workspace";
import {driverOwnRecords,requestDriverLeave} from "../../../../lib/transport/driver-office";
import {db} from "../../../../lib/db";
import {enrollDriverPhone,unlockDriverPhone,resolveDriverPhone} from "../../../../lib/transport/driver-phone";

const phone="nexus_driver_phone",session="nexus_driver_session";
const headers={"Cache-Control":"private, no-store"};
const answer=(x:unknown,status=200)=>NextResponse.json(x,{status,headers});
const enabled=()=> process.env.NEXUS_TRANSPORT_SIMULATION_ENABLED==="true"||process.env.NEXUS_TRANSPORT_LIVE_ENABLED==="true";
const local=(r:NextRequest)=>process.env.NEXUS_TRANSPORT_LOCAL_TEST==="1"&&["127.0.0.1","localhost"].includes(r.nextUrl.hostname);
function sameOrigin(r:NextRequest){
  const raw=r.headers.get("origin");
  if(!raw||!URL.canParse(raw))return false;
  const origin=new URL(raw);
  return (origin.host===r.headers.get("host")||origin.origin===r.nextUrl.origin)
    && (origin.protocol==="https:"||(local(r)&&["127.0.0.1","localhost"].includes(origin.hostname)));
}
async function readBounded(r:NextRequest){
  const reader=r.body?.getReader();if(!reader)throw Error("Missing JSON");
  const chunks:Uint8Array[]=[];
  let length=0;
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      length+=value.byteLength;
      if(length>150_000){await reader.cancel();throw Error("Input exceeds limit");}
      chunks.push(value);
    }
  }finally{reader.releaseLock();}
  return {raw:JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string,unknown>,length};
}
const cookie=(r:NextRequest,maxAge:number)=>({httpOnly:true,sameSite:"strict" as const,secure:!local(r),path:"/api/transport/driver",maxAge});
export async function GET(r:NextRequest){
  if(!enabled())return answer(null,404);
  if(r.nextUrl.protocol!=="https:"&&!local(r))return answer(null,403);
  const view=await driverToday(r.cookies.get(phone)?.value,r.cookies.get(session)?.value);
  if(!view)return answer({enrolled:r.cookies.has(phone)},401);
  if(r.nextUrl.searchParams.get("records")==="1"){
    if(view.inUse||view.trip?.state==="active") return answer(null,409);
    const b=await resolveDriverPhone(db,r.cookies.get(phone)?.value,r.cookies.get(session)?.value);
    return b?answer(await driverOwnRecords(b.institution_id,b.vehicle_id,b.session_driver)):answer(null,401);
  }
  return answer(view);
}
export async function POST(r:NextRequest){
  if(!enabled())return answer(null,404);
  if(!sameOrigin(r))return answer(null,403);
  if(!r.headers.get("content-type")?.startsWith("application/json"))return answer(null,415);
  const claimedLength=Number(r.headers.get("content-length")??0);
  if(!Number.isFinite(claimedLength)||claimedLength>150_000)return answer(null,413);
  const p=r.cookies.get(phone)?.value,s=r.cookies.get(session)?.value;
  try{
    const {raw,length}=await readBounded(r);
    const i=z.object({operation:z.string()}).parse(raw);
    if(length>3072&&i.operation!=="report")return answer(null,413);
    if(i.operation==="enroll"){
      const bound=await enrollDriverPhone(raw.code);
      if(!bound)return answer(null,403);
      const out=answer({enrolled:true});
      out.cookies.set(phone,bound,cookie(r,90*86400));out.cookies.set(session,"",cookie(r,0));return out;
    }
    if(i.operation==="unlock"){
      const unlocked=await unlockDriverPhone(p,raw.pin);
      if(!unlocked)return answer(null,403);
      const out=answer({unlocked:true});out.cookies.set(session,unlocked,cookie(r,12*3600));return out;
    }
    if(i.operation==="lock"){
      const out=answer({locked:true});out.cookies.set(session,"",cookie(r,0));return out;
    }
    if(!p||!s)return answer(null,401);
    if(i.operation==="leave")return answer(await requestDriverLeave(p,s,raw));
    return answer(await applyDriverCommand(p,s,raw));
  }catch{return answer(null,409);}
}
