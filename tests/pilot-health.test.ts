// covers: ID-009, ID-004, ID-006
import "../scripts/environment";
import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { db } from "../lib/db";
import { pilotHealth } from "../lib/pilot-health";
import { fixtures, demoEmail, personas } from "../scripts/fixtures";
import type { Scope } from "../lib/scope";

const owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const as = new Map<string, Scope>();
const stranger = `stranger-${randomUUID().slice(0, 6)}@nexus.example.invalid`;

before(async () => {
  for (const url of [process.env.MIGRATION_DATABASE_URL, process.env.DATABASE_URL]) assert.ok(url && ["127.0.0.1", "localhost"].includes(new URL(url).hostname));
  for (const [alias, [, , role]] of Object.entries(personas)) {
    const { rows: [row] } = await owner.query('SELECT id FROM "user" WHERE email=$1', [demoEmail(alias)]);
    as.set(alias, { account: row.id, role, institution: alias === "tenant" ? fixtures.otherInstitution : fixtures.institution });
  }
  await owner.query("INSERT INTO sign_in_failure (email,method) VALUES ($1,'code'),($1,'password'),($2,'code')", [demoEmail("student"), stranger]);
});
after(async () => {
  await owner.query("DELETE FROM sign_in_failure WHERE email IN ($1,$2)", [demoEmail("student"), stranger]);
  await Promise.all([db.end(), owner.end()]);
});

test("the office sees pilot health for its own college only", async () => {
  const health = (await pilotHealth(as.get("admin")!))!;
  assert.ok(health.people.some(p => p.role === "student" && p.n >= 1));
  const student = health.failures.find(f => f.email === demoEmail("student"))!;
  assert.ok(student.failures >= 2, "a member's failed sign-ins are shown");
  assert.ok(!health.failures.some(f => f.email === stranger), "emails unrelated to this college are not shown");
  assert.ok(health.departments.some(d => d.name === "Electronics and Communication Engineering" && d.active));
  assert.equal(typeof health.phones.phones, "number");
  for (const alias of ["student", "faculty", "hod", "principal"]) assert.equal(await pilotHealth(as.get(alias)!), null);
  const other = await pilotHealth({ ...as.get("tenant")!, role: "admin" });
  assert.equal(other, null, "a tenant without an admin membership sees nothing");
});
