import { existsSync } from "node:fs";
import { resolve } from "node:path";
import EmbeddedPostgres from "embedded-postgres";

async function main() {
  const databaseDir = resolve(process.env.NEXUS_LOCAL_DB_DIR ?? ".nexus-db");
  const postgres = new EmbeddedPostgres({
    databaseDir,
    port: Number(process.env.NEXUS_LOCAL_DB_PORT ?? 55432),
    password: "local-db-only",
    authMethod: "scram-sha-256",
    postgresFlags: ["-h", "127.0.0.1", "-k", ""],
    autoRehydrateSymlinks: true,
    onLog: () => undefined,
  });
  if (!existsSync(resolve(databaseDir, "PG_VERSION"))) await postgres.initialise();
  await postgres.start();
  const client = postgres.getPgClient("postgres", "127.0.0.1");
  try {
    await client.connect();
    if (!(await client.query("SELECT 1 FROM pg_roles WHERE rolname='nexus_app'")).rowCount) {
      await client.query("CREATE ROLE nexus_app LOGIN PASSWORD 'local-app-only'");
    }
    // Least-privilege worker login (grants come from db/018). Migrations create it NOLOGIN when absent.
    await client.query((await client.query("SELECT 1 FROM pg_roles WHERE rolname='nexus_worker'")).rowCount
      ? "ALTER ROLE nexus_worker LOGIN PASSWORD 'local-worker-only'" : "CREATE ROLE nexus_worker LOGIN PASSWORD 'local-worker-only'");
    if (!(await client.query("SELECT 1 FROM pg_database WHERE datname='nexus'")).rowCount) {
      await client.query("CREATE DATABASE nexus");
    }
  } finally {
    await client.end();
  }
  console.log("Local PostgreSQL is ready.");
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => void postgres.stop().catch(console.error));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
