import {headers} from "next/headers";
import {NextResponse} from "next/server";
import {z} from "zod";
import {auth} from "../../../../../lib/auth";
import {db} from "../../../../../lib/db";
import {transportMemberSql} from "../../../../../lib/transport/catalog";

const args=z.object({institution:z.uuid(),incident:z.uuid()});
export async function GET(r:Request){
  const i=args.safeParse(Object.fromEntries(new URL(r.url).searchParams));
  const secure={"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"};
  if(!i.success)return new NextResponse(null,{status:404,headers:secure});
  const session=await auth.api.getSession({headers:await headers()});
  if(!session)return new NextResponse(null,{status:404,headers:secure});
  const {rows:[photo]}=await db.query<{jpeg:Buffer}>(`SELECT jpeg FROM transport_driver_report_photo
    WHERE institution_id=$1 AND disruption_id=$2 AND EXISTS (${transportMemberSql("$3","'transport'")})`,
    [i.data.institution,i.data.incident,session.user.id]);
  if(!photo)return new NextResponse(null,{status:404,headers:secure});
  return new NextResponse(Uint8Array.from(photo.jpeg),{headers:{...secure,"Content-Type":"image/jpeg","Content-Disposition":"inline"}});
}
