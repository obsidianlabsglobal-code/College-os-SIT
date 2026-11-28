// covers: OP-012, OP-016, AD-018, AD-022, AD-024, ID-004, ID-006
import "../scripts/environment";
import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { db } from "../lib/db";
import { advanceRequest, assignRequest, createRequest, requests, requestStaff } from "../lib/connected";
import { notifications, runJobs } from "../lib/automation";
import { auditEvents, operationsReport, parseAuditFilter } from "../lib/reporting";
import { fixtures, demoEmail, personas } from "../scripts/fixtures";
import type { Scope } from "../lib/scope";

const owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const as = new Map<string, Scope>();
let colleague: Scope;
before(async () => {
  for (const url of [process.env.MIGRATION_DATABASE_URL, process.env.DATABASE_URL]) assert.ok(url && ["127.0.0.1", "localhost"].includes(new URL(url).hostname));
  for (const [alias, [, , role]] of Object.entries(personas)) {
    const { rows: [row] } = await owner.query('SELECT id FROM "user" WHERE email=$1', [demoEmail(alias)]);
    as.set(alias, { account: row.id, role, institution: alias === "tenant" ? fixtures.otherInstitution : fixtures.institution });
  }
  // A second fictional office member for the duration of this file.
  colleague = { ...as.get("replacement")!, role: "admin" };
  await owner.query(`INSERT INTO membership (institution_id,account_id,role) VALUES ($1,$2,'admin')
    ON CONFLICT (institution_id,account_id,role,department_id) DO UPDATE SET ended_at=NULL`, [fixtures.institution, colleague.account]);
});
after(async () => {
  await owner.query("UPDATE membership SET ended_at=now() WHERE institution_id=$1 AND account_id=$2 AND role='admin'", [fixtures.institution, colleague.account]);
  await Promise.all([db.end(), owner.end()]);
});

async function newRequest(text: string) {
  await createRequest(as.get("student")!, text);
  return (await owner.query("SELECT id FROM service_request WHERE description=$1", [text])).rows[0].id as string;
}
async function eventually<T>(read: () => Promise<T>, ok: (value: T) => boolean) {
  for (let i = 0; i < 40; i++) { await runJobs({ worker: "operations-test" }); const value = await read(); if (ok(value)) return value; await new Promise(r => setTimeout(r, 100)); }
  return read();
}

test("requests have one accountable owner; others cannot act until reassigned", async () => {
  const admin = as.get("admin")!, id = await newRequest(`Assignment ${randomUUID()}`);
  assert.ok((await requestStaff(admin)).some(person => person.id === colleague.account));
  assert.ok((await requests(admin, "unassigned")).some(r => r.id === id));
  await assert.rejects(assignRequest(as.get("student")!, id, admin.account), /unavailable/);
  await assert.rejects(assignRequest(admin, id, as.get("faculty")!.account), /active administrative staff/);
  await assert.rejects(assignRequest({ ...admin, institution: fixtures.otherInstitution }, id, admin.account), /unavailable/);
  const tries = await Promise.allSettled([assignRequest(admin, id, colleague.account), assignRequest(admin, id, colleague.account)]);
  assert.equal(tries.filter(t => t.status === "fulfilled").length, 1, "a duplicate assignment is rejected, not double-audited");
  assert.ok((await requests(colleague, "mine")).some(r => r.id === id));
  assert.ok(!(await requests(admin, "mine")).some(r => r.id === id));
  assert.ok(!(await requests(admin, "unassigned")).some(r => r.id === id));
  await assert.rejects(advanceRequest(admin, id, "in_progress"), /assigned to someone else/);
  const assigned = (n: { entity_id: string; title: string }) => n.entity_id === id && n.title === "Enrollment-letter request assigned to you";
  const inbox = await eventually(() => notifications(colleague), items => items.some(assigned));
  assert.equal(inbox.filter(assigned).length, 1);
  await assignRequest(colleague, id, admin.account);
  await advanceRequest(admin, id, "in_progress");
  await advanceRequest(admin, id, "resolved", "Letter issued");
  await assert.rejects(assignRequest(admin, id, colleague.account), /closed/);
  const audit = await owner.query("SELECT action FROM audit_event WHERE entity_id=$1 ORDER BY id", [id]);
  assert.deepEqual(audit.rows.map(r => r.action), ["service_request.submitted", "service_request.assigned", "service_request.assigned",
    "service_request.in_progress", "service_request.resolved"]);
});

