import Link from "next/link";
import { offerings, studentAssignmentSummaries } from "../../lib/assignments";
import { notices } from "../../lib/connected";
import { workspaceQuery, type Scope } from "../../lib/scope";
import { Icon } from "../experience/workspace-icon";
import styles from "./home.module.css";

export function StudentHomeLoading() {
  return <div className={styles.home} role="status">
    <p className={styles.loading}>Loading your campus overview…</p>
  </div>;
}

export async function StudentHome({current, name, timezone}:{current:Scope;name:string;timezone:string}) {
  const [assignments, courses, updates] = await Promise.all([
    studentAssignmentSummaries(current), offerings(current), notices(current,"published",3),
  ]);
  const query = workspaceQuery(current);
  const today = new Intl.DateTimeFormat("en-IN",{weekday:"long",day:"numeric",month:"long",timeZone:timezone});
  const deadline = new Intl.DateTimeFormat("en-IN",{day:"numeric",month:"short",hour:"numeric",minute:"2-digit",timeZone:timezone});
  const open = assignments.filter(item=>item.accepting && !item.submitted);
  const published = assignments.flatMap(item => item.result_published_at
    ? [{ id: item.id, title: item.title, course: item.course, publishedAt: item.result_published_at }]
    : []);
  const latestFeedback = published.sort((a,b) => b.publishedAt.getTime() - a.publishedAt.getTime())[0];
  const ordered = [...open,...assignments.filter(item=>!item.accepting || item.submitted)];
  const firstName = name.trim().split(/\s+/)[0];
  return <div className={styles.home}>
    <header className={styles.intro}>
      <p className={styles.date}><Icon name="calendar" />{today.format(new Date())} · Student</p>
      <h1>{firstName ? `Welcome, ${firstName}.` : "Welcome back."}</h1>
      <p>Your campus, at a glance.</p>
    </header>

    <div className={styles.lead}>
      <section className={styles.priority} aria-labelledby="next-up">
        <h2 id="next-up"><Icon name="book" />Next up</h2>
        {open[0] ? <>
          <strong>{open[0].title}</strong>
          <p>{open[0].course} · Due <time dateTime={open[0].deadline.toISOString()}>{deadline.format(open[0].deadline)}</time></p>
          <Link className={styles.primary} href={`/assignments/${open[0].id}?${query}`}>Open assignment <span aria-hidden="true">→</span></Link>
        </> : latestFeedback ? <>
          <strong>Feedback is ready</strong><p>{latestFeedback.title} · {latestFeedback.course}</p>
          <Link className={styles.primary} href={`/assignments/${latestFeedback.id}?${query}`}>Read feedback <span aria-hidden="true">→</span></Link>
        </> : <>
          <strong>No assignments awaiting submission</strong>
          <a className={styles.primary} href="#student-courses">See my courses <span aria-hidden="true">↓</span></a>
        </>}
      </section>
      <nav className={styles.stats} aria-label="Academic summary">
        <h2><Icon name="check" />At a glance</h2>
        <a href="#student-assignments"><span>Open assignments</span><strong>{open.length}</strong></a>
        <a href="#student-courses"><span>My courses</span><strong>{courses.length}</strong></a>
        <a href={latestFeedback ? `/assignments/${latestFeedback.id}?${query}` : "#student-assignments"}><span>Published results</span><strong>{published.length}</strong></a>
      </nav>
    </div>

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

      <div className={styles.column}>
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
        <section className={`${styles.panel} ${styles.aura}`} aria-labelledby="student-aura-title">
          <div className={styles.sectionHead}>
            <h2 id="student-aura-title"><Icon name="spark" />AURA</h2>
            <p>Review your event plans. Club organizers can prepare a guided draft from their club workspace.</p>
          </div>
          <Link className={styles.secondary} href={`/aura?${query}`}>Open AURA activity <span aria-hidden="true">→</span></Link>
        </section>
      </div>
    </div>
  </div>;
}
