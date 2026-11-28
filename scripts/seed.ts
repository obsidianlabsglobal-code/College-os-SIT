import "./environment";
import { databaseConnection } from "../lib/database-target";
import { betterAuth } from "better-auth";
import { db } from "../lib/db";
import { Client } from "pg";
import { fixtures as f, personas, demoEmail, demoPassword } from "./fixtures";

async function main() {
  const migrationUrl = process.env.MIGRATION_DATABASE_URL;
  const runtimeUrl = process.env.DATABASE_URL;
  if (process.env.NEXUS_DEMO_SEED !== "1" || !migrationUrl || !runtimeUrl) {
    throw new Error("Set NEXUS_DEMO_SEED=1 and both database URLs for the fictional seed.");
  }
  const remote = [migrationUrl, runtimeUrl].some(url => !["127.0.0.1", "localhost"].includes(new URL(url).hostname));
  const password = remote ? process.env.NEXUS_DEMO_PASSWORD : demoPassword;
  if (remote && (process.env.NEXUS_DEMO_DATABASE_HOST !== new URL(migrationUrl).hostname ||
      !password || password.length < 24 || password === demoPassword)) {
    throw new Error("For fictional staging data, confirm the migration host and supply a unique demo password of at least 24 characters.");
  }
  if (!password) throw new Error("Set the fictional staging password.");
  const seeder = betterAuth({ database: db, emailAndPassword: { enabled: true }, rateLimit: { enabled: false } });
  const client = new Client({ connectionString: databaseConnection("migration") });
  await client.connect();
  try {
    if (remote) {
      const check = "SELECT 1 FROM institution WHERE id NOT IN ($1,$2) LIMIT 1";
      for (const result of await Promise.all([client.query(check,[f.institution,f.otherInstitution]),db.query(check,[f.institution,f.otherInstitution])])) {
        if (result.rowCount) throw new Error("Use a separate database dedicated to fictional release-candidate data.");
      }
    }
    const ids = new Map<string, string>();
    for (const [name, alias] of Object.values(personas)) {
      const email = demoEmail(alias);
      const { rows: [existing] } = await client.query<{ id: string }>('SELECT id FROM "user" WHERE email=$1', [email]);
      ids.set(alias, existing?.id ?? (await seeder.api.signUpEmail({ body: { email, password, name } })).user.id);
    }
    await client.query("BEGIN");
    await client.query("INSERT INTO institution (id,name) VALUES ($1,'Northfield Institute · Fictional demo'),($2,'Westhaven College · Fictional demo') ON CONFLICT DO NOTHING", [f.institution, f.otherInstitution]);
    await client.query("INSERT INTO department (institution_id,id,name) VALUES ($1,$2,'Electronics and Communication Engineering'),($1,$3,'Mechanical Engineering'),($4,$2,'Electronics and Communication Engineering') ON CONFLICT DO NOTHING", [f.institution, f.department, f.otherDepartment, f.otherInstitution]);
    await client.query("INSERT INTO academic_scheme (institution_id,id,name) SELECT id,$1,'Fictional Engineering Scheme' FROM institution WHERE id IN ($2,$3) ON CONFLICT DO NOTHING", [f.scheme, f.institution, f.otherInstitution]);
    await client.query("INSERT INTO academic_term (institution_id,id,scheme_id,name) SELECT institution_id,$1,id,'Term 1' FROM academic_scheme WHERE id=$2 AND institution_id IN ($3,$4) ON CONFLICT DO NOTHING", [f.term, f.scheme, f.institution, f.otherInstitution]);
    await client.query("INSERT INTO course (institution_id,id,department_id,name) VALUES ($1,$2,$3,'Introduction to Programming'),($1,$4,$4,'Engineering Mechanics'),($5,$2,$3,'Introduction to Programming') ON CONFLICT DO NOTHING", [f.institution, f.course, f.department, f.otherDepartment, f.otherInstitution]);
    for (const institution of [f.institution, f.otherInstitution]) {
      await client.query("INSERT INTO section (institution_id,id,name) VALUES ($1,$2,'Section A'),($1,$3,'Section B') ON CONFLICT DO NOTHING", [institution, f.section, f.otherSection]);
      await client.query("INSERT INTO offering (institution_id,id,course_id,section_id,term_id) VALUES ($1,$2,$3,$4,$5),($1,$6,$3,$7,$5) ON CONFLICT DO NOTHING", [institution, f.offering, f.course, f.section, f.term, f.otherOffering, f.otherSection]);
    }
    await client.query("INSERT INTO offering (institution_id,id,course_id,section_id,term_id) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING", [f.institution, f.otherDepartmentOffering, f.otherDepartment, f.section, f.term]);
    for (const [, alias, role] of Object.values(personas)) {
      const institution = alias === "tenant" ? f.otherInstitution : f.institution;
      await client.query("INSERT INTO membership (institution_id,account_id,role,department_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", [institution, ids.get(alias), role, role === "hod" ? f.department : null]);
      if (role === "faculty" && alias !== "replacement" || role === "student") {
        await client.query("INSERT INTO roster (institution_id,offering_id,account_id,role) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", [institution, alias === "outsider" ? f.otherOffering : f.offering, ids.get(alias), role]);
      }
    }
    // Labelled synthetic rehearsal evidence for the five instrumented workflows (blueprint p. 17 example volumes).
    // These are engineering estimates, never pilot measurements; real baselines need authorized, consented timing.
    if (!(await client.query("SELECT 1 FROM automation_effort_sample WHERE institution_id=$1 AND quality='synthetic'", [f.institution])).rowCount) {
      const rehearsal: [string, number, number, number][] = [
        ["attendance", 30, 180, 18], ["assignments", 25, 150, 15], ["results", 25, 120, 13], ["requests", 20, 200, 22], ["timetable", 15, 150, 16]];
      for (const [workflow, cases, baseline, post] of rehearsal) for (const [phase, minutes] of [["baseline", baseline], ["post", post]] as const) {
        await client.query(
          `INSERT INTO automation_effort_sample (institution_id,workflow,phase,quality,cases,human_minutes,method,recorded_by)
           VALUES ($1,$2,$3,'synthetic',$4,$5,'Synthetic engineering rehearsal with fictional cases; includes review and exception time. Not a pilot measurement.',$6)`,
          [f.institution, workflow, phase, cases, minutes, ids.get("admin")]);
      }
    }
    await client.query("COMMIT");
    console.log("Fictional demo accounts and course rosters are ready.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.end());
