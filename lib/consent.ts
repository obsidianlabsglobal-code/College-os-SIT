import { z } from "zod";
import { audit, WorkflowError } from "./assignments";
import { db, transaction } from "./db";
import type { Scope } from "./scope";

// Pilot privacy notice. The wording is a draft until the college approves it; change the version whenever the text
// changes, and every member is asked again. Institutions that require consent block their workspaces until accepted.
export const NOTICE = {
  version: "2026-11-28",
  title: "How NEXUS uses your information",
  points: [
    "What we keep: your name, USN, email, phone number and bus stop, plus the college records you already have here (classes, attendance, assignments, requests).",
    "Buses: only the bus is tracked, only during its trips, from the driver's phone. NEXUS never collects your location.",
    "Bus positions are deleted after 7 days.",
    "Who sees what: your teachers and the college office see what their work needs. Other students do not see your details.",
    "Questions or to stop using NEXUS: contact the college's pilot coordinator through the office. The bus runs as usual if you do not use NEXUS.",
  ],
} as const;

/** True when the member's institution requires consent and they have not accepted the current notice. */
export async function consentNeeded(scope: Scope) {
  const { rows: [row] } = await db.query<{ needed: boolean }>(`SELECT i.consent_required AND NOT EXISTS (SELECT 1 FROM consent_record c
      WHERE c.institution_id=i.id AND c.account_id=$2 AND c.notice_version=$3) AS needed FROM institution i WHERE i.id=$1`,
  [scope.institution, scope.account, NOTICE.version]);
  return !!row?.needed;
}

export function acceptNotice(scope: Scope, version: unknown) {
  if (z.string().parse(version) !== NOTICE.version) throw new WorkflowError("The notice changed. Read the current version and accept again.");
  return transaction(async client => {
    const { rowCount } = await client.query("SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role=$3 AND ended_at IS NULL FOR SHARE",
      [scope.institution, scope.account, scope.role]);
    if (!rowCount) throw new WorkflowError("This workspace is unavailable.");
    const added = await client.query("INSERT INTO consent_record (institution_id,account_id,notice_version) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
      [scope.institution, scope.account, NOTICE.version]);
    if (added.rowCount) await audit(client, scope, scope.institution, "consent.accepted", undefined, scope.account);
  });
}

/** The office: whether consent is required, and current members who have not accepted the current notice. */
export async function consentStatus(scope: Scope) {
  if (scope.role !== "admin") return null;
  const { rows: [inst] } = await db.query<{ required: boolean }>(`SELECT i.consent_required AS required FROM institution i
    WHERE i.id=$1 AND EXISTS (SELECT 1 FROM membership m WHERE m.institution_id=$1 AND m.account_id=$2 AND m.role='admin' AND m.ended_at IS NULL)`,
  [scope.institution, scope.account]);
  if (!inst) return null;
  const { rows: missing } = await db.query<{ name: string; email: string; roles: string }>(`SELECT u.name,u.email,string_agg(DISTINCT m.role,', ') AS roles
    FROM membership m JOIN "user" u ON u.id=m.account_id
    WHERE m.institution_id=$1 AND m.ended_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM consent_record c WHERE c.institution_id=$1 AND c.account_id=m.account_id AND c.notice_version=$2)
    GROUP BY u.name,u.email ORDER BY u.name LIMIT 500`, [scope.institution, NOTICE.version]);
  return { required: inst.required, version: NOTICE.version, missing };
}

export function setConsentRequired(scope: Scope, raw: unknown) {
  const required = z.boolean().parse(raw);
  return transaction(async client => {
    const { rowCount } = await client.query("SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role='admin' AND ended_at IS NULL FOR SHARE",
      [scope.institution, scope.account]);
    if (scope.role !== "admin" || !rowCount) throw new WorkflowError("This action is unavailable.");
    await client.query("UPDATE institution SET consent_required=$2 WHERE id=$1", [scope.institution, required]);
    await audit(client, scope, scope.institution, required ? "consent.required_on" : "consent.required_off");
  });
}
