import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { audit, WorkflowError } from "./assignments";
import { db, transaction } from "./db";
import type { Scope } from "./scope";

// ID-012: the office imports teachers from a CSV. A preview validates every row and stores the checked rows; nothing else
// is written. Applying writes exactly the previewed rows, after re-checking, and only when every row is valid.
// Columns: name,email,phone,department,teaches,mentor_of
//   teaches   = "Course name / Section name; Course name / Section name"
//   mentor_of = "Section name; Section name"
export const TEACHER_COLUMNS = ["name", "email", "phone", "department", "teaches", "mentor_of"] as const;
const MAX_ROWS = 400;
const unavailable = () => new WorkflowError("This action is unavailable.");

/** RFC 4180-style CSV: quoted fields, doubled quotes, CRLF or LF line ends. */
export function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some(f => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(f => f.trim() !== "")) rows.push(row);
  return rows;
}

export type TeacherRow = { line: number; name: string; email: string; phone: string | null; department: string; teaches: { course: string; section: string }[];
  mentor_of: string[]; errors: string[]; department_id?: string; offerings?: string[]; mentor_sections?: string[] };

const emailSchema = z.email().max(254);
const split = (value: string, separator: string) => value.split(separator).map(s => s.trim()).filter(Boolean);

async function requireAdmin(client: PoolClient | typeof db, scope: Scope, lock = false) {
  const { rowCount } = await client.query(`SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role='admin' AND ended_at IS NULL${lock ? " FOR SHARE" : ""}`,
    [scope.institution, scope.account]);
  if (scope.role !== "admin" || !rowCount) throw unavailable();
}

/** Checks rows against the institution's current records. Used for the preview and again before applying. */
async function check(client: PoolClient | typeof db, scope: Scope, rows: TeacherRow[]) {
  const seen = new Map<string, number>();
  for (const row of rows) {
    row.errors = [];
    if (row.name.length < 2 || row.name.length > 120) row.errors.push("Name must be 2–120 characters.");
    if (!emailSchema.safeParse(row.email).success) row.errors.push("Email is not valid.");
    else if (seen.has(row.email)) row.errors.push(`Same email as line ${seen.get(row.email)}.`);
    else seen.set(row.email, row.line);
    if (row.phone && !/^\+?[0-9 ]{7,16}$/.test(row.phone)) row.errors.push("Phone must be 7–16 digits, optionally starting with +.");
    const { rows: [dept] } = await client.query<{ id: string; active: boolean }>("SELECT id,active FROM department WHERE institution_id=$1 AND lower(name)=lower($2)",
      [scope.institution, row.department]);
    if (!dept) { row.errors.push(`Department "${row.department}" does not exist.`); continue; }
    if (!dept.active) row.errors.push(`Department "${row.department}" is not switched on.`);
    row.department_id = dept.id;
    const { rowCount: member } = await client.query(`SELECT 1 FROM membership m JOIN "user" u ON u.id=m.account_id
      WHERE m.institution_id=$1 AND lower(u.email)=$2 AND m.role='faculty' AND m.ended_at IS NULL`, [scope.institution, row.email]);
    if (member) row.errors.push("This email is already a current teacher here.");
    row.offerings = [];
    for (const t of row.teaches) {
      // The newest term's offering of that course and section in the row's department.
      const { rows: [o] } = await client.query<{ id: string }>(`SELECT o.id FROM offering o JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id)
        JOIN section s ON (s.institution_id,s.id)=(o.institution_id,o.section_id)
        WHERE o.institution_id=$1 AND lower(c.name)=lower($2) AND lower(s.name)=lower($3) AND c.department_id=$4
        ORDER BY o.term_id DESC LIMIT 1`, [scope.institution, t.course, t.section, dept.id]);
      if (!o) row.errors.push(`No class "${t.course} / ${t.section}" in ${row.department}.`); else row.offerings.push(o.id);
    }
    row.mentor_sections = [];
    for (const name of row.mentor_of) {
      const { rows: [s] } = await client.query<{ id: string }>("SELECT id FROM section WHERE institution_id=$1 AND lower(name)=lower($2)", [scope.institution, name]);
      if (!s) row.errors.push(`Section "${name}" does not exist.`); else row.mentor_sections.push(s.id);
    }
  }
  return rows;
}

