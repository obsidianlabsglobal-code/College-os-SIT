// covers: ID-004, ID-006
import "../scripts/environment";
import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { db } from "../lib/db";
import { WorkflowError } from "../lib/assignments";
import { removePushSubscriptions, savePushSubscription, sendPush, takeAllPushMessages, takePushMessages, vapidAuthorization, verifyVapid } from "../lib/push";
import { fixtures, demoEmail, personas } from "../scripts/fixtures";
import type { Scope } from "../lib/scope";

const owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
const as = new Map<string, Scope>();
const i = fixtures.institution;
const tag = randomUUID().slice(0, 8);
const endpoint = (n: string) => `https://push.example.invalid/${tag}/${n}`;
const rejects = (run: () => Promise<unknown>) => assert.rejects(async () => run(), (e: unknown) => e instanceof WorkflowError || (e as Error).name === "ZodError");

before(async () => {
  for (const url of [process.env.MIGRATION_DATABASE_URL, process.env.DATABASE_URL]) assert.ok(url && ["127.0.0.1", "localhost"].includes(new URL(url).hostname));
  for (const [alias, [, , role]] of Object.entries(personas)) {
    const { rows: [row] } = await owner.query('SELECT id FROM "user" WHERE email=$1', [demoEmail(alias)]);
    as.set(alias, { account: row.id, role, institution: alias === "tenant" ? fixtures.otherInstitution : fixtures.institution });
  }
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = privateKey.export({ format: "jwk" });
  process.env.NEXUS_PUSH_PUBLIC_KEY = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, "base64url"), Buffer.from(jwk.y!, "base64url")]).toString("base64url");
  process.env.NEXUS_PUSH_PRIVATE_KEY = jwk.d!;
  process.env.NEXUS_PUSH_SUBJECT = "mailto:pilot@nexus.example.invalid";
});
after(async () => {
  await owner.query("DELETE FROM push_subscription WHERE endpoint LIKE $1", [`https://push.example.invalid/${tag}/%`]);
  await owner.query("DELETE FROM push_message WHERE title LIKE $1", [`% ${tag}`]);
  await Promise.all([db.end(), owner.end()]);
});

test("VAPID tokens are signed for the push service origin and verify with the public key", () => {
  const header = vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", undefined, Date.parse("2026-12-01T00:00:00Z"));
  assert.ok(verifyVapid(header, process.env.NEXUS_PUSH_PUBLIC_KEY!));
  const claims = JSON.parse(Buffer.from(header.split(" t=")[1].split(".")[1], "base64url").toString());
  assert.equal(claims.aud, "https://fcm.googleapis.com");
  assert.equal(claims.exp, Date.parse("2026-12-01T12:00:00Z") / 1000);
  const [token, key] = header.split(", k=");
  const signature = token.split(".")[2];
  const flipped = signature.slice(0, 10) + (signature[10] === "A" ? "B" : "A") + signature.slice(11);
  assert.ok(!verifyVapid(`${token.slice(0, token.length - signature.length)}${flipped}, k=${key}`, process.env.NEXUS_PUSH_PUBLIC_KEY!), "a tampered signature fails");
});

test("members store their own subscriptions; content waits in NEXUS and only an empty signed wake-up is sent", async () => {
  const student = as.get("student")!, faculty = as.get("faculty")!;
  await rejects(() => savePushSubscription(student, { endpoint: "http://push.example.invalid/insecure" }));
  await rejects(() => savePushSubscription({ ...student, role: "admin" }, { endpoint: endpoint("forged") }));
  await savePushSubscription(student, { endpoint: endpoint("asha-phone") });
  await savePushSubscription(student, { endpoint: endpoint("asha-phone") });
  await savePushSubscription(student, { endpoint: endpoint("asha-old-phone") });
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fake = async (url: string, init: { headers: Record<string, string> }) => {
    calls.push({ url, headers: init.headers });
    return { status: url.endsWith("old-phone") ? 410 : 201 };
  };
  const woken = await sendPush(i, [student.account, faculty.account], { title: `Bus 5 minutes away ${tag}`, body: "Route 3 · Hebbal", url: "/transport" }, fake);
  assert.equal(woken, 1);
  assert.deepEqual(calls.map(c => c.url).sort(), [endpoint("asha-old-phone"), endpoint("asha-phone")]);
  for (const c of calls) {
    assert.equal(c.headers["Content-Length"], "0", "no content goes to the push service");
    assert.ok(verifyVapid(c.headers.Authorization, process.env.NEXUS_PUSH_PUBLIC_KEY!));
  }
  const { rows } = await owner.query("SELECT endpoint FROM push_subscription WHERE endpoint LIKE $1", [`https://push.example.invalid/${tag}/%`]);
  assert.deepEqual(rows.map(r => r.endpoint), [endpoint("asha-phone")], "a gone subscription is removed");
  await assert.rejects(() => sendPush(i, [student.account], { title: "x", body: "", url: "https://elsewhere.example" }, fake), { name: "ZodError" });
});

test("each member reads only their own unread messages, once", async () => {
  const student = as.get("student")!, faculty = as.get("faculty")!;
  assert.deepEqual((await takePushMessages({ ...as.get("tenant")!, account: student.account })).filter(m => m.title.endsWith(tag)), [], "another tenant's workspace reads nothing");
  const mine = (await takePushMessages(student)).filter(m => m.title.endsWith(tag));
  assert.deepEqual(mine.map(m => [m.title, m.url]), [[`Bus 5 minutes away ${tag}`, "/transport"]]);
  assert.deepEqual((await takePushMessages(student)).filter(m => m.title.endsWith(tag)), [], "already fetched");
  assert.equal((await takeAllPushMessages(faculty.account)).filter(m => m.title.endsWith(tag)).length, 1, "the teacher had no phone, so the message waits in-app");
  await removePushSubscriptions(student);
  assert.equal(await sendPush(i, [student.account], { title: `After removal ${tag}`, body: "", url: "/transport" }, async () => ({ status: 201 })), 0);
});
