import { recordTransition } from "../experience/record-transition";
import { QuickLookup } from "../aura/quick-lookup";
import { ClassTimeline } from "../experience/class-timeline";
import { openOpportunityCount } from "../../lib/opportunities";
import { nextClass, attendanceSummary, attendancePercentage, upcomingRoomChanges } from "../../lib/academic-day";
import Link from "next/link";
import { offerings, studentAssignmentSummaries } from "../../lib/assignments";
import { notices } from "../../lib/connected";
import { workspaceQuery, type Scope } from "../../lib/scope";
import { Icon } from "../experience/workspace-icon";
import styles from "./home.module.css";
import { StudentHomeFocus } from "./home-focus";
import { ProgressRing } from "../experience/progress-ring";
import { classesNeeded, classesSpare } from "../../lib/attendance-math";
import { notifications } from "../../lib/automation";
import { ActionForm } from "../forms";
import { automation } from "../actions/automation";

export function StudentHomeLoading() {
  return <div className={styles.home} role="status">
    <p className={styles.loading}>Loading your campus overview…</p>
  </div>;
}

export async function StudentHome({current, name, timezone}:{current:Scope;name:string;timezone:string}) {
  const [assignments, courses, updates, upcoming, attendance, opportunityCount, inbox, roomChanges] = await Promise.all([
    studentAssignmentSummaries(current), offerings(current), notices(current,"published",3), nextClass(current),
    attendanceSummary(current), openOpportunityCount(current), notifications(current), upcomingRoomChanges(current),
  ]);
  const query = workspaceQuery(current);
  const today = new Intl.DateTimeFormat("en-IN",{weekday:"long",day:"numeric",month:"long",timeZone:timezone});
  const deadline = new Intl.DateTimeFormat("en-IN",{day:"numeric",month:"short",hour:"numeric",minute:"2-digit",timeZone:timezone});
  const open = assignments.filter(item=>item.accepting && !item.submitted);
  const recorded = attendance.reduce((sum,row) => sum + row.recorded, 0);
  const present = attendance.reduce((sum,row) => sum + row.present, 0);
  const published = assignments.flatMap(item => item.result_published_at
    ? [{ id: item.id, title: item.title, course: item.course, publishedAt: item.result_published_at }]
    : []);
  const latestFeedback = published.sort((a,b) => b.publishedAt.getTime() - a.publishedAt.getTime())[0];
  const coursework = open[0] ?? latestFeedback;
  const classHref = (id:string,start:Date) =>
    `/timetable?${query}&day=${new Intl.DateTimeFormat("sv-SE",{dateStyle:"short",timeZone:timezone}).format(start)}&view=day&session=${id}#class-details`;
  const firstName = name.trim().split(/\s+/)[0];
  const assignmentList = (items:typeof assignments) => <ul className={styles.list}>{items.map(item=>{
    const status = item.result_published_at ? "Result published" : item.submitted ? "Submitted" : item.accepting ? "Ready to submit" : "Deadline passed";
    return <li key={item.id} id={`student-assignment-${item.id}`} tabIndex={-1}>
      <div>
        <Link className={styles.record} href={`/assignments/${item.id}?${query}`}>{item.title}</Link>
        <p>{item.course} · {item.section}</p>
        <p>Due <time dateTime={item.deadline.toISOString()}>{deadline.format(item.deadline)}</time></p>
      </div>
      <span className={styles.status} data-tone={item.submitted ? "complete" : item.accepting ? "open" : "neutral"}>{status}</span>
    </li>;
  })}</ul>;
  const history = assignments.filter(item=>!item.accepting || item.submitted);
  return <StudentHomeFocus timetableHref={`/timetable?${query}`} heading={<>
      <p className="app-kicker">Your campus at a glance</p>
      <h1>{firstName ? `Good to see you, ${firstName}.` : "Welcome back."}</h1>
      <p className={styles.date}>{today.format(new Date())} · Student workspace</p>
    </>}>

    {roomChanges.length>0&&<section className={`${styles.panel} ${styles.roomBrief}`} aria-labelledby="student-room-updates">
      <h2 id="student-room-updates"><Icon name="notice" />Confirmed room changes</h2>
      <ul className={styles.list}>{roomChanges.map(change=><li key={change.id}><div>
        <a className={styles.record} href={classHref(change.id,change.start)}>{change.course}: moved to {change.current_room}</a>
        <p>{deadline.format(change.start)} · Previously {change.from_room_name} · Published timetable</p>
      </div></li>)}</ul>
    </section>}
    <div className={styles.lead}>
      <section className={styles.priority} style={upcoming ? recordTransition(current,"session",upcoming.id) : undefined} aria-label="Next class">
        <h2><Icon name="calendar" />{upcoming && upcoming.start <= new Date() ? "Class in progress" : "Next class"}</h2>
        {upcoming ? <>
          <a className={styles.priorityLink} href={classHref(upcoming.id,upcoming.start)}>{upcoming.course}<Icon name="chevron" /></a>
          <p><time dateTime={upcoming.start.toISOString()}>{deadline.format(upcoming.start)}</time> · <b>{upcoming.room}</b></p>
        </> : <><strong>No upcoming classes</strong><p>Check your timetable for published sessions.</p></>}
      </section>
      <section className={`${styles.priority} ${styles.coursework}`} style={coursework ? recordTransition(current,"assignment",coursework.id) : undefined} aria-labelledby="next-coursework">
        <h2 id="next-coursework"><Icon name="book" />{open[0] ? "Due next" : latestFeedback ? "Feedback is ready" : "Assignments"}</h2>
        {coursework ? <>
          <a className={styles.priorityLink} href={`/assignments/${coursework.id}?${query}`}>{coursework.title}<Icon name="chevron" /></a>
          <p>{coursework.course}{open[0] && <> · Due <time dateTime={open[0].deadline.toISOString()}>{deadline.format(open[0].deadline)}</time></>}</p>
        </> : <><strong>You’re caught up</strong><p>No assignments awaiting submission.</p><a className={styles.secondary} href="#student-courses">See my courses</a></>}
      </section>
    </div>
    <div className={styles.timeline} data-focus-secondary><ClassTimeline current={current} timezone={timezone} /></div>
      <nav className={styles.stats} aria-label="Academic summary" data-focus-secondary>
        <h2><Icon name="check" />At a glance</h2>
        <a href="#student-assignments"><Icon name="book" /><span>Open assignments</span><strong>{open.length}</strong></a>
        <a href={latestFeedback ? `/assignments/${latestFeedback.id}?${query}` : "#student-assignments"}><Icon name="check" /><span>Published results</span><strong>{published.length}</strong></a>
        <Link href={`/opportunities?${query}`}><Icon name="spark" /><span>Open opportunities</span><strong>{opportunityCount}</strong></Link>
      </nav>

    <div className={styles.content}>
      <div className={styles.column}>
        <section id="student-assignments" tabIndex={-1} className={styles.panel} aria-labelledby="student-actions-title">
          <div className={styles.sectionHead}>
            <h2 id="student-actions-title"><Icon name="check" />My assignments</h2>
            <p>Open assignments are ordered by deadline.</p>
          </div>
          {assignments.length ? <>
            {open.length ? assignmentList(open) : <p className={styles.empty}>No assignments awaiting submission.</p>}
            {history.length>0 && <details className={styles.history}><summary>Submitted and past assignments ({history.length})</summary>{assignmentList(history)}</details>}
          </> : <p className={styles.empty}>No assignments have been published for your courses yet.</p>}
        </section>

        <section id="student-courses" tabIndex={-1} className={styles.panel} aria-labelledby="student-courses-title">
          <div className={styles.sectionHead}><h2 id="student-courses-title"><Icon name="book" />My courses</h2></div>
          {courses.length ? <ul className={styles.list}>{courses.map(course=><li key={course.id}>
            <Link className={styles.record} href={`/courses/${course.id}?${query}`}>{course.label}</Link>
          </li>)}</ul> : <p className={styles.empty}>You don’t have any active course enrollments.</p>}
        </section>
      </div>

      <div className={styles.column} data-focus-secondary>
        <section className={styles.panel} aria-labelledby="student-attendance-title">
          <div className={styles.sectionHead}>
            <h2 id="student-attendance-title"><Icon name="calendar" />Attendance</h2>
            <p>Present marks divided by classes with a recorded mark. Official eligibility follows institutional policy.</p>
          </div>
          <div className={styles.attendance}>
            <ProgressRing value={present} total={recorded} label="Recorded attendance" />
            {attendance.length ? <ul className={styles.courseBars}>{attendance.map(row => {
              const needed = row.target != null ? classesNeeded(row.present,row.recorded,row.target) : null;
              const spare = row.target != null && needed === 0 ? classesSpare(row.present,row.recorded,row.target) : null;
              return <li key={row.offering_id}>
                <span className={styles.courseName}>{row.course}</span>
                <span className={styles.courseFigure}>{row.present}/{row.recorded} · {attendancePercentage(row.present,row.recorded)}%</span>
                <span className={styles.bar} aria-hidden="true"><i style={{width:`${row.recorded ? 100*row.present/row.recorded : 0}%`}} />{row.target != null && <b style={{left:`${row.target}%`}} />}</span>
                {row.target != null && <small>{needed === null ? `A ${row.target}% planning target can no longer be reached.` : needed > 0
                  ? `Attend the next ${needed} consecutive class${needed === 1 ? "" : "es"} to reach the ${row.target}% planning target.`
                  : `At or above the ${row.target}% planning target${spare ? ` · ${spare} class${spare === 1 ? "" : "es"} of margin` : ""}.`}</small>}
              </li>;
            })}</ul> : <p className={styles.empty}>No attendance has been recorded for your classes yet.</p>}
          </div>
          <Link className={styles.secondary} href={`/timetable?${query}#attendance`}>Attendance details and what-if <span aria-hidden="true">→</span></Link>
        </section>
        <section className={`${styles.panel} ${styles.aura}`} aria-labelledby="student-aura-title">
          <div className={styles.sectionHead}>
            <h2 id="student-aura-title"><Icon name="spark" />AURA assistant</h2>
            <p>Ask about your timetable, attendance or published feedback. Answers use your college records.</p>
          </div>
          <div className={styles.auraInset}><QuickLookup current={current} /></div>
          <Link className={styles.secondary} href={`/aura?${query}`}>Open AURA activity <span aria-hidden="true">→</span></Link>
        </section>
        {inbox.length > 0 && <section className={styles.panel} aria-labelledby="student-inbox-title">
          <div className={styles.sectionHead}>
            <h2 id="student-inbox-title"><Icon name="spark" />For you</h2>
            <p>{inbox.filter(n => !n.read_at).length} unread · sent automatically when your courses change.</p>
          </div>
          <ul className={styles.list}>{inbox.slice(0, 5).map(n => <li key={n.id} className={styles.inboxItem} data-unread={!n.read_at || undefined}>
            <div>
              <Link className={styles.record} href={`/assignments/${n.entity_id}?${query}`}>{n.title}</Link>
              <p><time dateTime={n.created_at.toISOString()}>{deadline.format(n.created_at)}</time>{n.read_at ? " · Read" : ""}</p>
            </div>
            {!n.read_at && <ActionForm action={automation} context={current} operation="read-notification" label="Mark read" secondary>
              <input type="hidden" name="id" value={n.id} />
            </ActionForm>}
          </li>)}</ul>
        </section>}
        <section className={styles.panel} aria-labelledby="student-notices-title">
          <div className={styles.sectionHead}><h2 id="student-notices-title"><Icon name="notice" />Campus notices</h2></div>
          {updates.length ? <ul className={styles.list}>{updates.map(notice=><li key={notice.id}>
            <div>
              <Link className={styles.record} href={`/notices?${query}&filter=published#notice-${notice.id}`}>{notice.title}</Link>
              <p>{notice.audience}</p>
            </div>
          </li>)}</ul> : <p className={styles.empty}>No published notices for your workspace yet.</p>}
          <Link className={styles.secondary} href={`/notices?${query}`}>View all campus notices <span aria-hidden="true">→</span></Link>
        </section>

        <nav aria-label="Campus services" className={styles.quick}>
          <Link href={`/clubverse?${query}`}><Icon name="people" />Discover communities <span aria-hidden="true">→</span></Link>
          <Link href={`/requests?${query}`}><Icon name="service" />Request an enrollment letter <span aria-hidden="true">→</span></Link>
        </nav>
      </div>
    </div>
  </StudentHomeFocus>;
}
