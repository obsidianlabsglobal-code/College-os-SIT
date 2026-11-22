import Link from "next/link";
import type { AssignmentProgress } from "../../lib/faculty";
import { href, plural } from "./format";

/** Submission and evaluation progress for one published assignment, with links into the queue. */
export function ProgressLine({ row, query, links = true }: { row: AssignmentProgress; query: string; links?: boolean }) {
  const queue = (status: string, label: string) => links
    ? <Link href={href("/grading", query, { status, assignment: row.id })}>{label}</Link> : <span>{label}</span>;
  return <p className="progress-line">
    <span>{row.submitted_enrolled} of {plural(row.enrolled, "enrolled student")} submitted</span>
    {row.withdrawn > 0 && <span>+{row.withdrawn} from {row.withdrawn === 1 ? "a student" : "students"} no longer enrolled</span>}
    {row.pending > 0 && queue("pending", `${row.pending} awaiting evaluation`)}
    {row.awaiting > 0 && queue("awaiting", `${row.awaiting} awaiting publication`)}
    {row.submitted > 0 && row.pending === 0 && row.awaiting === 0 && <span>All submitted work is published</span>}
  </p>;
}
