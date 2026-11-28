import type { PoolClient } from "pg";
import { z } from "zod";
import { audit, WorkflowError } from "./assignments";
import { db, transaction } from "./db";
import type { Scope } from "./scope";

// SL-015: support services published by the office for every current member; withdrawn services disappear from the directory.
export const serviceCategories = ["accessibility", "counselling", "health", "financial", "academic", "safety"] as const;
export type SupportService = { id: string; category: (typeof serviceCategories)[number]; name: string; description: string; contact: string; hours: string };

export async function supportServices(scope: Scope, category?: string) {
  const chosen = serviceCategories.find(c => c === category) ?? null;
  return (await db.query<SupportService>(`SELECT s.id,s.category,s.name,s.description,s.contact,s.hours FROM support_service s
    WHERE s.institution_id=$1 AND s.withdrawn_at IS NULL AND ($4::text IS NULL OR s.category=$4)
      AND EXISTS (SELECT 1 FROM membership m WHERE m.institution_id=s.institution_id AND m.account_id=$2 AND m.role=$3 AND m.ended_at IS NULL)
    ORDER BY s.category,s.name`, [scope.institution, scope.account, scope.role, chosen])).rows;
}

const text = (max: number) => z.string().trim().min(1).max(max);
const serviceInput = z.object({ category: z.enum(serviceCategories), name: text(120), description: text(1000), contact: text(200), hours: text(120) });
const requireAdmin = async (client: PoolClient, scope: Scope) => {
  const { rowCount } = await client.query("SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role='admin' AND ended_at IS NULL FOR SHARE",
    [scope.institution, scope.account]);
  if (scope.role !== "admin" || !rowCount) throw new WorkflowError("This action is unavailable.");
};

export function publishService(scope: Scope, raw: unknown) {
  const value = serviceInput.parse(raw);
  return transaction(async client => {
    await requireAdmin(client, scope);
    const { rows: [row] } = await client.query<{ id: string }>(`INSERT INTO support_service (institution_id,category,name,description,contact,hours,created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [scope.institution, value.category, value.name, value.description, value.contact, value.hours, scope.account]);
    await audit(client, scope, row.id, "support_service.published");
    return row.id;
  });
}

export function withdrawService(scope: Scope, id: unknown) {
  const service = z.uuid().parse(id);
  return transaction(async client => {
    await requireAdmin(client, scope);
    const { rowCount } = await client.query("UPDATE support_service SET withdrawn_at=clock_timestamp() WHERE institution_id=$1 AND id=$2 AND withdrawn_at IS NULL",
      [scope.institution, service]);
    if (!rowCount) throw new WorkflowError("This service is unavailable or already withdrawn.");
    await audit(client, scope, service, "support_service.withdrawn");
  });
}
