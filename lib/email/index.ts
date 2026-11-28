import { db } from "../db";

// One mail adapter for the app. Only the console adapter exists until the founder approves a provider and a sending
// domain; it logs to the server console and stores the message in dev_mailbox for local use and tests. Anywhere else,
// sending refuses rather than silently dropping sign-in codes.
export type Mail = { to: string; subject: string; text: string };

/** The console adapter is allowed only against a local database or the fictional pilot, never a real deployment. */
export function mailConfigured() {
  if ((process.env.NEXUS_MAIL_PROVIDER ?? "console") !== "console") return false;
  const host = (() => { try { return new URL(process.env.DATABASE_URL ?? "").hostname; } catch { return ""; } })();
  return ["127.0.0.1", "localhost"].includes(host) || process.env.NEXUS_FICTIONAL_PILOT === "true";
}

export async function sendMail(mail: Mail) {
  const provider = process.env.NEXUS_MAIL_PROVIDER ?? "console";
  if (provider !== "console") throw new Error(`Mail provider "${provider}" is not set up yet.`);
  if (!mailConfigured()) throw new Error("Email is not configured for this environment.");
  await db.query("INSERT INTO dev_mailbox (to_email,subject,body) VALUES ($1,$2,$3)", [mail.to, mail.subject, mail.text]);
  console.info(`[mail:console] to=${mail.to} subject=${JSON.stringify(mail.subject)}`);
}
