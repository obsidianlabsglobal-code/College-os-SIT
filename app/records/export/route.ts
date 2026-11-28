import { scope } from "../../../lib/scope";
import { executiveReport, facultyReport, studentRecord } from "../../../lib/exports";

// SA-022 / FC-028 / LE-019: private CSV downloads of the caller's own records. Other roles get 404.
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const current = await scope(query.get("institution"), query.get("role"));
  const body = current.role === "student" ? await studentRecord(current) : current.role === "faculty" ? await facultyReport(current)
    : current.role === "principal" ? await executiveReport(current, query.get("from") && query.get("to") ? { from: query.get("from")!, to: query.get("to")! } : undefined) : null;
  if (body === null) return new Response(null, { status: 404 });
  const name = { student: "academic-record", faculty: "teaching-report", principal: "executive-report" }[current.role as "student"];
  return new Response(body, { headers: {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
  } });
}
