import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { account,scope,workspaceQuery,workspaces } from "../../lib/scope";
import { attendancePercentage,attendanceSummary,nextClass,sessionDetail,timetable,timetableOptions } from "../../lib/academic-day";
import { ActionForm } from "../forms";
import { Chrome } from "../chrome";
import { AttendanceForm } from "./attendance-form";
import { AttendanceForecast } from "./forecast";
import { timetableAction } from "./actions";
import styles from "./timetable.module.css";

export default async function Timetable({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}) {
  const params = await searchParams;
  const [user,current] = await Promise.all([account(),scope(params.institution,params.role)]);
  if (!["student","faculty","admin","hod"].includes(current.role)) notFound();
  const workspace = (await workspaces(user.id)).find(option=>option.id===current.institution && option.role===current.role);
  if (!workspace) notFound();
  const timezone = workspace.timezone;
  const date = new Intl.DateTimeFormat("sv-SE",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"});
  const time = new Intl.DateTimeFormat("en-IN",{timeZone:timezone,hour:"numeric",minute:"2-digit"});
  const today = date.format(new Date());
  const day = z.iso.date().safeParse(params.day).data ?? today;
  const days = params.view==="day" ? 1 : 7;
  const selectedID = z.uuid().safeParse(params.session);
  if (params.session && !selectedID.success) notFound();
  const [sessions,upcoming,summary,options,detail] = await Promise.all([
    timetable(current,day,days),current.role==="faculty" || current.role==="student" ? nextClass(current) : null,
    attendanceSummary(current),timetableOptions(current),selectedID.success ? sessionDetail(current,selectedID.data) : null,
  ]);
  if (selectedID.success && !detail) notFound();
  const query = workspaceQuery(current);
  const base = `/timetable?${query}`;
  const period = `${base}&day=${day}&view=${days===1 ? "day" : "week"}`;
  const offset = (amount:number) => new Date(Date.parse(day)+amount*86400000).toISOString().slice(0,10);
  const sessionLink = (id:string) => `${period}&session=${id}#class-details`;
  const wall = (instant:Date) => {
    const clock = new Intl.DateTimeFormat("en-GB",{timeZone:timezone,hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
    return `${date.format(instant)}T${clock.format(instant)}`;
  };
  const stateLabel = {draft:"Draft",published:"Scheduled",cancelled:"Cancelled",conducted:"Attendance recorded"};
  return <Chrome user={user} current={current} section="/timetable"><div className={styles.page}>
    <header className={styles.hero}><h1>Timetable</h1><p className="meta">Classes and attendance · {timezone}</p></header>
    {upcoming && <section className={`panel ${styles.next}`} aria-labelledby="next-class">
      <h2 id="next-class">{upcoming.start<=new Date() ? "Class in progress" : "Next class"}</h2>
      <Link href={sessionLink(upcoming.id)}>{upcoming.course}</Link>
      <p className="meta">{date.format(upcoming.start)} · {time.format(upcoming.start)} · {upcoming.room}</p>
    </section>}

    <div className={styles.planner}>
      <section className="panel" aria-labelledby="class-schedule">
        <h2 id="class-schedule">Class schedule</h2>
        <nav className="row" aria-label="Timetable period">
          <Link href={`${base}&day=${offset(-days)}&view=${days===1?"day":"week"}`}>Previous {days===1?"day":"week"}</Link>
          <Link href={`${base}&day=${today}&view=day`}>Today</Link>
          <Link href={`${base}&day=${day}&view=${days===1?"week":"day"}`}>{days===1?"Week view":"Day view"}</Link>
          <Link href={`${base}&day=${offset(days)}&view=${days===1?"day":"week"}`}>Next {days===1?"day":"week"}</Link>
        </nav>
        <p className="meta">{day}{days===7 ? ` to ${offset(6)}` : ""}</p>
        {sessions.length ? <ol className={styles.timeline}>{sessions.map(item=><li className={styles.session} key={item.id}>
          <time dateTime={item.start.toISOString()}>{date.format(item.start)}<br/>{time.format(item.start)} – {time.format(item.finish)}</time>
          <div><Link href={sessionLink(item.id)}>{item.course}</Link>
            <p className="meta">{item.section} · {item.room} · {item.teacher}</p>
            <span className="tag">{stateLabel[item.state]}{item.attendance ? ` · ${item.attendance}` : ""}</span>
          </div>
        </li>)}</ol> : <p>No classes in this period.</p>}
      </section>
      {current.role==="admin" && <section className="panel">
        <h2>Draft a weekly series</h2>
        {options.staff.length && options.rooms.length ? <ActionForm action={timetableAction} context={current} operation="draft" label="Create class draft">
          <label>Course and instructor<select name="teaching" required>{options.staff.map(item=><option key={`${item.offering}|${item.faculty}`} value={`${item.offering}|${item.faculty}`}>{item.label}</option>)}</select></label>
          <label>Room<select name="room" required>{options.rooms.map(room=><option key={room.id} value={room.id}>{room.label}</option>)}</select></label>
          <label>First start<input type="datetime-local" name="start" required /></label>
          <label>First end<input type="datetime-local" name="end" required /></label>
          <label>Weekly occurrences<input type="number" min={1} max={16} name="weeks" defaultValue={1} required /></label>
        </ActionForm> : <p>Assign an active instructor and <Link href={`/clubverse/booking?${query}`}>add a campus room</Link> before drafting.</p>}
      </section>}
      {detail && <section className="panel" id="class-details" aria-labelledby="class-detail-title">
        <h2 id="class-detail-title">{detail.row.course} class</h2>
        <p>{date.format(detail.row.start)} · {time.format(detail.row.start)} – {time.format(detail.row.finish)} · {detail.row.room}</p>
        <p className="meta">{stateLabel[detail.row.state]}{detail.row.change_reason ? ` · ${detail.row.change_reason}` : ""}</p>
        {current.role==="student" && detail.row.attendance && <p>Your attendance: {detail.row.attendance}</p>}
        {current.role==="faculty" && detail.row.finish<=new Date() && detail.learners.length>0 &&
          <AttendanceForm key={`${detail.row.id}:${detail.row.revision}`} current={{institution:current.institution,role:current.role}} session={detail.row.id}
            revision={detail.row.revision} learners={detail.learners} correction={detail.row.state==="conducted"} />}
        {current.role==="faculty" && detail.row.state==="published" && (detail.row.finish>new Date() || !detail.learners.length)
          && <p className="meta">{detail.row.finish>new Date() ? "Attendance opens after class ends." : "No active students are rostered for this class."}</p>}
        {current.role==="admin" && (detail.row.state==="draft" || (detail.row.state==="published" && detail.row.start>new Date())) &&
          (detail.row.state==="draft" ? ["publish"] as const : ["move","cancel"] as const).map(operation=><details key={operation} open={operation==="publish"}>
            <summary>{operation==="publish" ? "Publish weekly series" : operation==="move" ? "Move this class" : "Cancel this class"}</summary>
            <ActionForm action={timetableAction} context={current} operation={operation}
              label={operation==="publish" ? "Publish series" : operation==="move" ? "Save new time" : "Cancel class"}>
              <input type="hidden" name="session" value={detail.row.id} /><input type="hidden" name="revision" value={detail.row.revision} />
              {operation==="move" && <><label>New start<input name="start" type="datetime-local" defaultValue={wall(detail.row.start)} required /></label>
                <label>New end<input name="end" type="datetime-local" defaultValue={wall(detail.row.finish)} required /></label></>}
              {operation!=="publish" && <label>Reason<input name="reason" maxLength={500} required /></label>}
            </ActionForm>
          </details>)}
      </section>}
    </div>
    {current.role==="student" && <section id="attendance" className="panel" aria-labelledby="attendance-title">
      <h2 id="attendance-title">My attendance</h2>
      <p className="meta">Present marks divided by classes with a recorded mark for you. Cancelled and unrecorded classes are excluded.</p>
      {summary.length ? <ul className="items">{summary.map(row=><li key={row.offering_id}>
        <h3>{row.course} · {row.term}</h3><p className={styles.rate}>{attendancePercentage(row.present,row.recorded)}%</p>
        <p>{row.present} of {row.recorded} recorded classes attended</p>
        <AttendanceForecast present={row.present} recorded={row.recorded} />
      </li>)}</ul> : <p>No attendance recorded yet.</p>}
    </section>}
  </div></Chrome>;
}
