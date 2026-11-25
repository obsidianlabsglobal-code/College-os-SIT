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

export function StudentHomeLoading() {
  return <div className={styles.home} role="status">
    <p className={styles.loading}>Loading your campus overview…</p>
  </div>;
}

export async function StudentHome({current, name, timezone}:{current:Scope;name:string;timezone:string}) {
  const [assignments, courses, updates, upcoming, attendance, opportunityCount, roomChanges] = await Promise.all([
    studentAssignmentSummaries(current), offerings(current), notices(current,"published",3), nextClass(current),
    attendanceSummary(current), openOpportunityCount(current), upcomingRoomChanges(current),
  ]);
  const query = workspaceQuery(current);
  const today = new Intl.DateTimeFormat("en-IN",{weekday:"long",day:"numeric",month:"long",timeZone:timezone});
  const deadline = new Intl.DateTimeFormat("en-IN",{day:"numeric",month:"short",hour:"numeric",minute:"2-digit",timeZone:timezone});
  const open = assignments.filter(item=>item.accepting && !item.submitted);
  const recorded = attendance.reduce((sum,row) => sum + row.recorded, 0);
  const present = attendance.reduce((sum,row) => sum + row.present, 0);
  const classFirst = upcoming && (!open[0] || upcoming.start <= open[0].deadline);
  const published = assignments.flatMap(item => item.result_published_at
    ? [{ id: item.id, title: item.title, course: item.course, publishedAt: item.result_published_at }]
    : []);
  const latestFeedback = published.sort((a,b) => b.publishedAt.getTime() - a.publishedAt.getTime())[0];
  const priorityTransition = classFirst ? recordTransition(current,"session",upcoming.id) :
    open[0] || latestFeedback ? recordTransition(current,"assignment",(open[0] ?? latestFeedback).id) : undefined;
  const ordered = [...open,...assignments.filter(item=>!item.accepting || item.submitted)];
  const firstName = name.trim().split(/\s+/)[0];
  return <StudentHomeFocus timetableHref={`/timetable?${query}`} heading={<>
      <p className={styles.date}><Icon name="calendar" />{today.format(new Date())} · Student</p>
      <h1>{firstName ? `Welcome, ${firstName}.` : "Welcome back."}</h1>
      <p>Your classes, priorities and campus life, in one place.</p>
    </>}>

    {roomChanges.length>0&&<section className={styles.panel} aria-labelledby="student-room-updates">
      <h2 id="student-room-updates">Confirmed room changes</h2>
      <ul className={styles.list}>{roomChanges.map(change=><li key={change.id}><div>
        <Link className={styles.record} href={`/timetable?${query}&session=${change.id}#class-details`}>{change.course}: moved to {change.current_room}</Link>
        <p>{deadline.format(change.start)} · Previously {change.from_room_name} · Published timetable</p>
      </div></li>)}</ul>
    </section>}
    <div className={styles.lead}>
      <section className={styles.priority} style={priorityTransition} aria-labelledby="next-up">
        <p className={styles.overline}>Your next best move</p>
        <h2 id="next-up"><Icon name="book" />{classFirst ? "Next class" : "Next up"}</h2>
        {classFirst ? <>
          <strong>{upcoming.course}</strong><p>{upcoming.start <= new Date() ? "Class in progress" : "Next class"} · {deadline.format(upcoming.start)} · {upcoming.room}</p>
          <a className={styles.primary} href={`/timetable?${query}&session=${upcoming.id}#class-details`} aria-label={`Open class details for ${upcoming.course}`}>Open class details <span aria-hidden="true">→</span></a>
        </> : open[0] ? <>
          <strong>{open[0].title}</strong>
          <p>{open[0].course} · Due <time dateTime={open[0].deadline.toISOString()}>{deadline.format(open[0].deadline)}</time></p>
          <a className={styles.primary} href={`/assignments/${open[0].id}?${query}`}>Open assignment <span aria-hidden="true">→</span></a>
        </> : latestFeedback ? <>
          <strong>Feedback is ready</strong><p>{latestFeedback.title} · {latestFeedback.course}</p>
          <a className={styles.primary} href={`/assignments/${latestFeedback.id}?${query}`}>Read feedback <span aria-hidden="true">→</span></a>
        </> : <>
          <strong>No assignments awaiting submission</strong>
          <a className={styles.primary} href="#student-courses">See my courses <span aria-hidden="true">↓</span></a>
        </>}
      </section>
      <div className={styles.timeline} data-focus-secondary><ClassTimeline current={current} timezone={timezone} /></div>
    </div>
      <nav className={styles.stats} aria-label="Academic summary" data-focus-secondary>
        <h2><Icon name="check" />At a glance</h2>
        <a href="#student-assignments"><Icon name="book" /><span>Open assignments</span><strong>{open.length}</strong></a>
        <a href={latestFeedback ? `/assignments/${latestFeedback.id}?${query}` : "#student-assignments"}><Icon name="check" /><span>Published results</span><strong>{published.length}</strong></a>
        <Link href={`/timetable?${query}#attendance`}><Icon name="calendar" /><span>Recorded attendance</span><strong>{recorded ? attendancePercentage(present,recorded)+"%" : "—"}</strong><small>{recorded ? `${present} of ${recorded} recorded` : "No marks recorded"}</small></Link>
        <Link href={`/opportunities?${query}`}><Icon name="spark" /><span>Open opportunities</span><strong>{opportunityCount}</strong></Link>
      </nav>

    {upcoming && !classFirst && <section className={styles.panel} aria-label="Next class">
      <h2>Next class</h2><Link className={styles.record} href={`/timetable?${query}&session=${upcoming.id}#class-details`}>{upcoming.course}</Link>
      <p className="meta">{deadline.format(upcoming.start)} · {upcoming.room}</p>
    </section>}
    <div className={styles.content}>
      <div className={styles.column}>
        <section id="student-assignments" tabIndex={-1} className={styles.panel} aria-labelledby="student-actions-title">
          <div className={styles.sectionHead}>
            <h2 id="student-actions-title"><Icon name="check" />Your next best moves</h2>
            <p>Open assignments come first, ordered by deadline.</p>
          </div>
          {ordered.length ? <ul className={styles.list}>{ordered.map(item=>{
            const status = item.result_published_at ? "Result published" : item.submitted ? "Submitted" : item.accepting ? "Ready to submit" : "Deadline passed";
            return <li key={item.id} id={`student-assignment-${item.id}`} tabIndex={-1}>
              <div>
                <Link className={styles.record} href={`/assignments/${item.id}?${query}`}>{item.title}</Link>
                <p>{item.course} · {item.section}</p>
                <p>Due <time dateTime={item.deadline.toISOString()}>{deadline.format(item.deadline)}</time></p>
              </div>
              <span className={styles.status} data-tone={item.submitted ? "complete" : item.accepting ? "open" : "neutral"}>{status}</span>
            </li>;
          })}</ul> : <p className={styles.empty}>No assignments have been published for your courses yet.</p>}
        </section>

        <section id="student-courses" tabIndex={-1} className={styles.panel} aria-labelledby="student-courses-title">
          <div className={styles.sectionHead}><h2 id="student-courses-title"><Icon name="book" />My courses</h2></div>
          {courses.length ? <ul className={styles.list}>{courses.map(course=><li key={course.id}>
            <Link className={styles.record} href={`/courses/${course.id}?${query}`}>{course.label}</Link>
          </li>)}</ul> : <p className={styles.empty}>You don’t have any active course enrollments.</p>}
        </section>
      </div>

      <div className={styles.column} data-focus-secondary>
        <section className={`${styles.panel} ${styles.aura}`} aria-labelledby="student-aura-title">
          <div className={styles.sectionHead}>
            <h2 id="student-aura-title"><Icon name="spark" />AURA at your side</h2>
            <p>Check your timetable, attendance and published results against your current records.</p>
          </div>
          <div className={styles.auraInset}><QuickLookup current={current} /></div>
          <Link className={styles.secondary} href={`/aura?${query}`}>Open AURA activity <span aria-hidden="true">→</span></Link>
        </section>
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
