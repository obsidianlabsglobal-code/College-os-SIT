import {NextResponse} from "next/server";
import {z} from "zod";
import {boardDisplay} from "../../../../lib/transport/boarding";
import {boardDriverContext} from "../../../../lib/transport/driver-disruptions";
import {changeDisruption} from "../../../../lib/transport/disruptions";
import {disruptionKinds} from "../../../../lib/transport/disruption-copy";

const headers={"Cache-Control":"private, no-store"};
const status=(code:number)=>new NextResponse(null,{status:code,headers});
function authorized(req:Request){
  const url=new URL(req.url);
  if(url.protocol!=="https:" && !(process.env.NEXUS_TRANSPORT_LOCAL_TEST==="1" && ["localhost","127.0.0.1"].includes(url.hostname)))return null;
  return req.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1]??null;
}
const enabled=()=>process.env.NEXUS_TRANSPORT_SIMULATION_ENABLED==="true"||process.env.NEXUS_TRANSPORT_LIVE_ENABLED==="true";
export async function GET(req:Request){
  if(!enabled())return status(404);
  const key=authorized(req);if(!key)return status(401);
  const data=await boardDisplay(key);
  return data?NextResponse.json({...data,canReport:Boolean(data.code&&await boardDriverContext(key))},{headers}):status(401);
}
export async function POST(req:Request){
  if(!enabled())return status(404);
  const key=authorized(req);if(!key)return status(401);
  const size=Number(req.headers.get("content-length")??0);
  if(!Number.isFinite(size)||size<1||size>256||!req.headers.get("content-type")?.startsWith("application/json"))return status(400);
  try{
    const {kind}=z.object({kind:z.enum(disruptionKinds)}).parse(await req.json());
    const context=await boardDriverContext(key);
    if(!context)return status(409);
    await changeDisruption(context.scope,{operation:"open-disruption",trip:context.trip,stop:context.stop,kind,
      clock:"update",when:new Date(Date.now()+10*60_000).toISOString(),action:"await_staff"},key);
    return status(204);
  }catch{return status(409);}
}
