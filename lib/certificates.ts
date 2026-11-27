import { randomBytes } from "node:crypto";
import { z } from "zod";
import { audit, WorkflowError } from "./assignments";
import { db, transaction } from "./db";
import type { Scope } from "./scope";

// AD-011 / AD-012: certificates drafted from current records (with the source records listed), issued by an
// administrator with a verification code, and revocable with a reason. Students see only issued certificates.
const unavailable = () => new WorkflowError("This action is unavailable.");
export type CertificateKind = "bonafide" | "attendance" | "results";
export const kindLabel: Record<CertificateKind, string> = { bonafide: "Bonafide (enrollment)", attendance: "Attendance", results: "Published results" };
const admin = `EXISTS (SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role='admin' AND ended_at IS NULL)`;

async function compose(institution: string, student: string, kind: CertificateKind) {
  const { rows: [who] } = await db.query<{ name: string; institution: string; today: string }>(`SELECT u.name,i.name AS institution,
      to_char(clock_timestamp() AT TIME ZONE i.timezone,'DD Mon YYYY') AS today FROM "user" u, institution i WHERE u.id=$2 AND i.id=$1`, [institution, student]);
  const { rows: offerings } = await db.query<{ id: string; label: string }>(`SELECT o.id,c.name||' · '||s.name||' · '||t.name||' · '||sc.name AS label
    FROM roster r JOIN offering o ON (o.institution_id,o.id)=(r.institution_id,r.offering_id) JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id)
    JOIN section s ON (s.institution_id,s.id)=(o.institution_id,o.section_id) JOIN academic_term t ON (t.institution_id,t.id)=(o.institution_id,o.term_id)
    JOIN academic_scheme sc ON (sc.institution_id,sc.id)=(t.institution_id,t.scheme_id)
    WHERE r.institution_id=$1 AND r.account_id=$2 AND r.role='student' AND r.ended_at IS NULL ORDER BY label`, [institution, student]);
  if (!offerings.length) throw new WorkflowError("This student has no current enrollment to certify.");
  const header = `${who.institution}\n${kindLabel[kind]} certificate · ${who.today}\n\nThis is to certify that ${who.name}`;
  if (kind === "bonafide") return { body: `${header} is a current student enrolled in:\n${offerings.map(o => `• ${o.label}`).join("\n")}`,
    sources: offerings.map(o => `offering:${o.id}`) };
  if (kind === "attendance") {
    const { rows } = await db.query<{ offering: string; present: number; marked: number; sessions: string[] }>(`SELECT cs.offering_id AS offering,
        count(*) FILTER (WHERE m.status='present')::int AS present,count(*)::int AS marked,array_agg(cs.id::text||' r'||m.revision) AS sessions
      FROM class_session cs JOIN class_attendance_mark m ON (m.institution_id,m.session_id)=(cs.institution_id,cs.id) AND m.student_id=$2
      WHERE cs.institution_id=$1 AND cs.offering_id=ANY($3) AND cs.state='conducted'
        AND m.revision=(SELECT max(revision) FROM class_attendance_revision v WHERE (v.institution_id,v.session_id)=(cs.institution_id,cs.id))
      GROUP BY cs.offering_id`, [institution, student, offerings.map(o => o.id)]);
    return { body: `${header} has the following recorded attendance (each class's latest record):\n${offerings.map(o => {
        const r = rows.find(x => x.offering === o.id);
        return `• ${o.label}: ${r ? `${r.present} of ${r.marked} classes (${(100 * r.present / r.marked).toFixed(1)}%)` : "no recorded classes"}`; }).join("\n")}`,
      sources: rows.flatMap(r => r.sessions.map(x => `class_session:${x}`)) };
  }
  const { rows } = await db.query<{ id: string; title: string; course: string; marks: number; max_marks: number; revision: number }>(`SELECT DISTINCT ON (s.id) a.id,a.title,c.name AS course,
      g.marks,a.max_marks,g.revision FROM submission s JOIN assignment a ON (a.institution_id,a.id)=(s.institution_id,s.assignment_id)
    JOIN offering o ON (o.institution_id,o.id)=(a.institution_id,a.offering_id) JOIN course c ON (c.institution_id,c.id)=(o.institution_id,o.course_id)
    JOIN grade g ON (g.institution_id,g.submission_id)=(s.institution_id,s.id) AND g.published_at IS NOT NULL
    WHERE s.institution_id=$1 AND s.student_id=$2 AND a.offering_id=ANY($3) ORDER BY s.id,g.revision DESC`, [institution, student, offerings.map(o => o.id)]);
  return { body: `${header} has these published results:\n${rows.length ? rows.map(r => `• ${r.course} · ${r.title}: ${r.marks}/${r.max_marks}`).join("\n") : "• none published yet"}`,
    sources: rows.map(r => `assignment:${r.id} grade r${r.revision}`) };
}

