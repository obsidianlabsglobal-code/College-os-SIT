"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { scope, workspaceQuery } from "../../lib/scope";

export async function chooseWorkspace(form: FormData) {
  const value = form.get("workspace");
  const selected = new URLSearchParams(typeof value === "string" ? value : "");
  const current = await scope(selected.get("institution"), selected.get("role"));
  const query = workspaceQuery(current);
  (await cookies()).set("nexus_workspace", query, { httpOnly: true, sameSite: "lax", secure: process.env.BETTER_AUTH_URL?.startsWith("https:"), path: "/", maxAge: 30 * 86400 });
  redirect(`/?${query}`);
}
