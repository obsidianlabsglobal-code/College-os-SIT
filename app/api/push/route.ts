import { headers } from "next/headers";
import { auth } from "../../../lib/auth";
import { takeAllPushMessages } from "../../../lib/push";

export const dynamic = "force-dynamic";

/** The service worker asks for the signed-in member's unread phone messages after an empty push wakes it. */
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response(null, { status: 401, headers: { "Cache-Control": "no-store" } });
  return Response.json(await takeAllPushMessages(session.user.id), { headers: { "Cache-Control": "no-store" } });
}