/** Office preview: parse and check; stores the checked rows and returns the import id. Writes nothing else. */
export async function previewTeacherImport(scope: Scope, csv: unknown) {
  const text = z.string().max(400_000).parse(csv);
  await requireAdmin(db, scope);
  const table = parseCsv(text.replace(/^﻿/, ""));
  const header = (table.shift() ?? []).map(h => h.trim().toLowerCase());
  if (TEACHER_COLUMNS.some((c, i) => header[i] !== c)) throw new WorkflowError(`The first line must be: ${TEACHER_COLUMNS.join(",")}`);
  if (!table.length) throw new WorkflowError("The file has no teacher rows.");
  if (table.length > MAX_ROWS) throw new WorkflowError(`Import at most ${MAX_ROWS} teachers at a time.`);
  const rows: TeacherRow[] = table.map((cells, index) => {
    const [name = "", email = "", phone = "", department = "", teaches = "", mentor = ""] = cells.map(c => c.trim());
    const pairs = split(teaches, ";").map(p => { const [course = "", section = ""] = p.split("/").map(s => s.trim()); return { course, section }; });
    const row: TeacherRow = { line: index + 2, name, email: email.toLowerCase(), phone: phone || null, department, teaches: pairs, mentor_of: split(mentor, ";"), errors: [] };
    if (pairs.some(p => !p.course || !p.section)) row.errors.push('Write each class as "Course / Section", separated by ";".');
    return row;
  });
  const malformed = new Map(rows.map(r => [r.line, [...r.errors]]));
  await check(db, scope, rows);
  for (const r of rows) r.errors.unshift(...(malformed.get(r.line) ?? []));
  const { rows: [saved] } = await db.query<{ id: string }>("INSERT INTO roster_import (institution_id,kind,rows,created_by) VALUES ($1,'teachers',$2,$3) RETURNING id",
    [scope.institution, JSON.stringify(rows), scope.account]);
  return { id: saved.id, rows };
}

export async function teacherImport(scope: Scope, id: unknown) {
  const importId = z.uuid().parse(id);
  await requireAdmin(db, scope);
  return (await db.query<{ id: string; state: string; rows: TeacherRow[]; created_at: Date }>(
    "SELECT id,state,rows,created_at FROM roster_import WHERE institution_id=$1 AND id=$2 AND kind='teachers'", [scope.institution, importId])).rows[0] ?? null;
}

