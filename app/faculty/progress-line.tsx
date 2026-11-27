import Link from "next/link";
import type { AssignmentProgress } from "../../lib/faculty";
import { href, plural } from "./format";
import { SegmentedBar } from "../experience/segmented-bar";

/** Submission and evaluation progress for one published assignment, with links into the queue. */
export function ProgressLine({ row, query, links = true }: { row: AssignmentProgress; query: string; links?: boolean }) {
  const queue = (status: string, label: string) => links
    ? <Link href={href("/grading", query, { status, assignment: row.id })}>{label}</Link> : <span>{label}</span>;
  const published = Math.max(0, row.submitted - row.pending - row.awaiting);
  return <>
  <SegmentedBar label={`${row.title} progress`} total={row.enrolled + row.withdrawn} rest="not submitted" parts={[
    { label: "published", value: published, tone: 1 },
    { label: "awaiting publication", value: row.awaiting, tone: 2 },
    { label: "awaiting evaluation", value: row.pending, tone: 3 }]} />
  <p className="progress-line">
    <span>{row.submitted_enrolled} of {plural(row.enrolled, "enrolled student")} submitted</span>
    {row.withdrawn > 0 && <span>+{row.withdrawn} from {row.withdrawn === 1 ? "a student" : "students"} no longer enrolled</span>}
    {row.pending > 0 && queue("pending", `${row.pending} awaiting evaluation`)}
    {row.awaiting > 0 && queue("awaiting", `${row.awaiting} awaiting publication`)}
    {row.submitted > 0 && row.pending === 0 && row.awaiting === 0 && <span>All submitted work is published</span>}
  </p>
  </>;
}
