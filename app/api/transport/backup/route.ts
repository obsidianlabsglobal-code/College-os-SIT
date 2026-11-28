import {NextResponse} from "next/server";
import {scope} from "../../../../lib/scope";
import {submitBackupFix} from "../../../../lib/transport/rider-backup";
const response=(status:number)=>new NextResponse(null,{status,headers:{"Cache-Control":"private, no-store"}});
export async function POST(req:Request){
  if(process.env.NEXUS_TRANSPORT_RIDER_BACKUP_ENABLED!=="true")return response(404);
  const url=new URL(req.url);
  if(req.headers.get("origin")!==url.origin || !req.headers.get("content-type")?.startsWith("application/json"))return response(403);
  const size=Number(req.headers.get("content-length")??0);
  if(!Number.isFinite(size)||size<1||size>1024)return response(413);
  const institution=url.searchParams.get("institution");
  const actor=await scope(institution,"student");
  try{
    const result=await submitBackupFix(actor,await req.json());
    return NextResponse.json({result},{headers:{"Cache-Control":"private, no-store"}});
  }catch{return response(400);}
}
