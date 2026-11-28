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

async function authPost(path: string, body: unknown) {
  const requestHeaders = new Headers(await headers());
  requestHeaders.set("content-type", "application/json");
  requestHeaders.delete("content-length");
  return auth.handler(new Request(new URL(`/api/auth${path}`, process.env.BETTER_AUTH_URL), { method: "POST", headers: requestHeaders, body: JSON.stringify(body) }));
}
const emailInput = (value: FormDataEntryValue | null) => typeof value === "string" && /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(value.trim()) ? value.trim().toLowerCase() : null;

/** Only same-site paths, so a link cannot send people elsewhere after sign-in. */
function safeNext(value: FormDataEntryValue | null) {
  return typeof value === "string" && /^\/(?!\/)[\w\-/?=&%.]*$/.test(value) && value.length < 300 ? value : null;
}

/** AD-002: send a 6-digit sign-in code to an email. The reply never says whether an account exists. */
export async function requestSignInCode(_state: ActionState, form: FormData): Promise<ActionState> {
  const email = emailInput(form.get("email"));
  if (!email) return { error: "Enter a valid email." };
  try {
    const response = await authPost("/email-otp/send-verification-otp", { email, type: "sign-in" });
    if (response.status === 429) return { error: "Too many codes requested. Wait a while and try again." };
    if (!response.ok) return { error: "We could not send a code right now. Try again shortly." };
  } catch {
    return { error: "We could not send a code right now. Try again shortly." };
  }
  const next = safeNext(form.get("next"));
  redirect(`/login/code?email=${encodeURIComponent(email)}${next ? `&next=${encodeURIComponent(next)}` : ""}`);
}

/** AD-002: sign in with the emailed code; it works once and expires in 10 minutes. */
export async function signInWithCode(_state: ActionState, form: FormData): Promise<ActionState> {
  const email = emailInput(form.get("email"));
  const otp = form.get("code");
  if (!email || typeof otp !== "string" || !/^\d{6}$/.test(otp.trim())) return { error: "Enter the 6-digit code from the email." };
  try {
    const response = await authPost("/sign-in/email-otp", { email, otp: otp.trim() });
    if (response.status === 429) return { error: "Too many attempts. Try again shortly." };
    if (!response.ok) return { error: "That code is wrong or has expired. Ask for a new one." };
    await forwardCookies(response);
  } catch {
    return { error: "Sign-in is temporarily unavailable." };
  }
  redirect(safeNext(form.get("next")) ?? "/");
}

export async function signOut() {
  const response = await auth.api.signOut({ headers: await headers(), asResponse: true });
  await forwardCookies(response);
  redirect("/login");
}
