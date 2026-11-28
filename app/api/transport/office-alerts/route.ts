import {NextResponse} from "next/server";
import {scope} from "../../../../lib/scope";
import {sweepTransportPromises} from "../../../../lib/transport/disruption-warnings";
export async function POST(req:Request){
  const url=new URL(req.url);
  if(req.headers.get("origin")!==url.origin)return new NextResponse(null,{status:403});
  const s=await scope(url.searchParams.get("institution"),"transport");
  await sweepTransportPromises(s);
  return new NextResponse(null,{status:204,headers:{"Cache-Control":"private, no-store"}});
}
