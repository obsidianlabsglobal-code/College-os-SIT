import { databaseConnection } from "./database-target";
import { Pool, type PoolClient } from "pg";

export const db = new Pool({ connectionString: databaseConnection(process.env.NEXUS_DB_ROLE === "worker" ? "worker" : "runtime"), connectionTimeoutMillis: 2500, statement_timeout: 5000 });

export async function transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const value = await run(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
