import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { z } from "zod";
import { WorkflowError } from "./assignments";
import { db } from "./db";
import type { Scope } from "./scope";

// Phone notifications without a dependency and without sending content to push services: NEXUS stores the message,
// then sends an empty Web Push "wake-up" signed with VAPID (RFC 8292). The service worker fetches the member's own unread
// messages from /api/push with their session (public/sw.js). Keys: NEXUS_PUSH_PUBLIC_KEY (base64url, 65-byte uncompressed
// P-256 point), NEXUS_PUSH_PRIVATE_KEY (base64url, 32 bytes), NEXUS_PUSH_SUBJECT (mailto: or https: contact).

export const pushPublicKey = () => process.env.NEXUS_PUSH_PUBLIC_KEY || null;

const b64 = (value: Buffer) => value.toString("base64url");
/** A VAPID Authorization header value for one push service origin, valid for 12 hours. */
export function vapidAuthorization(endpoint: string, keys = { publicKey: process.env.NEXUS_PUSH_PUBLIC_KEY, privateKey: process.env.NEXUS_PUSH_PRIVATE_KEY,
  subject: process.env.NEXUS_PUSH_SUBJECT }, now = Date.now()) {
  if (!keys.publicKey || !keys.privateKey || !keys.subject) throw new Error("Push keys are not configured.");
  const point = Buffer.from(keys.publicKey, "base64url");
  if (point.length !== 65 || point[0] !== 4) throw new Error("NEXUS_PUSH_PUBLIC_KEY must be an uncompressed P-256 point.");
  const key = createPrivateKey({ key: { kty: "EC", crv: "P-256", d: keys.privateKey, x: b64(point.subarray(1, 33)), y: b64(point.subarray(33)) }, format: "jwk" });
  const header = b64(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64(Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: keys.subject })));
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${header}.${claims}.${b64(signature)}, k=${keys.publicKey}`;
}

/** Verifies a VAPID token with the public key; used by tests and by operators checking a key pair. */
export function verifyVapid(authorization: string, publicKey: string) {
  const [, token, key] = authorization.match(/^vapid t=([^,]+), k=(.+)$/) ?? [];
  if (!token || key !== publicKey) return false;
  const [header, claims, signature] = token.split(".");
  const point = Buffer.from(publicKey, "base64url");
  const verifier = createPublicKey({ key: { kty: "EC", crv: "P-256", x: b64(point.subarray(1, 33)), y: b64(point.subarray(33)) }, format: "jwk" });
  return verify("sha256", Buffer.from(`${header}.${claims}`), { key: verifier, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"));
}

const subscriptionInput = z.object({ endpoint: z.url({ protocol: /^https$/ }).max(1000) });
/** The member's browser subscribed; stored per institution and account. */
export async function savePushSubscription(scope: Scope, raw: unknown) {
  const { endpoint } = subscriptionInput.parse(raw);
  const { rowCount } = await db.query("SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role=$3 AND ended_at IS NULL",
    [scope.institution, scope.account, scope.role]);
  if (!rowCount) throw new WorkflowError("Notifications are unavailable for this workspace.");
  await db.query("INSERT INTO push_subscription (institution_id,account_id,endpoint) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
    [scope.institution, scope.account, endpoint]);
}

export async function removePushSubscriptions(scope: Scope) {
  await db.query("DELETE FROM push_subscription WHERE institution_id=$1 AND account_id=$2", [scope.institution, scope.account]);
}

export type PushNote = { title: string; body: string; url: string };
type Fetcher = (url: string, init: { method: string; headers: Record<string, string> }) => Promise<{ status: number }>;

/** Queue a message for each account and wake their phones. Callers decide who may receive it (e.g. riders of one route).
 * Returns how many phones were woken. Gone subscriptions (404/410) are removed; other failures leave the message for the
 * in-app view, which reads the same queue. */
export async function sendPush(institution: string, accounts: string[], note: PushNote, fetcher: Fetcher = fetch as unknown as Fetcher) {
  const message = z.object({ title: z.string().trim().min(1).max(120), body: z.string().max(300), url: z.string().regex(/^\/[^/]/).max(300) }).parse(note);
  if (!accounts.length) return 0;
  await db.query(`INSERT INTO push_message (institution_id,account_id,title,body,url) SELECT $1,a,$3,$4,$5 FROM unnest($2::text[]) a`,
    [institution, accounts, message.title, message.body, message.url]);
  if (!pushPublicKey()) return 0;
  const { rows } = await db.query<{ account_id: string; endpoint: string }>(
    "SELECT account_id,endpoint FROM push_subscription WHERE institution_id=$1 AND account_id=ANY($2)", [institution, accounts]);
  let woken = 0;
  for (const row of rows) {
    try {
      const response = await fetcher(row.endpoint, { method: "POST", headers: { Authorization: vapidAuthorization(row.endpoint), TTL: "300", Urgency: "high", "Content-Length": "0" } });
      if (response.status === 404 || response.status === 410) await db.query("DELETE FROM push_subscription WHERE institution_id=$1 AND account_id=$2 AND endpoint=$3",
        [institution, row.account_id, row.endpoint]);
      else if (response.status < 300) woken++;
    } catch { /* network failure: the message stays unread for the in-app view */ }
  }
  return woken;
}

/** The member's unread messages, oldest first, marked as fetched. Used by the service worker and by in-app banners. */
export async function takePushMessages(scope: Scope) {
  return (await db.query<PushNote & { id: string; created_at: Date }>(`UPDATE push_message p SET fetched_at=clock_timestamp()
    WHERE p.institution_id=$1 AND p.account_id=$2 AND p.fetched_at IS NULL AND p.created_at > clock_timestamp()-interval '1 day'
      AND EXISTS (SELECT 1 FROM membership m WHERE m.institution_id=$1 AND m.account_id=$2 AND m.ended_at IS NULL)
    RETURNING p.id,p.title,p.body,p.url,p.created_at`, [scope.institution, scope.account])).rows.sort((a, b) => +a.created_at - +b.created_at);
}

/** Unread messages across every institution the account belongs to (the service worker does not know the workspace). */
export async function takeAllPushMessages(account: string) {
  return (await db.query<PushNote & { id: string }>(`UPDATE push_message p SET fetched_at=clock_timestamp()
    WHERE p.account_id=$1 AND p.fetched_at IS NULL AND p.created_at > clock_timestamp()-interval '1 day'
      AND EXISTS (SELECT 1 FROM membership m WHERE m.institution_id=p.institution_id AND m.account_id=$1 AND m.ended_at IS NULL)
    RETURNING p.id,p.title,p.body,p.url`, [account])).rows;
}
