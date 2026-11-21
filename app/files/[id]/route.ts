import { z } from "zod";
import { scope } from "../../../lib/scope";
import { files } from "../../../lib/assignments";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const query = new URL(request.url).searchParams;
  const assignment = query.get("assignment");
  if (!assignment || !z.uuid().safeParse(assignment).success || !z.uuid().safeParse(id).success) {
    return new Response(null, { status: 404 });
  }
  const current = await scope(query.get("institution"), query.get("role"));
  const [file] = await files(current, assignment, id);
  if (!file?.bytes) return new Response(null, { status: 404 });
  const filename = encodeURIComponent(file.filename).replace(/['()*]/g, value => "%" + value.charCodeAt(0).toString(16));
  return new Response(new Uint8Array(file.bytes), { headers: {
    "Content-Type": file.mime,
    "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
  } });
}
