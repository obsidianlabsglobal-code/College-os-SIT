import { db } from "../../../lib/db";
import { isReleaseRevision } from "../../../lib/release-revision";

export const dynamic = "force-dynamic";

export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  try {
    await db.query("SELECT 1 FROM service_request LIMIT 1");
    const revision = process.env.NEXUS_BUILD_REVISION;
    return Response.json({ status: "ok", ...(isReleaseRevision(revision) ? { revision } : {}) }, { headers });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503, headers });
  }
}
