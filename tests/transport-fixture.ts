import { Pool } from "pg";
import { demoEmail, fixtures as f } from "../scripts/fixtures";
export async function grantFakeTransportOffice(owner:Pool) {
  for(const v of [process.env.DATABASE_URL,process.env.MIGRATION_DATABASE_URL]) {
    if(!v || !["127.0.0.1","localhost"].includes(new URL(v).hostname)) throw Error("Local fixture required.");
  }
  const {rows:[{id:account}]}=await owner.query<{id:string}>('SELECT id FROM "user" WHERE email=$1',[demoEmail("replacement")]);
  const {rowCount}=await owner.query("INSERT INTO membership(institution_id,account_id,role) VALUES($1,$2,'transport') ON CONFLICT DO NOTHING",[f.institution,account]);
  return {account,granted:Number(rowCount)>0};
}
export async function clearTransportFixture(owner:Pool,codes:string[],vehicleTitles:string[],office:{account:string;granted:boolean}) {
  const args=[f.institution,codes];
  const routes="SELECT id FROM transport_route WHERE institution_id=$1 AND code=ANY($2)";
  await owner.query(`DELETE FROM transport_choice WHERE institution_id=$1 AND route_id IN (${routes})`,args);
  await owner.query(`DELETE FROM transport_schedule WHERE institution_id=$1 AND route_id IN (${routes})`,args);
  await owner.query("UPDATE transport_route SET published_revision=NULL WHERE institution_id=$1 AND code=ANY($2)",args);
  for(const table of ["transport_route_stop","transport_route_revision","transport_stop"])
    await owner.query(`DELETE FROM ${table} WHERE institution_id=$1 AND route_id IN (${routes})`,args);
  await owner.query("DELETE FROM transport_route WHERE institution_id=$1 AND code=ANY($2)",args);
  await owner.query("DELETE FROM transport_vehicle WHERE institution_id=$1 AND label=ANY($2)",[f.institution,vehicleTitles]);
  if(office.granted) await owner.query("DELETE FROM membership WHERE institution_id=$1 AND account_id=$2 AND role='transport'",[f.institution,office.account]);
}

export function scheduledTransportTestPool() {
  const migration = new URL(process.env.MIGRATION_DATABASE_URL!);
  const worker = new URL(process.env.WORKER_DATABASE_URL!);
  if (!["127.0.0.1", "localhost"].includes(worker.hostname) ||
      worker.host !== migration.host || worker.pathname !== migration.pathname ||
      worker.username !== "nexus_worker" || worker.search || worker.hash) {
    throw new Error("Fictional loopback worker database required.");
  }
  return new Pool({ connectionString: worker.href });
}