export type Certificate = { id: string; student: string; kind: CertificateKind; body: string; sources: string[]; state: "draft" | "issued" | "revoked";
  drafted_at: Date; issued_at: Date | null; verification_code: string | null; revoke_reason: string | null };
export async function certificates(scope: Scope) {
  const where = scope.role === "admin" ? admin : scope.role === "student"
    ? `k.student_id=$2 AND k.state<>'draft' AND EXISTS (SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role='student' AND ended_at IS NULL)` : null;
  if (!where) return [];
  return (await db.query<Certificate>(`SELECT k.id,u.name AS student,k.kind,k.body,k.sources,k.state,k.drafted_at,k.issued_at,k.verification_code,k.revoke_reason
    FROM certificate k JOIN "user" u ON u.id=k.student_id WHERE k.institution_id=$1 AND ${where} ORDER BY k.drafted_at DESC LIMIT 100`,
  [scope.institution, scope.account])).rows;
}

export async function certificateStudents(scope: Scope) {
  if (scope.role !== "admin") return [];
  return (await db.query<{ id: string; name: string }>(`SELECT DISTINCT u.id,u.name FROM membership m JOIN "user" u ON u.id=m.account_id
    WHERE m.institution_id=$1 AND m.role='student' AND m.ended_at IS NULL AND ${admin} ORDER BY u.name`, [scope.institution, scope.account])).rows;
}

const draftInput = z.object({ student: z.string().min(1).max(100), kind: z.enum(["bonafide", "attendance", "results"]) });
export async function draftCertificate(scope: Scope, raw: unknown) {
  const input = draftInput.parse(raw);
  if (scope.role !== "admin") throw unavailable();
  const { rows: [ok] } = await db.query<{ admin: boolean; student: boolean }>(`SELECT ${admin} AS admin,
    EXISTS (SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$3 AND role='student' AND ended_at IS NULL) AS student`,
  [scope.institution, scope.account, input.student]);
  if (!ok.admin) throw unavailable();
  if (!ok.student) throw new WorkflowError("Choose a current student.");
  const { body, sources } = await compose(scope.institution, input.student, input.kind);
  return transaction(async client => {
    const { rows: [row] } = await client.query<{ id: string }>(`INSERT INTO certificate (institution_id,student_id,kind,body,sources,drafted_by)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [scope.institution, input.student, input.kind, body, JSON.stringify(sources), scope.account]);
    await audit(client, scope, row.id, "certificate.drafted", undefined, input.student);
    return row.id;
  });
}

export function issueCertificate(scope: Scope, id: unknown) {
  const certificate = z.uuid().parse(id);
  if (scope.role !== "admin") throw unavailable();
  const code = randomBytes(6).toString("hex").toUpperCase();
  return transaction(async client => {
    const { rowCount } = await client.query(`UPDATE certificate SET state='issued',issued_by=$2,issued_at=clock_timestamp(),verification_code=$4
      WHERE institution_id=$1 AND id=$3 AND state='draft' AND ${admin}`, [scope.institution, scope.account, certificate, code]);
    if (!rowCount) throw new WorkflowError("This certificate is not a draft.");
    await audit(client, scope, certificate, "certificate.issued");
    return code;
  });
}

export function revokeCertificate(scope: Scope, raw: unknown) {
  const input = z.object({ certificate: z.uuid(), reason: z.string().trim().min(1).max(500) }).parse(raw);
  if (scope.role !== "admin") throw unavailable();
  return transaction(async client => {
    const { rowCount } = await client.query(`UPDATE certificate SET state='revoked',revoked_at=clock_timestamp(),revoke_reason=$4
      WHERE institution_id=$1 AND id=$3 AND state='issued' AND ${admin}`, [scope.institution, scope.account, input.certificate, input.reason]);
    if (!rowCount) throw new WorkflowError("Only an issued certificate can be revoked.");
    await audit(client, scope, input.certificate, "certificate.revoked");
  });
}

/** Public verification by code. Shows what a verifier needs and nothing more: type, institution, holder initials, status. */
export async function verifyCertificate(code: string) {
  if (!/^[0-9A-F]{12}$/.test(code)) return null;
  const { rows: [row] } = await db.query<{ kind: CertificateKind; institution: string; holder: string; issued_on: string; state: string }>(`SELECT k.kind,i.name AS institution,
      regexp_replace(u.name,'(\\S)\\S*','\\1.','g') AS holder,to_char(k.issued_at AT TIME ZONE i.timezone,'DD Mon YYYY') AS issued_on,k.state
    FROM certificate k JOIN institution i ON i.id=k.institution_id JOIN "user" u ON u.id=k.student_id WHERE k.verification_code=$1`, [code]);
  return row ?? null;
}
