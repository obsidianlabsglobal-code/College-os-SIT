import { PageHeader } from "../page-header";
import { Chrome } from "../chrome";
import { ActionForm } from "../forms";
import { operationsAction } from "../actions/operations";
import { account, scope, workspaceQuery } from "../../lib/scope";
import { bookings, busyTimes, equipmentStatus, holdings, loans, operationChoices, roomUse } from "../../lib/operations";

const stateLabel: Record<string, string> = { requested: "Requested", approved: "Approved", declined: "Declined", cancelled: "Cancelled" };

export default async function Facilities({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [params, user] = await Promise.all([searchParams, account()]);
  const current = await scope(params.institution, params.role);
  const admin = current.role === "admin";
  const [booked, books, myLoans, use, choices, equipment] = await Promise.all([bookings(current), holdings(current, params.q ?? ""), loans(current), roomUse(current),
    operationChoices(current), equipmentStatus(current)]);
  const check = params.room && params.date ? { room: params.room, date: params.date } : null;
  const busy = check ? await busyTimes(current, check).catch(() => null) : null;
  const time = new Intl.DateTimeFormat("en-IN", { timeStyle: "short", timeZone: "Asia/Kolkata" });
  const when = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
  const query = workspaceQuery(current);
  return <Chrome user={user} current={current} section="/facilities">
    <PageHeader title="Rooms, labs and library" parent={{ href: `/?${query}`, label: "Workspace" }}
      context={admin ? "Decide room and lab requests, run the library and equipment desk, and see room use for the next seven days."
        : "Request a room or lab slot from the office, search the library, and see what you have borrowed."} />

    {!admin && current.role !== "principal" && <section className="panel stack" aria-labelledby="book-title">
      <h2 id="book-title">Request a room or lab</h2>
      <form className="form" aria-label="Check when a room is free">
        <input type="hidden" name="institution" value={current.institution} /><input type="hidden" name="role" value={current.role} />
        <label>Check room<select name="room" defaultValue={check?.room}>{choices.rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
        <label>On<input type="date" name="date" required defaultValue={check?.date} /></label>
        <div><button className="button secondary">Show taken times</button></div>
      </form>
      {check && <div role="status" aria-label="Taken times">{busy === null ? <p>Choose a room and a valid date.</p> : !busy.length ? <p>Free all day.</p> :
        <><p>Taken (classes and approved bookings):</p><ul className="items">{busy.map((b, n) =>
          <li key={n}>{time.format(b.starts_at)} – {time.format(b.ends_at)} <span className="meta">· {b.kind === "class" ? "Class" : "Booked"}</span></li>)}</ul></>}</div>}
      <ActionForm action={operationsAction} context={current} operation="book" label="Request booking">
        <label>Room or lab<select name="room" required>{choices.rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
        <label>Purpose<input name="purpose" required maxLength={300} /></label>
        {current.role === "student" && <label>Supervising teacher<select name="supervisor" required defaultValue=""><option value="" disabled>Choose</option>
          {choices.teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}
        <label>Starts<input type="datetime-local" name="start" required /></label>
        <label>Length in minutes<input type="number" name="minutes" min={15} max={600} defaultValue={60} required /></label>
      </ActionForm>
    </section>}

    <section className="panel stack" aria-labelledby="bookings-title">
      <h2 id="bookings-title">{admin ? "Booking requests" : "My bookings"}</h2>
      {booked.length ? <ul className="items">{booked.map(b => <li key={b.id}><article aria-label={`${b.room} · ${b.purpose}`} className="stack">
        <div className="row spread"><h3>{b.room}</h3><span className={b.state === "requested" ? "tag tag-attention" : "tag"}>{stateLabel[b.state]}</span></div>
        <p className="meta">{when.format(b.starts_at)} · {b.purpose} · {b.requester}{b.supervisor ? ` · supervised by ${b.supervisor}` : ""}</p>
        {b.reason && <p className="meta">Office: {b.reason}</p>}
        {admin && b.state === "requested" && <ActionForm action={operationsAction} context={current} operation="decide" label="Record decision">
          <input type="hidden" name="booking" value={b.id} />
          <label>Decision<select name="decision" defaultValue="approved"><option value="approved">Approve</option><option value="declined">Decline</option></select></label>
          <label>Reason<input name="reason" required maxLength={500} /></label></ActionForm>}
        {b.mine && (b.state === "requested" || b.state === "approved") && b.starts_at > new Date() &&
          <ActionForm action={operationsAction} context={current} operation="cancel" label="Cancel booking" secondary><input type="hidden" name="booking" value={b.id} /></ActionForm>}
      </article></li>)}</ul> : <p>No bookings.</p>}
    </section>

    <section className="panel stack" aria-labelledby="library-title">
      <h2 id="library-title">Library</h2>
      <form method="get" className="row"><input type="hidden" name="institution" value={current.institution} /><input type="hidden" name="role" value={current.role} />
        <label>Search title or author<input type="search" name="q" maxLength={120} defaultValue={params.q ?? ""} /></label><button className="button secondary">Search</button></form>
      {books.length ? <ul className="items">{books.map(b => <li key={b.id} className="row spread"><span><strong>{b.title}</strong> · {b.author}</span>
        <span className="tag">{b.available} of {b.copies} available</span></li>)}</ul> : <p>No holdings match.</p>}
      {admin && <details><summary>Add a holding</summary>
        <ActionForm action={operationsAction} context={current} operation="holding" label="Add to library">
          <label>Title<input name="title" required maxLength={200} /></label><label>Author<input name="author" required maxLength={160} /></label>
          <label>Copies<input type="number" name="copies" min={1} max={500} defaultValue={1} required /></label></ActionForm></details>}
    </section>

    <section className="panel stack" aria-labelledby="loans-title">
      <h2 id="loans-title">{admin ? "Loans and custody" : "My loans"}</h2>
      {admin && <details><summary>Issue a book or equipment</summary>
        <ActionForm action={operationsAction} context={current} operation="issue" label="Issue loan">
          <label>Item<select name="item" required>
            {books.map(b => <option key={b.id} value={`book:${b.id}`}>Book · {b.title}</option>)}
            {choices.equipment.map(e => <option key={e.id} value={`equipment:${e.id}`}>Equipment · {e.name}</option>)}</select></label>
          <label>Borrower<select name="borrower" required>{choices.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label>Due<input type="date" name="due" required /></label></ActionForm></details>}
      {myLoans.length ? <ul className="items">{myLoans.map(l => <li key={l.id}><article aria-label={`${l.item} · ${l.borrower}`} className="stack">
        <div className="row spread"><h3>{l.item}</h3><span className={l.overdue ? "tag tag-attention" : "tag"}>{l.returned_at ? `Returned · ${l.condition}` : l.overdue ? "Overdue" : `Due ${l.due_on}`}</span></div>
        <p className="meta">{l.kind === "book" ? "Book" : "Equipment"} · {l.borrower}</p>
        {admin && !l.returned_at && <ActionForm action={operationsAction} context={current} operation="return" label="Record return" secondary>
          <input type="hidden" name="loan" value={l.id} />
          <label>Condition<select name="condition" defaultValue="good"><option value="good">Good</option><option value="damaged">Damaged</option><option value="lost">Lost</option></select></label>
        </ActionForm>}
      </article></li>)}</ul> : <p>No loans.</p>}
    </section>

    {equipment.length > 0 && <section className="panel stack" aria-labelledby="equipment-title">
      <h2 id="equipment-title">Equipment status</h2>
      <ul className="items">{equipment.map(e => <li key={e.id} className="row spread"><span><strong>{e.name}</strong> · {e.location}{e.last_condition ? ` · last returned ${e.last_condition}` : ""}</span>
        <span className={e.state === "overdue" ? "tag tag-attention" : "tag"}>{e.state === "available" ? "Available" : e.state === "overdue" ? `Overdue since ${e.due_on}` : `On loan until ${e.due_on}`}</span></li>)}</ul>
    </section>}
    {use.length > 0 && <section className="panel stack" aria-labelledby="use-title">
      <h2 id="use-title">Room use · next 7 days</h2>
      <table className="standings"><thead><tr><th scope="col">Room</th><th scope="col">Class h</th><th scope="col">Booked h</th><th scope="col">Waiting</th></tr></thead>
        <tbody>{use.map(u => <tr key={u.room}><th scope="row">{u.room}</th><td>{u.class_hours}</td><td>{u.booking_hours}</td><td>{u.requested}</td></tr>)}</tbody></table>
    </section>}
  </Chrome>;
}
