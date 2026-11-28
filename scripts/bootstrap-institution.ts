// One-time setup of a real institution for the pilot, used instead of the fictional seed. Creates the institution, its
// departments (only the listed ones switched on) and the first office account with a one-time password printed once.
// Run only after the college's written permission and on the pilot database (docs/DEPLOYMENT.md, "SIT EEE pilot runbook").
//   NEXUS_BOOTSTRAP_INSTITUTION="..." NEXUS_BOOTSTRAP_DEPARTMENTS="Electrical and Electronics Engineering,..."
//   NEXUS_BOOTSTRAP_ACTIVE="Electrical and Electronics Engineering" NEXUS_BOOTSTRAP_ADMIN_EMAIL=... NEXUS_BOOTSTRAP_ADMIN_NAME=...
//   npx tsx scripts/bootstrap-institution.ts            (add --apply to write; without it, only prints the plan)
import "./environment";
import { randomBytes } from "node:crypto";
import { betterAuth } from "better-auth";
import { Client } from "pg";
import { z } from "zod";
import { databaseConnection } from "../lib/database-target";
import { db } from "../lib/db";

const input = z.object({
  institution: z.string().trim().min(3).max(160),
  departments: z.array(z.string().trim().min(2).max(120)).min(1).max(40),
  active: z.array(z.string().trim().min(2).max(120)).min(1),
  adminEmail: z.email(),
  adminName: z.string().trim().min(2).max(120),
}).refine(v => v.active.every(a => v.departments.includes(a)), { message: "Every active department must be in the department list." })
  .refine(v => new Set(v.departments).size === v.departments.length, { message: "Department names must be unique." });

const list = (value?: string) => (value ?? "").split(",").map(s => s.trim()).filter(Boolean);

async function main() {
  const plan = input.parse({ institution: process.env.NEXUS_BOOTSTRAP_INSTITUTION, departments: list(process.env.NEXUS_BOOTSTRAP_DEPARTMENTS),
    active: list(process.env.NEXUS_BOOTSTRAP_ACTIVE), adminEmail: process.env.NEXUS_BOOTSTRAP_ADMIN_EMAIL, adminName: process.env.NEXUS_BOOTSTRAP_ADMIN_NAME });
  console.log(`Institution: ${plan.institution}\nDepartments: ${plan.departments.map(d => `${d}${plan.active.includes(d) ? " (on)" : " (off)"}`).join(", ")}\nOffice account: ${plan.adminName} <${plan.adminEmail}>`);
  if (!process.argv.includes("--apply")) { console.log("Dry run. Add --apply to write."); return; }

  const client = new Client({ connectionString: databaseConnection("migration") });
  await client.connect();
  try {
    const { rows: [existing] } = await client.query("SELECT id FROM institution WHERE name=$1", [plan.institution]);
    if (existing) throw new Error("An institution with this name already exists. Nothing was changed.");
    const { rows: [taken] } = await client.query('SELECT 1 FROM "user" WHERE email=$1', [plan.adminEmail]);
    if (taken) throw new Error("That office email already has an account. Nothing was changed.");
    // The account is created first through the auth library (it owns password hashing), then everything else in one transaction.
    const password = randomBytes(18).toString("base64url");
    const auth = betterAuth({ database: db, emailAndPassword: { enabled: true }, rateLimit: { enabled: false } });
    const { user } = await auth.api.signUpEmail({ body: { email: plan.adminEmail, password, name: plan.adminName } });
    await client.query("BEGIN");
    const { rows: [institution] } = await client.query<{ id: string }>("INSERT INTO institution (name,timezone) VALUES ($1,'Asia/Kolkata') RETURNING id", [plan.institution]);
    for (const name of plan.departments) await client.query("INSERT INTO department (institution_id,name,active) VALUES ($1,$2,$3)", [institution.id, name, plan.active.includes(name)]);
    await client.query("INSERT INTO membership (institution_id,account_id,role) VALUES ($1,$2,'admin')", [institution.id, user.id]);
    await client.query("INSERT INTO audit_event (institution_id,actor_id,entity_id,action) VALUES ($1,$2,$1,'institution.bootstrapped')", [institution.id, user.id]);
    await client.query("COMMIT");
    console.log(`Created institution ${institution.id}.\nOne-time office password (shown once; change it or switch to email sign-in on first use): ${password}`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch(error => { console.error(error instanceof z.ZodError ? error.issues.map(i => i.message).join("; ") : (error as Error).message); process.exitCode = 1; })
  .finally(() => db.end());
