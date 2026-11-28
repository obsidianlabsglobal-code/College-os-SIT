import qrcodegen from "../../../lib/transport/vendor/qrcodegen";
export function BoardingQr({code,label}:{code:string;label:string}){
  const qr=qrcodegen.QrCode.encodeText(code,qrcodegen.QrCode.Ecc.MEDIUM);
  const marks:string[]=[];
  for(let y=0;y<qr.size;y++)for(let x=0;x<qr.size;x++)if(qr.getModule(x,y))marks.push(`M${x} ${y}h1v1h-1z`);
  const span=qr.size+8;
  return <svg aria-label={label} role="img" viewBox={`-4 -4 ${span} ${span}`}
    style={{width:"100%",maxWidth:"360px",height:"auto",display:"block"}} shapeRendering="crispEdges">
    <rect x="-4" y="-4" width={span} height={span} fill="#fff"/><path fill="#000" d={marks.join("")}/>
  </svg>;
}
