"use server";

import { APIError } from "better-auth/api";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "../../lib/auth";
import type { ActionState } from "./workflow";

async function forwardCookies(response: Response) {
  const cookieStore = await cookies();
  for (const value of response.headers.getSetCookie()) {
    const { parseSetCookieHeader, toCookieOptions } = await import("better-auth/cookies");
    for (const [name, attributes] of parseSetCookieHeader(value)) {
      cookieStore.set(name, attributes.value, toCookieOptions(attributes));
    }
  }
}

export async function signIn(_state: ActionState, form: FormData): Promise<ActionState> {
  const email = form.get("email");
  const password = form.get("password");
  if (typeof email !== "string" || typeof password !== "string" || email.length > 254 || password.length > 128) {
    return { error: "Enter a valid email and password." };
  }
  try {
    const response = await auth.api.signInEmail({ headers: await headers(), body: { email, password }, asResponse: true });
    if (!response.ok) return { error: response.status === 429 ? "Too many attempts. Try again shortly." : "Sign-in failed. Check your email and password." };
    await forwardCookies(response);
  } catch (error) {
    if (error instanceof APIError) return { error: "Sign-in failed. Check your email and password." };
    return { error: "Sign-in is temporarily unavailable." };
  }
  redirect("/");
}

export async function signOut() {
  const response = await auth.api.signOut({ headers: await headers(), asResponse: true });
  await forwardCookies(response);
  redirect("/login");
}
