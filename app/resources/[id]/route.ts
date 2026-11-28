import { z } from "zod";
import { scope } from "../../../lib/scope";
import { resourceFile } from "../../../lib/course-delivery";

// SA-018: private course material download. Latest version for readers; ?version= for the course's teachers.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const query = new URL(request.url).searchParams;
  const version = z.coerce.number().int().min(1).max(100000).safeParse(query.get("version") ?? undefined);
  if (!z.uuid().safeParse(id).success || (query.has("version") && !version.success)) return new Response(null, { status: 404 });
  const current = await scope(query.get("institution"), query.get("role"));
  const file = await resourceFile(current, id, version.success ? version.data : undefined);
  if (!file) return new Response(null, { status: 404 });
  const filename = encodeURIComponent(file.filename).replace(/['()*]/g, value => "%" + value.charCodeAt(0).toString(16));
  return new Response(new Uint8Array(file.bytes), { headers: {
    "Content-Type": file.mime,
    "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
  } });
}
