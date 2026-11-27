import "./environment";
import { hostname } from "node:os";
import { Client } from "pg";

// Durable worker. Runs as the least-privilege nexus_worker role (WORKER_DATABASE_URL). Work survives browser closure,
// deploys and crashes: leases expire and are re-claimed. Wakes on pg_notify('nexus_jobs') when a session connection is
// available, and otherwise polls with adaptive back-off (1 s after work, doubling to 30 s when idle).
process.env.NEXUS_DB_ROLE ??= "worker";
const { databaseConnection } = await import("../lib/database-target");
const { runJobs } = await import("../lib/automation");
const { db } = await import("../lib/db");

const worker = `${hostname()}:${process.pid}`;
const [minMs, maxMs] = [Number(process.env.NEXUS_WORKER_MIN_MS ?? 1000), Number(process.env.NEXUS_WORKER_MAX_MS ?? 30000)];
let running = true, wake: () => void = () => undefined, delay = minMs;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { running = false; wake(); });

let listener: Client | null = null;
if (process.env.NEXUS_WORKER_LISTEN !== "false" && !process.argv.includes("--once")) {
  // Transaction-mode poolers do not support LISTEN; the worker then relies on polling alone.
  listener = new Client({ connectionString: databaseConnection(process.env.NEXUS_DB_ROLE === "worker" ? "worker" : "runtime") });
  try {
    await listener.connect();
    await listener.query("LISTEN nexus_jobs");
    listener.on("notification", () => { delay = minMs; wake(); });
    listener.on("error", () => { listener = null; });
  } catch {
    listener = null;
    console.warn("LISTEN unavailable; polling only.");
  }
}

while (running) {
  const summary = await runJobs({ worker }).catch(error => { console.error("Worker poll failed", { code: error.code ?? "unknown" }); return null; });
  const busy = summary !== null && Object.values(summary).some(Boolean);
  if (busy) console.log(new Date().toISOString(), summary);
  if (process.argv.includes("--once")) break;
  delay = busy ? minMs : Math.min(delay * 2, maxMs);
  await new Promise<void>(resolve => { const timer = setTimeout(resolve, delay); wake = () => { clearTimeout(timer); resolve(); }; });
}
await listener?.end().catch(() => undefined);
await db.end();
