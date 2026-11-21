import "./environment";
import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Client } from "pg";

async function main() {
  if (!process.env.MIGRATION_DATABASE_URL) throw new Error("Set MIGRATION_DATABASE_URL.");
  const client = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock(607146)");
    await client.query("CREATE TABLE IF NOT EXISTS schema_migration (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
    for (const name of (await readdir("db")).filter(file => /^\d+_.+\.sql$/.test(file)).sort()) {
      const sql = await readFile(`db/${name}`, "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const { rows: [existing] } = await client.query<{ checksum: string }>("SELECT checksum FROM schema_migration WHERE name=$1", [name]);
      if (existing) {
        if (existing.checksum !== checksum) throw new Error(`Applied migration changed: ${name}`);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migration (name,checksum) VALUES ($1,$2)", [name, checksum]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
      console.log(`Applied ${name}`);
    }
  } finally {
    await client.end();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