/** Office confirms: re-check the previewed rows and write them all, or nothing. */
export function applyTeacherImport(scope: Scope, id: unknown) {
  const importId = z.uuid().parse(id);
  return transaction(async client => {
    await requireAdmin(client, scope, true);
    const { rows: [saved] } = await client.query<{ state: string; rows: TeacherRow[] }>(
      "SELECT state,rows FROM roster_import WHERE institution_id=$1 AND id=$2 AND kind='teachers' FOR UPDATE", [scope.institution, importId]);
    if (!saved || saved.state !== "previewed") throw new WorkflowError("This import is unavailable or was already applied.");
    const rows = await check(client, scope, saved.rows.map(r => ({ ...r, errors: [] })));
    if (rows.some(r => r.errors.length)) throw new WorkflowError("Some rows no longer pass the checks. Upload the file again to see why.");
    for (const row of rows) {
      const { rows: [existing] } = await client.query<{ id: string }>('SELECT id FROM "user" WHERE lower(email)=$1', [row.email]);
      const account = existing?.id ?? randomUUID();
      if (!existing) await client.query(`INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ($1,$2,$3,false,now(),now())`,
        [account, row.name, row.email]);
      await client.query(`INSERT INTO membership (institution_id,account_id,role) VALUES ($1,$2,'faculty')
        ON CONFLICT (institution_id,account_id,role,department_id) DO UPDATE SET ended_at=NULL`, [scope.institution, account]);
      for (const offering of row.offerings ?? []) await client.query(`INSERT INTO roster (institution_id,offering_id,account_id,role) VALUES ($1,$2,$3,'faculty')
        ON CONFLICT (institution_id,offering_id,account_id,role) DO UPDATE SET ended_at=NULL`, [scope.institution, offering, account]);
      for (const section of row.mentor_sections ?? []) await client.query(`INSERT INTO section_mentor (institution_id,section_id,account_id,assigned_by) VALUES ($1,$2,$3,$4)
        ON CONFLICT (institution_id,section_id,account_id) DO NOTHING`, [scope.institution, section, account, scope.account]);
      if (row.phone) await client.query(`INSERT INTO person_detail (institution_id,account_id,phone) VALUES ($1,$2,$3)
        ON CONFLICT (institution_id,account_id) DO UPDATE SET phone=EXCLUDED.phone,updated_at=clock_timestamp()`, [scope.institution, account, row.phone]);
      await audit(client, scope, importId, "roster_import.teacher_added", undefined, account);
    }
    await client.query("UPDATE roster_import SET state='applied',applied_at=clock_timestamp() WHERE institution_id=$1 AND id=$2", [scope.institution, importId]);
    await audit(client, scope, importId, "roster_import.applied");
    return rows.length;
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Student import (office). Columns: name,email,usn,semester,section,phone. Mode "pending" creates sign-up requests that the
// section's teachers check; mode "approved" admits the students directly on the office's authority. Same refusals as
// self sign-up: duplicate USN or email, sections without a switched-on department, students already admitted here.
// ---------------------------------------------------------------------------------------------------------------------
export const STUDENT_COLUMNS = ["name", "email", "usn", "semester", "section", "phone"] as const;
export type StudentRow = { line: number; name: string; email: string; usn: string; semester: number; section: string; phone: string | null; errors: string[];
  section_id?: string; term_id?: string };

async function checkStudents(client: PoolClient | typeof db, scope: Scope, rows: StudentRow[]) {
  const { joinOptions } = await import("./student-admission");
  const options = await joinOptions(scope.institution);
  const emails = new Map<string, number>(), usns = new Map<string, number>();
  for (const row of rows) {
    row.errors = [];
    if (row.name.length < 2 || row.name.length > 120) row.errors.push("Name must be 2–120 characters.");
    if (!emailSchema.safeParse(row.email).success) row.errors.push("Email is not valid.");
    else if (emails.has(row.email)) row.errors.push(`Same email as line ${emails.get(row.email)}.`);
    else emails.set(row.email, row.line);
    if (!/^[A-Z0-9]{6,16}$/.test(row.usn)) row.errors.push("USN must be 6–16 letters or digits.");
    else if (usns.has(row.usn)) row.errors.push(`Same USN as line ${usns.get(row.usn)}.`);
    else usns.set(row.usn, row.line);
    if (!Number.isInteger(row.semester) || row.semester < 1 || row.semester > 10) row.errors.push("Semester must be 1–10.");
    if (row.phone && !/^\+?[0-9 ]{7,16}$/.test(row.phone)) row.errors.push("Phone must be 7–16 digits, optionally starting with +.");
    const open = options.filter(o => o.label.toLowerCase().startsWith(`${row.section.toLowerCase()} · `));
    if (!open.length) row.errors.push(`Section "${row.section}" has no switched-on department.`);
    else { row.section_id = open[0].section_id; row.term_id = open[0].term_id; }
    const { rows: [taken] } = await client.query<{ usn: boolean; admitted: boolean; requested: boolean }>(`SELECT
        EXISTS (SELECT 1 FROM person_detail p JOIN "user" u ON u.id=p.account_id WHERE p.institution_id=$1 AND p.usn=$2 AND lower(u.email)<>$3) AS usn,
        EXISTS (SELECT 1 FROM student_admission a WHERE a.institution_id=$1 AND a.email=$3 AND a.revoked_at IS NULL)
          OR EXISTS (SELECT 1 FROM membership m JOIN "user" u ON u.id=m.account_id WHERE m.institution_id=$1 AND lower(u.email)=$3 AND m.role='student' AND m.ended_at IS NULL) AS admitted,
        EXISTS (SELECT 1 FROM signup_request r WHERE r.institution_id=$1 AND r.state IN ('pending','approved')
          AND (r.usn=$2 OR r.account_id IN (SELECT id FROM "user" WHERE lower(email)=$3))) AS requested`, [scope.institution, row.usn, row.email]);
    if (taken.usn) row.errors.push("This USN already belongs to another student.");
    if (taken.admitted) row.errors.push("This email is already a student here.");
    else if (taken.requested) row.errors.push("This student already has a sign-up request.");
  }
  return rows;
}

export async function previewStudentImport(scope: Scope, csv: unknown, mode: unknown) {
  const text = z.string().max(400_000).parse(csv);
  const chosen = z.enum(["pending", "approved"]).parse(mode);
  await requireAdmin(db, scope);
  const table = parseCsv(text.replace(/^﻿/, ""));
  const header = (table.shift() ?? []).map(h => h.trim().toLowerCase());
  if (STUDENT_COLUMNS.some((c, i) => header[i] !== c)) throw new WorkflowError(`The first line must be: ${STUDENT_COLUMNS.join(",")}`);
  if (!table.length) throw new WorkflowError("The file has no student rows.");
  if (table.length > MAX_ROWS) throw new WorkflowError(`Import at most ${MAX_ROWS} students at a time.`);
  const rows: StudentRow[] = table.map((cells, index) => {
    const [name = "", email = "", usn = "", semester = "", section = "", phone = ""] = cells.map(c => c.trim());
    return { line: index + 2, name, email: email.toLowerCase(), usn: usn.toUpperCase(), semester: Number(semester), section, phone: phone || null, errors: [] };
  });
  await checkStudents(db, scope, rows);
  const { rows: [saved] } = await db.query<{ id: string }>("INSERT INTO roster_import (institution_id,kind,mode,rows,created_by) VALUES ($1,'students',$2,$3,$4) RETURNING id",
    [scope.institution, chosen, JSON.stringify(rows), scope.account]);
  return { id: saved.id, rows };
}

export async function studentImport(scope: Scope, id: unknown) {
  const importId = z.uuid().parse(id);
  await requireAdmin(db, scope);
  return (await db.query<{ id: string; state: string; mode: "pending" | "approved"; rows: StudentRow[] }>(
    "SELECT id,state,mode,rows FROM roster_import WHERE institution_id=$1 AND id=$2 AND kind='students'", [scope.institution, importId])).rows[0] ?? null;
}

export function applyStudentImport(scope: Scope, id: unknown) {
  const importId = z.uuid().parse(id);
  return transaction(async client => {
    await requireAdmin(client, scope, true);
    const { rows: [saved] } = await client.query<{ state: string; mode: "pending" | "approved"; rows: StudentRow[] }>(
      "SELECT state,mode,rows FROM roster_import WHERE institution_id=$1 AND id=$2 AND kind='students' FOR UPDATE", [scope.institution, importId]);
    if (!saved || saved.state !== "previewed") throw new WorkflowError("This import is unavailable or was already applied.");
    const rows = await checkStudents(client, scope, saved.rows.map(r => ({ ...r, errors: [] })));
    if (rows.some(r => r.errors.length)) throw new WorkflowError("Some rows no longer pass the checks. Upload the file again to see why.");
    const { admitStudent } = await import("./student-admission");
    for (const row of rows) {
      const { rows: [existing] } = await client.query<{ id: string }>('SELECT id FROM "user" WHERE lower(email)=$1', [row.email]);
      const account = existing?.id ?? randomUUID();
      if (!existing) await client.query(`INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ($1,$2,$3,false,now(),now())`,
        [account, row.name, row.email]);
      if (saved.mode === "pending") {
        const { rows: [request] } = await client.query<{ id: string }>(`INSERT INTO signup_request (institution_id,account_id,name,usn,semester,section_id,term_id,phone)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [scope.institution, account, row.name, row.usn, row.semester, row.section_id, row.term_id, row.phone]);
        await audit(client, scope, request.id, "roster_import.student_requested", undefined, account);
      } else {
        const admission = await admitStudent(client, { institution: scope.institution, account, email: row.email, section: row.section_id!, term: row.term_id!,
          approvedBy: scope.account, usn: row.usn, semester: row.semester, phone: row.phone });
        await audit(client, scope, admission.id, "roster_import.student_admitted", undefined, account);
      }
    }
    await client.query("UPDATE roster_import SET state='applied',applied_at=clock_timestamp() WHERE institution_id=$1 AND id=$2", [scope.institution, importId]);
    await audit(client, scope, importId, "roster_import.applied");
    return rows.length;
  });
}
