import { recordTransition } from "../experience/record-transition";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { account,scope,workspaceQuery,workspaces } from "../../lib/scope";
import { attendancePercentage,attendanceSummary,campusChangeAlternatives,nextClass,sessionDetail,timetable,timetableOptions,upcomingRoomChanges } from "../../lib/academic-day";
import { ActionForm } from "../forms";
import { Chrome } from "../chrome";
import { AttendanceForm } from "./attendance-form";
import { planningOptions } from "../../lib/attendance-planning";
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
  const days = params.view==="week" ? 7 : 1;
  const selectedID = z.uuid().safeParse(params.session);
  if (params.session && !selectedID.success) notFound();
  const [sessions,upcoming,summary,options,detail,targets] = await Promise.all([
    timetable(current,day,days),current.role==="faculty" || current.role==="student" ? nextClass(current) : null,
    attendanceSummary(current),timetableOptions(current),selectedID.success ? sessionDetail(current,selectedID.data) : null,planningOptions(current),
  ]);
  if (selectedID.success && !detail) notFound();
  const [alternatives,changes] = detail ? await Promise.all([campusChangeAlternatives(current,detail.row.id),upcomingRoomChanges(current,detail.row.id)]) : [[],[]];
  const query = workspaceQuery(current);
  const base = `/timetable?${query}`;
  const period = `${base}&day=${day}&view=${days===1 ? "day" : "week"}`;
  const offset = (amount:number) => new Date(Date.parse(day)+amount*86400000).toISOString().slice(0,10);
  const sessionLink = (id:string) => `${period}&session=${id}#class-details`;
  const wall = (instant:Date) => {
    const clock = new Intl.DateTimeFormat("en-GB",{timeZone:timezone,hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
    return `${date.format(instant)}T${clock.format(instant)}`;
  };
  const selectedOn = (localDay:string) => detail && date.format(detail.row.start) <= localDay &&
    date.format(new Date(detail.row.finish.getTime()-1)) >= localDay;
  const switchDay = days===7 && detail && !selectedOn(day) ? date.format(detail.row.start) : day;
  const switchView = `${base}&day=${switchDay}&view=${days===1?"week":"day"}` +
    (detail ? `&session=${detail.row.id}` : "");
  const upcomingLink = upcoming ? `${base}&day=${date.format(upcoming.start)}&view=day&session=${upcoming.id}#class-details` : "";
  const periodLabel = new Intl.DateTimeFormat("en-IN", {weekday:"short",day:"numeric",month:"short",year:"numeric",timeZone:"UTC"});
  const stateLabel = {draft:"Draft",published:"Scheduled",cancelled:"Cancelled",conducted:"Attendance recorded"};
  return <Chrome user={user} current={current} section="/timetable"><div className={styles.page}>
    <header className={styles.hero}>
      <div><p className={styles.eyebrow}>Campus and academics</p><h1>Timetable</h1><p className="meta">Classes and attendance · {timezone}</p></div>
      {current.role==="student" && <a className={styles.shortcut} href="#attendance">My attendance</a>}
    </header>
    {upcoming && <section className={`panel ${styles.next}`} aria-labelledby="next-class">
      <h2 id="next-class">{upcoming.start<=new Date() ? "Class in progress" : "Next class"}</h2>
      <Link href={upcomingLink}>{upcoming.course}</Link>
      <p className="meta">{date.format(upcoming.start)} · {time.format(upcoming.start)} · {upcoming.room}</p>
    </section>}

    <div className={styles.planner} data-student={current.role==="student" ? "true" : undefined}>
      <section className={`panel ${styles.schedule}`} aria-labelledby="class-schedule">
        <h2 id="class-schedule">Class schedule</h2>
        <nav className={styles.periodControls} aria-label="Timetable period">
          <Link href={`${base}&day=${offset(-days)}&view=${days===1?"day":"week"}`}>Previous {days===1?"day":"7 days"}</Link>
          <Link href={`${base}&day=${today}&view=day`}>Today</Link>
          <Link href={switchView}>{days===1?"Next 7 days":"Day view"}</Link>
          <Link href={`${base}&day=${offset(days)}&view=${days===1?"day":"week"}`}>Next {days===1?"day":"7 days"}</Link>
        </nav>
        <p className={styles.periodLabel}><span className="tag">{days===1 ? "Day" : "7-day window"}</span> <time dateTime={day}>{periodLabel.format(new Date(day))}</time>{days===7 && <> to <time dateTime={offset(6)}>{periodLabel.format(new Date(offset(6)))}</time></>}</p>
        {days === 7 && <details className={styles.weekCalendar}>
          <summary>7-day calendar</summary>
          <ol className={styles.week} aria-label="7-day calendar by day">
            {Array.from({length:7}, (_, index) => {
              const localDay = offset(index);
              const records = sessions.filter(session => date.format(session.start) <= localDay &&
                date.format(new Date(session.finish.getTime()-1)) >= localDay);
              const label = new Intl.DateTimeFormat("en-IN",{weekday:"short",day:"numeric",month:"short",timeZone:"UTC"}).format(new Date(localDay));
              return <li key={localDay}>
                <Link href={`${base}&day=${localDay}&view=day` + (detail && selectedOn(localDay) ? `&session=${detail.row.id}` : "")} aria-current={localDay===today ? "date" : undefined}><time dateTime={localDay}>{label}</time></Link>
                {records.length === 0 ? <span>No sessions</span> : <ul>{records.map(session=><li key={session.id}>
                  <Link href={sessionLink(session.id)}>{session.course}</Link>
                  <span>{time.format(session.start)} · {stateLabel[session.state]}</span>
                </li>)}</ul>}
              </li>;
            })}
          </ol>
        </details>}
        {sessions.length ? <ol className={styles.timeline}>{sessions.map(item=><li className={styles.session} key={item.id}>
          <time dateTime={item.start.toISOString()}>{date.format(item.start)}<br/>{time.format(item.start)} – {time.format(item.finish)}</time>
          <div><Link href={sessionLink(item.id)}>{item.course}</Link>
            <p className="meta">{item.section} · {item.room} · {item.teacher}</p>
            <span className="tag">{stateLabel[item.state]}{item.attendance ? ` · ${item.attendance}` : ""}</span>
          </div>
        </li>)}</ol> : <p>No classes in this period.</p>}
      </section>
    {current.role==="student" && <section id="attendance" className={`panel ${styles.attendance}`} tabIndex={-1} aria-labelledby="attendance-title">
      <h2 id="attendance-title">My attendance</h2>
      <p className="meta">Present marks divided by classes with a recorded mark for you. Cancelled and unrecorded classes are excluded.</p>
      {summary.length ? <ul className="items">{summary.map(row=><li key={row.offering_id}>
        <h3>{row.course} · {row.term}</h3><p className={styles.rate}>{attendancePercentage(row.present,row.recorded)}%</p>
        <p>{row.present} of {row.recorded} recorded classes attended</p>
        <meter min={0} max={row.recorded} value={row.present} aria-label={`Recorded attendance for ${row.course}`} />
        <AttendanceForecast present={row.present} recorded={row.recorded} target={row.target} source={row.source} />
      </li>)}</ul> : <p>No attendance recorded yet.</p>}
    </section>}
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
      {targets.length > 0 && <section className="panel">
        <h2>Attendance planning targets</h2>
        <p className="meta">Choose a course to set its advisory percentage. Students see the source alongside their forecast.</p>
        {targets.map(item=><details key={item.id}>
          <summary>{item.label} · {item.percent === null ? "No target" : item.percent+"%"}</summary>
          <ActionForm key={item.revision} action={timetableAction} context={current} operation="target" label="Save planning target">
            <input type="hidden" name="offering" value={item.id} />
            <input type="hidden" name="revision" value={item.revision} />
            <label>Target percentage (clear to withdraw)<input type="number" name="percent" min="1" max="100" step="1" defaultValue={item.percent ?? ""} /></label>
            <label>Policy reference or withdrawal reason<input name="source" maxLength={200} required defaultValue={item.source ?? ""} /></label>
          </ActionForm>
        </details>)}
      </section>}
      {detail && <section className={`panel ${styles.classDetail}`} style={recordTransition(current,"session",detail.row.id)} id="class-details" tabIndex={-1} aria-labelledby="class-detail-title">
        <h2 id="class-detail-title">{detail.row.course} class</h2>
        <p><time dateTime={detail.row.start.toISOString()}>{periodLabel.format(new Date(date.format(detail.row.start)))} · {time.format(detail.row.start)}</time> – {time.format(detail.row.finish)} · <strong>{detail.row.room}</strong></p>
        <p className="meta">{stateLabel[detail.row.state]}{detail.row.change_reason ? ` · ${detail.row.change_reason}` : ""}</p>
        {changes[0]&&<aside aria-label="Verified room change">
          <h3>Verified room change</h3>
          <p>Moved from {changes[0].from_room_name} to {changes[0].to_room_name}. Go to {changes[0].current_room} at the displayed time.</p>
          <p className="meta">Timetable revision {changes[0].revision} · Published {date.format(changes[0].published_at)} at {time.format(changes[0].published_at)} · {changes[0].reason}</p>
        </aside>}
        {current.role==="admin"&&detail.row.state==="published"&&detail.row.start>new Date()&&<details>
          <summary>Campus Change Brief: replace the room</summary>
          <p className="meta">Time and teacher stay the same. Choices are preapproved room alternatives with sufficient recorded seats and no current schedule or confirmed-booking conflict.</p>
          {alternatives.length?<ActionForm action={timetableAction} context={current} operation="move-room" label="Review room change"
            confirmationTitle="Review room change" confirmationLabel="Publish room change"
            confirmation={`${detail.row.course} · ${date.format(detail.row.start)}, ${time.format(detail.row.start)}. The timetable will change from ${detail.row.room} to the selected room for ${alternatives[0].affected} active students. The class time and teacher stay the same. No external message is sent.`}>
            <input type="hidden" name="session" value={detail.row.id}/>
            <input type="hidden" name="revision" value={detail.row.revision}/>
            <p>Active students affected: {alternatives[0].affected}. The assigned teacher is unchanged.</p>
            <label>Replacement room<select name="room" required defaultValue="">
              <option value="" disabled>Choose an approved room</option>
              {alternatives.map(room=><option key={room.id} value={room.id}>{room.name} · {room.location} · {room.capacity} seats</option>)}
            </select></label>
            <label>Public reason for room change<input name="reason" maxLength={500} required /></label>
          </ActionForm>:<p>No approved alternative with sufficient recorded capacity is currently available.</p>}
        </details>}
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
  </div></Chrome>;
}
