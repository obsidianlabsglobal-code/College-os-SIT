import { z } from "zod";
import { audit, WorkflowError } from "./assignments";
import { db, transaction } from "./db";
import type { Scope } from "./scope";

// SL-010 / SL-011: a member's own display, discovery and in-app notification choices for one institution.
export const notificationKinds = ["assignment", "reminder", "result", "class", "correction", "case", "attendance", "request", "followup", "escalation"] as const;
export type Preferences = { large_text: boolean; reduced_motion: boolean; discoverable: boolean; muted_kinds: string[] };
const defaults: Preferences = { large_text: false, reduced_motion: false, discoverable: true, muted_kinds: [] };

export async function preferences(scope: Scope): Promise<Preferences> {
  return (await db.query<Preferences>("SELECT large_text,reduced_motion,discoverable,muted_kinds FROM account_preference WHERE institution_id=$1 AND account_id=$2",
    [scope.institution, scope.account])).rows[0] ?? defaults;
}

const input = z.object({ large_text: z.boolean(), reduced_motion: z.boolean(), discoverable: z.boolean(), muted_kinds: z.array(z.enum(notificationKinds)).max(notificationKinds.length) });
export function savePreferences(scope: Scope, raw: unknown) {
  const value = input.parse(raw);
  return transaction(async client => {
    const { rowCount } = await client.query(`INSERT INTO account_preference (institution_id,account_id,large_text,reduced_motion,discoverable,muted_kinds)
      SELECT $1,$2,$3,$4,$5,$6 WHERE EXISTS (SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role=$7 AND ended_at IS NULL)
      ON CONFLICT (institution_id,account_id) DO UPDATE SET large_text=EXCLUDED.large_text,reduced_motion=EXCLUDED.reduced_motion,
        discoverable=EXCLUDED.discoverable,muted_kinds=EXCLUDED.muted_kinds,updated_at=clock_timestamp()`,
    [scope.institution, scope.account, value.large_text, value.reduced_motion, value.discoverable, [...new Set(value.muted_kinds)], scope.role]);
    if (!rowCount) throw new WorkflowError("This action is unavailable.");
    await audit(client, scope, scope.institution, "preferences.updated", undefined, scope.account);
  });
}
