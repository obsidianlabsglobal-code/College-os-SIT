import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "../page-header";
import { Chrome } from "../chrome";
import { account, scope, workspaceQuery, workspaces } from "../../lib/scope";
import { calendar, calendarEntries, parseCalendarFilter } from "../../lib/calendar";
import { hasDuty } from "../../lib/delegation";
import { ActionForm } from "../forms";
import { planningAction } from "../actions/planning";
import { offerings } from "../../lib/assignments";

const kindLabel = { deadline: "Deadline", class: "Class", event: "Campus event", exam: "Examination", institution: "Institution" } as const;
const stateLabel: Record<string, string> = { cancelled: "Cancelled", conducted: "Attendance recorded", completed: "Completed", term: "Term dates", holiday: "Holiday" };

export default async function Calendar({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [params, user] = await Promise.all([searchParams, account()]);
  const current = await scope(params.institution, params.role);
  const manages = await hasDuty(current, "calendar");
  if (current.role !== "student" && current.role !== "faculty" && !manages) notFound();
  const timezone = (await workspaces(user.id)).find(w => w.id === current.institution && w.role === current.role)?.timezone ?? "UTC";
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: timezone, dateStyle: "short" }).format(new Date());
  const selection = parseCalendarFilter(params, today.slice(0, 7));
  if (!selection) notFound();
  const [items, courses, dates] = await Promise.all([calendar(current, selection), offerings(current), manages ? calendarEntries(current) : []]);
  const query = workspaceQuery(current);
  const day = new Intl.DateTimeFormat("sv-SE", { timeZone: timezone, dateStyle: "short" });
  const dayLabel = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: timezone });
  const time = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: timezone });
  const [year, month] = selection.month.split("-").map(Number);
  const shift = (n: number) => { const d = new Date(Date.UTC(year, month - 1 + n, 1)); return d.toISOString().slice(0, 7); };
  const link = (m: string) => `/calendar?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(query)), month: m,
    ...(selection.offering ? { offering: selection.offering } : {}), ...(selection.kind ? { kind: selection.kind } : {}) })}`;
  const title = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));
  const href = (item: (typeof items)[number]) => item.kind === "deadline" ? `/assignments/${item.id}?${query}`
      : item.kind === "exam" ? `/exams?${query}`
    : item.kind === "class" ? `/timetable?${query}&day=${day.format(item.at)}&view=day&session=${item.id}#class-details` : null;
  const groups = [...Map.groupBy(items, item => day.format(item.at))];
  return <Chrome user={user} current={current} section="/calendar">
    <PageHeader title="Academic calendar" parent={{ href: `/?${query}`, label: "Workspace" }}
      context={`Deadlines and classes from your current courses, and campus events you registered for · ${timezone}`} />
    {manages && current.role !== "admin" && <section className="panel stack" aria-labelledby="manage-dates">
      <h2 id="manage-dates">Institution dates (delegated)</h2>
      <p className="meta">You hold the institution-calendar duty. Dates you publish appear in every student’s and teacher’s calendar.</p>
      <ActionForm action={planningAction} context={current} operation="calendar-add" label="Publish date">
        <label>Title<input name="title" required maxLength={160} /></label>
        <label>Type<select name="kind" defaultValue="event"><option value="term">Term dates</option><option value="holiday">Holiday</option><option value="event">Event</option><option value="deadline">Deadline</option></select></label>
        <label>From<input name="from" type="date" required /></label><label>To<input name="to" type="date" required /></label>
      </ActionForm>
      {dates.length > 0 && <ul className="items">{dates.map(d => <li key={d.id} className="meta">{d.title} · {d.starts_on}{d.ends_on !== d.starts_on && ` to ${d.ends_on}`}</li>)}</ul>}
    </section>}
    <section className="panel stack" aria-labelledby="calendar-month">
      <div className="row spread">
        <h2 id="calendar-month">{title}</h2>
        <nav aria-label="Month" className="row"><Link href={link(shift(-1))}>Previous month</Link><Link href={link(today.slice(0, 7))}>This month</Link><Link href={link(shift(1))}>Next month</Link></nav>
      </div>
      <form method="get" className="row" aria-label="Filter calendar">
        {[...new URLSearchParams(query)].map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <input type="hidden" name="month" value={selection.month} />
        <label>Course<select name="offering" defaultValue={selection.offering ?? ""}>
          <option value="">All courses</option>{courses.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
        <label>Type<select name="kind" defaultValue={selection.kind ?? ""}>
          <option value="">Everything</option><option value="deadline">Deadlines</option><option value="class">Classes</option><option value="exam">Examinations</option><option value="institution">Institution dates</option><option value="event">Campus events</option></select></label>
        <button className="button secondary">Apply</button>
      </form>
      {groups.length ? <ol className="items" aria-label="Calendar entries">{groups.map(([date, entries]) => <li key={date}>
        <h3><time dateTime={date}>{dayLabel.format(entries[0].at)}</time>{date === today && " · Today"}</h3>
        <ul className="items">{entries.map(item => { const target = href(item); return <li key={`${item.kind}:${item.id}`}>
          <p><span className={item.kind === "deadline" ? "tag tag-attention" : "tag"}>{kindLabel[item.kind]}</span>{" "}
            {target ? <Link href={target}>{item.title}</Link> : item.title}</p>
          <p className="meta">{item.kind === "institution" ? "All day" : item.kind === "deadline" ? `Due ${time.format(item.at)}` : `${time.format(item.at)} – ${item.finish ? time.format(item.finish) : ""}`}
            {item.course && item.kind === "deadline" && ` · ${item.course}`}{stateLabel[item.state] && ` · ${stateLabel[item.state]}`}</p>
        </li>; })}</ul>
      </li>)}</ol> : <p>Nothing scheduled in {title} for this filter.</p>}
    </section>
  </Chrome>;
}
