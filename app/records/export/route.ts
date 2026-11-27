import { scope } from "../../../lib/scope";
import { facultyReport, studentRecord } from "../../../lib/exports";

// SA-022 / FC-028: private CSV downloads of the caller's own records. Other roles get 404.
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const current = await scope(query.get("institution"), query.get("role"));
  const body = current.role === "student" ? await studentRecord(current) : current.role === "faculty" ? await facultyReport(current) : null;
  if (body === null) return new Response(null, { status: 404 });
  const name = current.role === "student" ? "academic-record" : "teaching-report";
  return new Response(body, { headers: {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
  } });
}
