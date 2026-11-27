import "./environment";
import { hostname } from "node:os";
import { runJobs } from "../lib/automation";
import { db } from "../lib/db";

// Durable worker: polls the job table, so work survives browser closure, deploys and crashes (leases expire and are re-claimed).
const worker = `${hostname()}:${process.pid}`, idleMs = Number(process.env.NEXUS_WORKER_IDLE_MS ?? 2000);
let running = true;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { running = false; });
while (running) {
  const summary = await runJobs({ worker }).catch(error => { console.error("Worker poll failed", { code: error.code ?? "unknown" }); return null; });
  if (summary && Object.values(summary).some(Boolean)) console.log(new Date().toISOString(), summary);
  if (process.argv.includes("--once")) break;
  await new Promise(resolve => setTimeout(resolve, idleMs));
}
await db.end();
