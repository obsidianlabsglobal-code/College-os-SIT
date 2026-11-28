import {NextResponse} from "next/server";
import {scope} from "../../../../lib/scope";
import {studentTimeline} from "../../../../lib/transport/student-timeline";
export async function GET(req:Request){
  const institution=new URL(req.url).searchParams.get("institution");
  const s=await scope(institution,"student");
  return NextResponse.json(await studentTimeline(s),{headers:{"Cache-Control":"private, no-store"}});
}
