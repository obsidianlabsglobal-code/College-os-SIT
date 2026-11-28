import {distanceMeters,type Observation} from "./osmand";
export function differenceInMotion(previous:{latitude:number;longitude:number;observed_at:Date;accuracy_m:number|null}|undefined,fix:Observation,epoch:number){
  if(!previous)return (fix.speedKmh??0)>150;
  const d=distanceMeters(previous.latitude,previous.longitude,fix.lat,fix.lon);
  const uncertainty=Math.min(250,previous.accuracy_m??30)+Math.min(250,fix.accuracy??30);
  return (fix.speedKmh??0)>150 || Math.max(0,d-uncertainty)/(epoch-previous.observed_at.getTime())*3600>150;
}
