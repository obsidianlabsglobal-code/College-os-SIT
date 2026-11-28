import type {MetadataRoute} from "next";
export const dynamic="force-static";
export function GET(){
  const manifest:MetadataRoute.Manifest={
    name:"NEXUS Driver",short_name:"NEXUS Driver",id:"/driver",start_url:"/driver",scope:"/driver",
    lang:"kn-IN",display:"standalone",background_color:"#edf4ee",theme_color:"#073d2f",
    icons:[192,512].map(n=>({src:`/driver-assets/icon-${n}.png`,sizes:`${n}x${n}`,type:"image/png",purpose:"any"})),
  };
  return Response.json(manifest,{headers:{"content-type":"application/manifest+json"}});
}
