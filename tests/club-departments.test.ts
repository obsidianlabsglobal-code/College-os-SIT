// covers: DH-020
import "../scripts/environment";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { changeClub } from "../lib/clubverse";
import { clubDepartment, departmentClubs, linkClubDepartment } from "../lib/club-departments";
import { db } from "../lib/db";
import type { Scope } from "../lib/scope";
import { fixtures, demoEmail, personas } from "../scripts/fixtures";

const owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const as = new Map<string, Scope>();
before(async () => {
  for (const [alias, [, , role]] of Object.entries(personas)) {
    const { rows: [row] } = await owner.query('SELECT id FROM "user" WHERE email=$1', [demoEmail(alias)]);
    as.set(alias, { account: row.id, role, institution: alias === "tenant" ? fixtures.otherInstitution : fixtures.institution });
  }
});
after(async () => { await Promise.all([db.end(), owner.end()]); });

test("only the office links a club to a department; that department's HOD sees it, others do not", async () => {
  const founder = as.get("faculty")!, admin = as.get("admin")!, hod = as.get("hod")!;
  const name = `EEE Association ${randomUUID()}`;
  const club = await changeClub(founder, { operation: "draft", name, purpose: "Talks.", rules: "Monthly.", category: "technical", joining: "open", audience: "campus" });
  for (const [revision, next, who] of [[0, "submitted", founder], [1, "under_review", admin], [2, "approved", admin]] as const)
    await changeClub(who, { operation: "proposal", id: club, revision, next });
  await changeClub(as.get("student")!, { operation: "join", club });

  for (const who of [founder, hod, as.get("principal")!]) await assert.rejects(linkClubDepartment(who, { club, department: fixtures.department }), /unavailable/);
  await assert.rejects(linkClubDepartment({ ...as.get("tenant")!, role: "admin" }, { club, department: fixtures.department }), /unavailable/);
  await assert.rejects(linkClubDepartment(admin, { club, department: randomUUID() }), /department of this college/);
  await linkClubDepartment(admin, { club, department: fixtures.department });
  assert.equal((await clubDepartment(admin, club))?.id, fixtures.department);

  const row = (await departmentClubs(hod)).find(c => c.id === club);
  assert.deepEqual([row?.name, row?.members, row?.state], [name, 2, "active"], "founder and one student are active members");
  for (const alias of ["faculty", "admin", "principal", "student"]) assert.deepEqual(await departmentClubs(as.get(alias)!), [], alias);

  await linkClubDepartment(admin, { club, department: fixtures.otherDepartment });
  assert.ok(!(await departmentClubs(hod)).some(c => c.id === club), "moved to another department");
  await linkClubDepartment(admin, { club, department: "" });
  assert.equal(await clubDepartment(admin, club), null);
  const actions = (await owner.query("SELECT action FROM audit_event WHERE entity_id=$1 AND action LIKE 'club.department%' ORDER BY occurred_at", [club])).rows.map(r => r.action);
  assert.deepEqual(actions, ["club.department_linked", "club.department_linked", "club.department_unlinked"]);
});