test("starting review claims an unassigned request; a revoked assignee's notification disappears", async () => {
  const admin = as.get("admin")!, id = await newRequest(`Claim ${randomUUID()}`);
  await advanceRequest(admin, id, "in_progress");
  assert.equal((await requests(admin, "mine")).find(r => r.id === id)?.assignee, "Mira Bose");
  const other = await newRequest(`Revoked ${randomUUID()}`);
  await assignRequest(admin, other, colleague.account);
  await eventually(() => notifications(colleague), items => items.some(n => n.entity_id === other && n.title.includes("assigned to you")));
  await owner.query("UPDATE membership SET ended_at=now() WHERE institution_id=$1 AND account_id=$2 AND role='admin'", [fixtures.institution, colleague.account]);
  assert.deepEqual(await notifications(colleague), [], "access is re-checked when the inbox is read");
  assert.ok(!(await requestStaff(admin)).some(p => p.id === colleague.account));
  await assert.rejects(assignRequest(admin, id, colleague.account), /active administrative staff/);
  await owner.query("UPDATE membership SET ended_at=NULL WHERE institution_id=$1 AND account_id=$2 AND role='admin'", [fixtures.institution, colleague.account]);
  await advanceRequest(admin, id, "declined", "Duplicate");
  await assignRequest(admin, other, admin.account);
  await advanceRequest(admin, other, "in_progress");
  await advanceRequest(admin, other, "resolved", "Done");
});

test("operations report measures queue age, resolution and rework for office and leadership only", async () => {
  const admin = as.get("admin")!;
  const before = (await operationsReport(admin))!;
  const id = await newRequest(`Ops ${randomUUID()}`);
  await owner.query("UPDATE service_request SET created_at=now()-interval '10 days' WHERE id=$1", [id]);
  const open = (await operationsReport(admin))!;
  assert.equal(open.open, before.open + 1);
  assert.equal(open.unassigned, before.unassigned + 1);
  assert.ok(open.oldest_open_hours! >= 240);
  await advanceRequest(admin, id, "in_progress");
  await advanceRequest(admin, id, "resolved", "Issued");
  const done = (await operationsReport(admin))!;
  assert.equal(done.resolved_30d, before.resolved_30d + 1);
  assert.ok(done.median_resolution_hours !== null);
  assert.deepEqual(await operationsReport(as.get("principal")!), done);
  for (const alias of ["student", "faculty", "hod"]) assert.equal(await operationsReport(as.get(alias)!), null);
  assert.equal(await operationsReport({ ...admin, institution: fixtures.otherInstitution }), null);
});

test("audit viewer searches metadata for admins only, within the tenant", async () => {
  const admin = as.get("admin")!, id = await newRequest(`Audit ${randomUUID()}`);
  const found = (await auditEvents(admin, { action: "service_request.sub", actor: "Asha", page: 1 }))!;
  const row = found.rows.find(r => r.entity_id === id)!;
  assert.equal(row.action, "service_request.submitted");
  assert.equal(row.actor, "Asha Sen");
  assert.deepEqual(Object.keys(row).sort(), ["action", "actor", "actor_role", "entity_id", "id", "occurred_at", "ref", "revision"], "metadata only");
  assert.equal((await auditEvents(admin, { action: "notice.", actor: "", page: 1 }))!.rows.every(r => r.action.startsWith("notice.")), true);
  const future = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  assert.equal((await auditEvents(admin, { action: "", actor: "", from: future, page: 1 }))!.rows.length, 0);
  for (const alias of ["student", "faculty", "hod", "principal"]) assert.equal(await auditEvents(as.get(alias)!, { action: "", actor: "", page: 1 }), null);
  const tenant = await auditEvents({ ...admin, institution: fixtures.otherInstitution }, { action: "", actor: "", page: 1 });
  assert.equal(tenant?.rows.length, 0, "a post in one institution reads nothing from another");
  assert.equal(parseAuditFilter({ action: "x'; DROP TABLE audit_event;--" }).success, false);
  assert.equal(parseAuditFilter({ page: "0" }).success, false);
  await advanceRequest(admin, id, "in_progress"); await advanceRequest(admin, id, "declined", "Test");
});
