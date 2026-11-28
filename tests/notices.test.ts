// covers: DH-015, LE-007, AD-035, ID-004, OP-010
import "../scripts/environment";
import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { db } from "../lib/db";
import { draftNotice, notices, publishNotice } from "../lib/connected";
import { fixtures, demoEmail, personas } from "../scripts/fixtures";
import type { Scope } from "../lib/scope";

const owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const as = new Map<string, Scope>();
before(async () => {
  for (const url of [process.env.MIGRATION_DATABASE_URL, process.env.DATABASE_URL]) assert.ok(url && ["127.0.0.1", "localhost"].includes(new URL(url).hostname));
  for (const [alias, [, , role]] of Object.entries(personas)) {
    const { rows: [row] } = await owner.query('SELECT id FROM "user" WHERE email=$1', [demoEmail(alias)]);
    as.set(alias, { account: row.id, role, institution: alias === "tenant" ? fixtures.otherInstitution : fixtures.institution });
  }
});
after(async () => { await Promise.all([db.end(), owner.end()]); });

const titles = async (alias: string, filter: "all" | "published" | "draft" = "published") => (await notices(as.get(alias)!, filter)).map(n => n.title);
async function idOf(title: string) { return (await owner.query("SELECT id FROM notice WHERE title=$1", [title])).rows[0].id as string; }

test("department notices reach only the HOD's department audience after publication", async () => {
  const title = `Department notice ${randomUUID()}`;
  await assert.rejects(draftNotice(as.get("hod")!, title, "Fictional", fixtures.otherDepartment), /unavailable/);
  await assert.rejects(draftNotice(as.get("student")!, title, "Fictional", fixtures.department), /unavailable/);
  await draftNotice(as.get("hod")!, title, "Fictional lab schedule", fixtures.department);
  assert.ok((await titles("hod", "draft")).includes(title));
  assert.ok(!(await titles("student", "all")).includes(title), "drafts stay private to the author");
  await assert.rejects(publishNotice(as.get("admin")!, await idOf(title)), /unavailable/);
  await publishNotice(as.get("hod")!, await idOf(title));
  await publishNotice(as.get("hod")!, await idOf(title)); // idempotent
  assert.ok((await titles("student")).includes(title));
  assert.ok((await titles("principal")).includes(title));
  assert.ok((await titles("outsider")).includes(title), "every section in the department sees it");
  assert.ok(!(await titles("tenant")).includes(title), "other institutions never see it");
  const audit = await owner.query("SELECT action FROM audit_event WHERE entity_id=$1 ORDER BY action", [await idOf(title)]);
  assert.deepEqual(audit.rows.map(r => r.action), ["notice.drafted", "notice.published"]);
});

test("institution announcements are drafted by admins and readable by every member, including leadership", async () => {
  const title = `Institution notice ${randomUUID()}`;
  await assert.rejects(draftNotice(as.get("principal")!, title, "Fictional"), /unavailable/);
  await assert.rejects(draftNotice(as.get("faculty")!, title, "Fictional"), /unavailable/);
  await draftNotice(as.get("admin")!, title, "Fictional campus closure");
  assert.ok(!(await titles("principal")).includes(title));
  await publishNotice(as.get("admin")!, await idOf(title));
  for (const alias of ["principal", "hod", "faculty", "student", "outsider"]) assert.ok((await titles(alias)).includes(title), alias);
  assert.ok(!(await titles("tenant")).includes(title));
  await assert.rejects(publishNotice({ ...as.get("admin")!, institution: fixtures.otherInstitution }, await idOf(title)), /unavailable/);
});

test("an operational notice shows its kind and end date, and disappears for readers once the date has passed", async () => {
  const admin = as.get("admin")!, title = `Water shutdown ${randomUUID()}`;
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Kolkata" });
  await assert.rejects(draftNotice(admin, title, "Block C", undefined, { kind: "operational", expires: "2020-01-01" }), /end date/);
  await draftNotice(admin, title, "Block C has no water from 10 to 2.", undefined, { kind: "operational", expires: today });
  await publishNotice(admin, await idOf(title));
  const seen = (await notices(as.get("student")!, "all")).find(n => n.title === title);
  assert.deepEqual([seen?.kind, seen?.expires_on], ["operational", today]);
  await owner.query("UPDATE notice SET expires_on=current_date-2 WHERE title=$1", [title]);
  for (const alias of ["student", "faculty", "principal"]) assert.ok(!(await titles(alias, "all")).includes(title), alias);
  assert.ok((await titles("admin", "all")).includes(title), "the author still sees it");
});
