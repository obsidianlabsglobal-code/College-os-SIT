import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { z } from "zod";
import { auth } from "./auth";
import { db } from "./db";

export type Role = "student" | "faculty" | "hod" | "admin" | "principal" | "transport" | "driver";
export type Scope = { institution: string; account: string; role: Role };

export async function account() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  return session.user;
}

export async function workspaces(accountId: string) {
  const { rows } = await db.query<{ id: string; name: string; role: Role; timezone: string }>(
    `SELECT DISTINCT i.id,i.name,i.timezone,m.role FROM membership m
     JOIN institution i ON i.id=m.institution_id
     WHERE account_id=$1 AND ended_at IS NULL ORDER BY i.name,m.role`, [accountId],
  );
  return rows;
}

export async function scope(institution: unknown, role: unknown): Promise<Scope> {
  const user = await account();
  const id = z.uuid().safeParse(institution);
  if (!id.success) notFound();
  const workspace = (await workspaces(user.id)).find(row => row.id === id.data && row.role === role);
  if (!workspace) notFound();
  return { institution: workspace.id, account: user.id, role: workspace.role };
}

export function workspaceQuery(scope: Scope) {
  return new URLSearchParams({ institution: scope.institution, role: scope.role }).toString();
}
