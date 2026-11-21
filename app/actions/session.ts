"use server";

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
    const url = new URL("/api/auth/sign-in/email", process.env.BETTER_AUTH_URL);
    const requestHeaders = new Headers(await headers());
    requestHeaders.set("content-type", "application/json");
    requestHeaders.delete("content-length");
    const response = await auth.handler(new Request(url, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify({ email, password }),
    }));
    if (!response.ok) return { error: response.status === 429 ? "Too many attempts. Try again shortly." : "Sign-in failed. Check your email and password." };
    await forwardCookies(response);
  } catch {
    return { error: "Sign-in is temporarily unavailable." };
  }
  redirect("/");
}

export async function signOut() {
  const response = await auth.api.signOut({ headers: await headers(), asResponse: true });
  await forwardCookies(response);
  redirect("/login");
}
