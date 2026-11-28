// covers: TR-024, TR-025, TO-012, ID-004, ID-006
import "../scripts/environment";
import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { db } from "../lib/db";
import { WorkflowError } from "../lib/assignments";
import { assignCase, caseStaff, cases, closeCase, openCase, startCase } from "../lib/cases";
import { departmentSwitches, isAccountInActiveDepartment, setDepartmentActive } from "../lib/active-departments";
import { fixtures, demoEmail, personas } from "../scripts/fixtures";
import type { Scope } from "../lib/scope";

const owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const as = new Map<string, Scope>();
const i = fixtures.institution;
const tag = randomUUID().slice(0, 8);
const rejects = (run: () => Promise<unknown>, pattern?: RegExp) =>
  assert.rejects(async () => run(), (e: unknown) => (e instanceof WorkflowError || (e as Error).name === "ZodError") && (!pattern || pattern.test((e as Error).message)));
let office: Scope, driver: Scope;

before(async () => {
  for (const url of [process.env.MIGRATION_DATABASE_URL, process.env.DATABASE_URL]) assert.ok(url && ["127.0.0.1", "localhost"].includes(new URL(url).hostname));
  for (const [alias, [, , role]] of Object.entries(personas)) {
    const { rows: [row] } = await owner.query('SELECT id FROM "user" WHERE email=$1', [demoEmail(alias)]);
    as.set(alias, { account: row.id, role, institution: alias === "tenant" ? fixtures.otherInstitution : fixtures.institution });
  }
  // Fictional extra roles for this test: Rohan Roy also works in the transport office, Neel Das also drives.
  office = { ...as.get("replacement")!, role: "transport" };
  driver = { ...as.get("outsider")!, role: "driver" };
  await owner.query("INSERT INTO membership (institution_id,account_id,role) VALUES ($1,$2,'transport'),($1,$3,'driver') ON CONFLICT DO NOTHING",
    [i, office.account, driver.account]);
});
after(async () => {
  const ids = (await owner.query("SELECT id FROM case_record WHERE institution_id=$1 AND title LIKE $2", [i, `% ${tag}`])).rows.map(r => r.id);
  await owner.query("DELETE FROM notification WHERE institution_id=$1 AND entity_id=ANY($2)", [i, ids]);
  await owner.query("DELETE FROM job WHERE institution_id=$1 AND event_id IN (SELECT id FROM audit_event WHERE institution_id=$1 AND entity_id=ANY($2))", [i, ids]);
  await owner.query("DELETE FROM case_record WHERE institution_id=$1 AND id=ANY($2)", [i, ids]);
  await owner.query("DELETE FROM membership WHERE institution_id=$1 AND role IN ('transport','driver') AND account_id IN ($2,$3)", [i, office.account, driver.account]);
  await owner.query("UPDATE department SET active=true WHERE institution_id=$1", [i]);
  await Promise.all([db.end(), owner.end()]);
});

test("transport incidents and lost property are read by the reporter and the transport office, which coordinates them", async () => {
  const student = as.get("student")!, admin = as.get("admin")!;
  const incident = await openCase(student, { kind: "transport_incident", title: `Bus 3 skipped my stop ${tag}`, body: "Fictional: the bus did not stop at Hebbal." });
  const lost = await openCase(driver, { kind: "lost_and_found", title: `Blue water bottle found ${tag}`, body: "Fictional: found on the back seat of bus 2." });
  await rejects(() => openCase(as.get("principal")!, { kind: "transport_incident", title: `x ${tag}`, body: "x" }));
  assert.ok((await cases(office, "transport_incident")).some(c => c.id === incident));
  assert.ok((await cases(office, "lost_and_found")).some(c => c.id === lost));
  assert.ok((await cases(student, "transport_incident")).some(c => c.id === incident));
  for (const other of [as.get("outsider")!, as.get("faculty")!, admin, as.get("hod")!])
    assert.ok(!(await cases(other, "transport_incident")).some(c => c.id === incident), "only the reporter and the transport office read it");
  assert.ok(!(await cases({ ...as.get("tenant")!, role: "transport" }, "transport_incident")).some(c => c.id === incident));
  assert.deepEqual((await caseStaff(office, "transport_incident")).map(s => s.id), [office.account]);
  assert.deepEqual(await caseStaff(admin, "transport_incident"), []);
  await rejects(() => assignCase(admin, { case: incident, assignee: admin.account }));
  await rejects(() => assignCase(office, { case: incident, assignee: admin.account }), /current staff/);
  await assignCase(office, { case: incident, assignee: office.account });
  await startCase(office, incident);
  await closeCase(office, { case: incident, outcome: "resolved", reason: "Driver briefed; the stop is now on the schedule card." });
  assert.equal((await cases(student, "transport_incident")).find(c => c.id === incident)?.outcome, "Driver briefed; the stop is now on the schedule card.");
});

test("the office switches departments on and off with a reason; membership in an active department follows", async () => {
  const admin = as.get("admin")!, student = as.get("student")!;
  const ece = fixtures.department;
  assert.equal(await isAccountInActiveDepartment(admin, student.account), true);
  await rejects(() => setDepartmentActive(as.get("principal")!, { department: ece, active: false, reason: "x" }));
  await rejects(() => setDepartmentActive(office, { department: ece, active: false, reason: "x" }));
  await rejects(() => setDepartmentActive(admin, { department: ece, active: false, reason: "" }));
  await rejects(() => setDepartmentActive(admin, { department: ece, active: true, reason: "Already on" }), /already in that state/);
  await setDepartmentActive(admin, { department: fixtures.otherDepartment, active: false, reason: "Pilot starts with ECE only" });
  assert.equal(await isAccountInActiveDepartment(admin, student.account), true, "the student's own department is still on");
  await setDepartmentActive(admin, { department: ece, active: false, reason: `Pause ${tag}` });
  assert.equal(await isAccountInActiveDepartment(admin, student.account), false);
  assert.equal(await isAccountInActiveDepartment(admin, as.get("hod")!.account), false, "the HOD's department is off");
  await setDepartmentActive(admin, { department: ece, active: true, reason: `Resume ${tag}` });
  assert.equal(await isAccountInActiveDepartment(admin, student.account), true);
  const switches = await departmentSwitches(admin);
  assert.deepEqual([switches.find(d => d.id === ece)?.active, switches.find(d => d.id === fixtures.otherDepartment)?.active], [true, false]);
  assert.deepEqual(await departmentSwitches(student), []);
  assert.ok(!(await departmentSwitches({ ...as.get("tenant")!, role: "admin" })).some(d => !d.active), "other tenants are untouched");
  const { rows } = await owner.query("SELECT action FROM audit_event WHERE institution_id=$1 AND entity_id=$2 ORDER BY id DESC LIMIT 2", [i, ece]);
  assert.deepEqual(rows.map(r => r.action), ["department.switched_on", "department.switched_off"]);
});
