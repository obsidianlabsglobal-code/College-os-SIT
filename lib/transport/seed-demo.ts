// Dedicated-fixture loader. Expected after the baseline fictional seed in a disposable local database.
import "../../scripts/environment";
import {Pool} from "pg";
import {db} from "../db";
import {fixtures as f,demoEmail} from "../../scripts/fixtures";
import {changeTransportCatalog,transportCatalog} from "./catalog";
import {changeTransportTrip} from "./trips";
import {fictionalTransportRoutes,fictionalRiderChoices} from "./demo-fixtures";

const dept="97000000-0000-4000-8000-000000000001",course="97000000-0000-4000-8000-000000000002";
const section="97000000-0000-4000-8000-000000000003",offering="97000000-0000-4000-8000-000000000004";
const drivers=fictionalTransportRoutes.flatMap(r=>r.driver?[r.driver]:[]);
const fixtureName="Electrical and Electronics Engineering (Fictional Transport)";
async function main(){
  const migration=process.env.MIGRATION_DATABASE_URL,runtime=process.env.DATABASE_URL;
  if(process.env.NEXUS_TRANSPORT_DEMO_SEED!=="1" || !migration || !runtime ||
    [migration,runtime].some(x=>!["127.0.0.1","localhost"].includes(new URL(x).hostname)) ||
    process.env.NEXUS_TRANSPORT_LIVE_ENABLED==="true")
    throw Error("Use an isolated loopback-only fictional database with NEXUS_TRANSPORT_DEMO_SEED=1; live transport must be off.");
  const p=new Pool({connectionString:migration});
  try{
    const owner=await p.connect();
    let baseRider:string,account:string;
    try{
      const checked=await owner.query<{id:string;name:string}>("SELECT id,name FROM institution");
      if(checked.rows.length!==2 || !checked.rows.every(i=>[f.institution,f.otherInstitution].includes(i.id)&&/Fictional demo/.test(i.name)))
        throw Error("Load the isolated baseline fictional seed first.");
      const users=(await owner.query<{id:string;email:string}>('SELECT id,email FROM "user" WHERE email=ANY($1)',[[demoEmail("student"),demoEmail("replacement")]])).rows;
      baseRider=users.find(u=>u.email===demoEmail("student"))?.id??"";
      account=users.find(u=>u.email===demoEmail("replacement"))?.id??"";
      if(!account||!baseRider)throw Error("Fixture accounts unavailable.");
      await owner.query("BEGIN");
      await owner.query("INSERT INTO membership(institution_id,account_id,role) VALUES($1,$2,'transport') ON CONFLICT DO NOTHING",[f.institution,account]);
      await owner.query("INSERT INTO department(institution_id,id,name) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",[f.institution,dept,fixtureName]);
      await owner.query("INSERT INTO course(institution_id,id,department_id,name) VALUES ($1,$2,$3,'Fictional Transport Lab') ON CONFLICT DO NOTHING",[f.institution,course,dept]);
      await owner.query("INSERT INTO section(institution_id,id,name) VALUES ($1,$2,'Fictional EEE A') ON CONFLICT DO NOTHING",[f.institution,section]);
      await owner.query("INSERT INTO offering(institution_id,id,course_id,section_id,term_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",[f.institution,offering,course,section,f.term]);
      for(const [sum,who,role] of [...drivers.map((id,n)=>[n+1,id,"driver"] as const),
        ...fictionalRiderChoices.slice(1).map((x,n)=>[n+2,x.rider,"student"] as const)]){
        await owner.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES ($1,$2,$3,true) ON CONFLICT DO NOTHING',
          [who,`Fictional Demo ${role} ${sum}`,`${who.toLowerCase()}@transport.example.invalid`]);
        await owner.query("INSERT INTO membership(institution_id,account_id,role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",[f.institution,who,role]);
      }
      for(const who of [baseRider,...fictionalRiderChoices.slice(1).map(x=>x.rider)])await owner.query(`
       INSERT INTO roster(institution_id,offering_id,account_id,role) VALUES ($1,$2,$3,'student') ON CONFLICT DO NOTHING`,[f.institution,offering,who]);
      await owner.query("COMMIT");
    }catch(e){await owner.query("ROLLBACK").catch(()=>undefined);throw e;}finally{owner.release();}
    const office={role:"transport" as const,institution:f.institution,account};
    for(const r of fictionalTransportRoutes){
      const catalog=await transportCatalog(office);
      const known=catalog?.routes.find(x=>x.code===r.code);
      const route=known?.id??await changeTransportCatalog(office,{operation:"create-route",...r});
      if(!known?.published_revision)await changeTransportCatalog(office,{operation:"publish-stops",route,expected:0,stops:r.stops});
      const v=catalog?.vehicles.find(x=>x.label===r.vehicle.title)?.id??await changeTransportCatalog(office,{operation:"create-vehicle",...r.vehicle});
      const schedule=known?.schedules.find(x=>x.day===r.weekday&&x.departure===r.departure)?.id??
        await changeTransportCatalog(office,{operation:"create-schedule",route,vehicle:v,weekday:r.weekday,departure:r.departure});
      if(!(await p.query("SELECT 1 FROM transport_trip WHERE institution_id=$1 AND schedule_id=$2 AND service_on='2026-12-02'",[f.institution,schedule])).rowCount)
        await changeTransportTrip(office,{operation:"create-trip",schedule,day:"2026-12-02",mode:"simulated",driver:r.driver??undefined});
    }
    const result=await transportCatalog(office);
    for(const [i,x] of fictionalRiderChoices.entries()){
      const route=result?.routes.find(r=>r.code===x.routeCode),stop=route?.stops.find(s=>s.label===x.stopLabel);
      if(!route||!stop)throw Error("Fictional stop mapping is unavailable.");
      await changeTransportCatalog({role:"student",account:i===0?baseRider:x.rider,institution:f.institution},{operation:"student-choice",route:route.id,stop:stop.id});
    }
    console.log("Fictional EEE transport staged: 4 routes, 20 timed stops, 4 vehicles, 3 driver records and 10 rider choices. Live tracking off.");
  } finally{await p.end();await db.end();}
}
await main();
