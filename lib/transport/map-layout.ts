const unit=256;
type Coordinate={lat:number;lon:number};
function world(p:Coordinate,z:number):[number,number]{
  const n=(2**z)*unit, y=Math.tan(Math.min(85.05112878,Math.max(-85.05112878,p.lat))*Math.PI/180);
  return [(p.lon+180)/360*n,(1-Math.asinh(y)/Math.PI)*n/2];
}
export const mapWidth=320,mapHeight=240;
export function transportMapLayout(points:Coordinate[]){
  if(!points.length)return null;
  let z=17,xy: [number,number][]=[];
  const limits=()=>{
    xy=points.map(p=>world(p,z));
    const x=xy.map(p=>p[0]),y=xy.map(p=>p[1]);
    return [Math.min(...x),Math.max(...x),Math.min(...y),Math.max(...y)];
  };
  let [xmin,xmax,ymin,ymax]=limits();
  while(z>2&&(xmax-xmin>mapWidth-56||ymax-ymin>mapHeight-56)){z--;[xmin,xmax,ymin,ymax]=limits();}
  const left=(xmin+xmax-mapWidth)/2,top=(ymin+ymax-mapHeight)/2;
  const trans=(p:Coordinate)=>{const [x,y]=world(p,z);return [x-left,y-top] as const;};
  const tiles:{x:number;y:number;z:number;left:number;top:number}[]=[];
  const xmaxTile=Math.floor((left+mapWidth-1)/unit),ymaxTile=Math.floor((top+mapHeight-1)/unit);
  for(let x=Math.floor(left/unit);x<=xmaxTile;x++)for(let y=Math.floor(top/unit);y<=ymaxTile;y++){
    if(y<0||y>=2**z)continue;
    tiles.push({x:(x+2**z)%(2**z),y,z,left:x*unit-left,top:y*unit-top});
  }
  return {trans,tiles};
}
