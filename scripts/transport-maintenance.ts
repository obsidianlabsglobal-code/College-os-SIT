// One bounded, retryable run for a scheduler. This entrypoint never uses app or migration credentials.
import "./environment";
import { Client } from "pg";
import { databaseConnection } from "../lib/database-target";

async function main() {
  const client = new Client({
    connectionString: databaseConnection("worker"),
    connectionTimeoutMillis: 2500,
    statement_timeout: 15000,
  });
  try {
    await client.connect();
    const { rows: [result] } = await client.query<{ positions_removed: string; office_messages: string }>(
      "SELECT * FROM public.transport_scheduled_maintenance()",
    );
    console.log(JSON.stringify({
      positionsRemoved: Number(result.positions_removed),
      officeMessages: Number(result.office_messages),
    }));
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error("Transport maintenance failed", { code: error.code ?? "unknown" });
  process.exitCode = 1;
});
