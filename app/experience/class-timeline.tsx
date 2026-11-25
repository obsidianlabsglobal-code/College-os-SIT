import Link from "next/link";
import { timetable } from "../../lib/academic-day";
import { workspaceQuery, type Scope } from "../../lib/scope";
import { Icon } from "./workspace-icon";

export async function ClassTimeline({current, timezone}: {current: Scope; timezone: string}) {
  const now = new Date();
  const day = new Intl.DateTimeFormat("sv-SE", {dateStyle:"short",timeZone:timezone}).format(now);
  const clock = new Intl.DateTimeFormat("en-IN", {timeStyle:"short",timeZone:timezone});
  const sessions = (await timetable(current,day,1)).filter(session => session.state !== "cancelled");
  const schedule = `/timetable?${workspaceQuery(current)}&day=${day}&view=day`;
  return <section className="panel day-timeline" aria-label="Today's classes">
    <div className="row spread"><h2><Icon name="calendar" />Today’s classes</h2><Link href={schedule}>Day view</Link></div>
    {sessions.length === 0 ? <p className="meta">No classes scheduled for today.</p> :
      <ol>{sessions.map(session => <li key={session.id}>
        <time dateTime={session.start.toISOString()}>{clock.format(session.start)}</time>
        <div><Link href={`${schedule}&session=${session.id}#class-details`}>{session.course}</Link>
          <p className="meta">{session.room} · {session.state === "conducted" ? "Attendance recorded" :
            session.finish <= now ? "Ended" : session.start <= now ? "In progress" : "Upcoming"}</p></div>
      </li>)}</ol>}
    <small className="meta">{timezone}</small>
  </section>;
}
