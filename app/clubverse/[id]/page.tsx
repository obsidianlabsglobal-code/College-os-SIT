import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Chrome } from "../../chrome";
import { PreparedMessage } from "../../experience/prepared-message";
import { clubEventMessage } from "../../../lib/prepared-message";
import { ExperienceHeading } from "../../experience/heading";
import { account, scope, workspaceQuery } from "../../../lib/scope";
import { clubView } from "../../../lib/club-views";
import { eventExtras } from "../../../lib/club-events";
import { ActionForm } from "../../forms";
import { clubEventAction } from "../../actions/club-events";
import { ClubForm, EventFields, stateText } from "../controls";

const actions: Record<string, readonly string[]> = {
  draft:["pending_approval","cancelled"], approved:["published","cancelled"], published:["registration_open","cancelled"],
  registration_open:["registration_closed","cancelled"], registration_closed:["in_progress","cancelled"], in_progress:["completed","cancelled"],
};
const eventLabels: Record<string,string> = {
  pending_approval:"Submit event for approval", approved:"Approve event", published:"Publish event",
  registration_open:"Open registration", registration_closed:"Close registration", in_progress:"Start event",
  completed:"Complete event", cancelled:"Cancel event",
};

export default async function ClubHome({ params,searchParams }: {
  params: Promise<{ id:string }>; searchParams: Promise<Record<string,string | undefined>>;
}) {
  const [{ id },selection,user] = await Promise.all([params,searchParams,account()]);
  if (!z.uuid().safeParse(id).success) notFound();
  const current = await scope(selection.institution,selection.role);
  if (!["student","faculty","admin"].includes(current.role)) notFound();
  const selectedEvent = z.uuid().safeParse(selection.participants);
  const selectedPage = z.coerce.number().int().min(0).max(200).safeParse(selection.page ?? 0);
  const view = await clubView(current,id,selectedEvent.success ? { event:selectedEvent.data,page:selectedPage.success ? selectedPage.data : 0 } : undefined);
  if (!view) notFound();
  const { club,member,lead,officer,events,people,grants,candidates,registrations,handovers } = view;
  const key = { club:id };
  const admin = current.role === "admin";
  const active = club.club_state === "active";
  const date = new Intl.DateTimeFormat("en-IN",{ dateStyle:"medium",timeStyle:"short",timeZone:club.timezone });
  const query = workspaceQuery(current);
  const extras = await eventExtras(current,id,events.map(event => event.id),officer);
  return <Chrome user={user} current={current} section="/clubverse">
    <ExperienceHeading title={club.name} context={club.category} parent={{ href:`/clubverse?${query}`,label:"CLUBVERSE" }} />
    <div className="grid">
      <div className="stack">
        <section className="panel stack">
          <div className="row"><h2>About this club</h2><span className="tag">{club.club_state}</span></div>
          <p className="prose-text">{club.purpose}</p>
          <div><h3>Membership and activities</h3><p className="prose-text">{club.rules}</p>
            <p className="meta">{club.audience === "campus" ? "Students and faculty" : club.audience} · {stateText(club.joining)}</p></div>
          {club.member_state && !admin && <p role="status">Membership · {stateText(club.member_state)}</p>}
          {!admin && active && !member && club.member_state !== "requested" && (club.joining !== "invitation" || club.member_state === "invited") &&
            <ClubForm current={current} operation="join" label={club.member_state === "invited" ? "Accept invitation" : club.joining === "open" ? "Join club" : "Request membership"} values={key} />}
          {member && !lead && <ClubForm current={current} operation="membership" label="Leave club" values={{ ...key,person:current.account,next:"ended" }} />}
          {admin && club.club_state !== "archived" && <ClubForm current={current} operation="club-state" label="Update club status" values={key}>
            <label>Club status<select name="next"><option value={active ? "suspended" : "active"}>{active ? "Suspend" : "Reactivate"}</option><option value="archived">Archive permanently</option></select></label>
          </ClubForm>}
        </section>
        <section className="panel stack">
          <h2>Events</h2>
          {!events.length && <p>No events are available in this view.</p>}
          {events.map(event => {
            const values = { ...key,id:event.id,revision:event.revision };
            const transitions = officer ? actions[event.state] ?? [] : [];
            const available = admin && active && event.state === "pending_approval" && event.author_id !== current.account ? ["approved",...transitions] : transitions;
            const attendance = registrations.filter(registration => registration.event_id === event.id);
            return <article key={event.id} id={`event-${event.id}`} className="club-record stack">
              <div><h3>{event.title}</h3><span className="tag">{stateText(event.state)}</span></div>
              {officer && <Link href={`/clubverse/booking?${query}&event=${event.id}`}>Manage booking</Link>}
              <p>{event.location} · {date.format(event.starts_at)} – {date.format(event.ends_at)}</p>
              <p className="meta">Capacity {event.capacity} · {event.audience === "club" ? "Members only" : "Eligible students"}</p>
              <p className="prose-text">{event.requirements}</p>
              {officer && active && ["published","registration_open","registration_closed"].includes(event.state) &&
                event.starts_at>new Date() && <PreparedMessage title="Event announcement" buttonLabel="Copy event announcement"
                  description={event.audience==="club" ? "Share only with club members. Check the published event before posting." :
                    "Share with the eligible student audience. Check the published event before posting."}
                  message={clubEventMessage({club:club.name,title:event.title,when:`${date.format(event.starts_at)} – ${date.format(event.ends_at)} · ${club.timezone}`,
                    venue:event.location,audience:event.audience==="club" ? "club":"institution",registrationOpen:event.state==="registration_open"})} />}
              {event.registered && <p>{event.verified ? "Participation verified" : "Registered · participation unverified"}</p>}
              {event.total != null && <p>{event.total} registered · {event.attended} verified participants</p>}
              {(() => {
                const extra = extras.get(event.id);
                const ref = { club:id,event:event.id };
                const open = active && current.role === "student" && event.state === "registration_open" && new Date(event.starts_at) > new Date();
                const full = (extra?.taken ?? 0) >= event.capacity;
                const hidden = Object.entries(ref).map(([name,value]) => <input key={name} type="hidden" name={name} value={value} />);
                return <>
                  {extra?.my_place && <p role="status">On the waitlist · place {extra.my_place} of {extra.waiting}</p>}
                  {open && !event.registered && !extra?.my_place && !full && <ClubForm current={current} operation="register" label="Register for event" values={values} />}
                  {open && !event.registered && !extra?.my_place && full &&
                    <ActionForm action={clubEventAction} context={current} operation="waitlist" label="Join the waitlist">{hidden}<p className="meta">This event is full.</p></ActionForm>}
                  {active && current.role === "student" && (extra?.my_place || (event.registered && !event.verified && ["registration_open","registration_closed"].includes(event.state) && new Date(event.starts_at) > new Date())) &&
                    <ActionForm action={clubEventAction} context={current} operation="withdraw" label={extra?.my_place ? "Leave the waitlist" : "Give up my seat"} secondary>{hidden}</ActionForm>}
                  {active && current.role === "student" && event.registered && event.state === "completed" && !extra?.my_feedback &&
                    <ActionForm action={clubEventAction} context={current} operation="feedback" label="Send feedback">{hidden}
                      <label>How was it?<select name="rating" defaultValue="4">{[5,4,3,2,1].map(n => <option key={n} value={n}>{n} of 5</option>)}</select></label>
                      <label>What should change next time? (optional)<textarea name="comment" maxLength={1000} /></label>
                    </ActionForm>}
                  {extra?.my_feedback && <p className="meta">Thanks for your feedback.</p>}
                  {officer && (extra?.waiting ?? 0) > 0 && <p className="meta">{extra!.waiting} waiting</p>}
                  {officer && event.state === "completed" && <section aria-label={`Feedback for ${event.title}`}>
                    <p>{extra?.responses ? `Feedback · ${extra.responses} responses · average ${extra.average} of 5` : "No feedback yet"}</p>
                    {!!extra?.comments.length && <ul className="items">{extra.comments.map((comment,index) => <li key={index}>{comment}</li>)}</ul>}
                  </section>}
                </>;
              })()}
              {available.length > 0 && <ClubForm current={current} operation="event-state" label="Update event status" values={values}>
                <label>Next event status<select name="next">{available.map(next=><option key={next} value={next}>{eventLabels[next]}</option>)}</select></label>
              </ClubForm>}
              {officer && event.total > 0 && view.participantEvent !== event.id && <Link href={`/clubverse/${id}?${query}&participants=${event.id}#event-${event.id}`}>View participants</Link>}
              {officer && view.participantEvent === event.id && <details><summary>Participants and evidence</summary>
                <ul className="items">{attendance.map(person => <li key={person.account_id}>
                  <strong>{person.name}</strong> <span className="meta">{person.verified_at ? "Verified" : "Unverified"}</span>
                  {person.evidence && <p className="prose-text">{person.evidence}</p>}
                  {!person.verified_at && person.account_id !== current.account && ["in_progress","completed"].includes(event.state) &&
                    <ClubForm current={current} operation="verify" label="Verify participation" values={{ ...values,person:person.account_id }}>
                      <label>Attendance evidence<input name="note" required maxLength={2000} /></label>
                    </ClubForm>}
                </li>)}</ul>
                <nav className="row" aria-label="Participant pages">
                  {view.participantPage>0 && <Link href={`/clubverse/${id}?${query}&participants=${event.id}&page=${view.participantPage-1}#event-${event.id}`}>Previous page</Link>}
                  {view.moreParticipants && <Link href={`/clubverse/${id}?${query}&participants=${event.id}&page=${view.participantPage+1}#event-${event.id}`}>Next page</Link>}
                </nav>
              </details>}
            </article>;
          })}
        </section>
      </div>
      <div className="stack">
        {member && <section className="panel"><h2>Member area</h2><p>Member events appear in Events. Registration and attendance are tracked separately.</p></section>}
        {officer && <section className="panel stack"><h2>Organizer console</h2><Link href={`/aura?${query}&club=${id}`}>Plan an event with AURA</Link>
          <ClubForm current={current} operation="event-draft" label="Save event draft" values={key}>
            <EventFields timezone={club.timezone} />
          </ClubForm>
        </section>}
        {officer && <section className="panel stack"><h2>Membership management</h2>
          {candidates.length > 0 && <ClubForm current={current} operation="membership" label="Invite member" values={{ ...key,next:"invited" }}>
            <label>Invite person<select name="person">{candidates.map(person => <option key={person.account_id} value={person.account_id}>{person.name}</option>)}</select></label>
          </ClubForm>}
          <ul className="items">{people.map(person => <li key={person.account_id}>
            <strong>{person.name}</strong> · {person.state}
            {person.state === "requested" && <ClubForm current={current} operation="membership" label="Review membership" values={{ ...key,person:person.account_id }}>
              <label>Membership decision<select name="next"><option value="active">Approve membership</option><option value="declined">Decline request</option></select></label>
            </ClubForm>}
            {person.state === "active" && person.account_id !== current.account && person.account_id !== club.lead_id &&
              <ClubForm current={current} operation="membership" label="End membership" values={{ ...key,person:person.account_id,next:"ended" }} />}
          </li>)}</ul>
        </section>}
        {lead && <section className="panel stack"><h2>Officer grants</h2>
          {people.some(person => person.state === "active" && person.account_id !== current.account) &&
            <ClubForm current={current} operation="grant" label="Grant club role" values={key}>
              <label>Active member<select name="person">{people.filter(person => person.state === "active" && person.account_id !== current.account)
                .map(person => <option key={person.account_id} value={person.account_id}>{person.name}</option>)}</select></label>
              <label>Club role<select name="kind"><option value="officer">Officer</option><option value="advisor">Faculty advisor</option></select></label>
            </ClubForm>}
          {grants.map(grant => <div key={grant.id}><p>{grant.name} · {grant.kind}</p>
            <ClubForm current={current} operation="revoke" label="End club grant" values={{ ...key,grant:grant.id }} />
          </div>)}
        </section>}
        {(lead || admin) && <section className="panel stack"><h2>Leadership handover</h2>
          {lead && people.some(person => person.state === "active" && person.account_id !== current.account) && !handovers.some(item => !item.approved_at && !item.cancelled_at) &&
            <ClubForm current={current} operation="handover" label="Submit handover" values={key}>
              <label>Incoming lead<select name="person">{people.filter(person => person.state === "active" && person.account_id !== current.account)
                .map(person => <option key={person.account_id} value={person.account_id}>{person.name}</option>)}</select></label>
              <label>Handover documentation<textarea name="note" maxLength={4000} required /></label>
            </ClubForm>}
          {handovers.map(handover => <div key={handover.id}>
            <h3>{handover.name} · {handover.approved_at ? "Approved" : handover.cancelled_at ? "Cancelled" : "Awaiting approval"}</h3>
            <p className="prose-text">{handover.notes}</p>
            {admin && active && !handover.approved_at && !handover.cancelled_at && <ClubForm current={current} operation="approve-handover" label="Approve leadership transfer" values={{ ...key,id:handover.id }} />}
            {active && !handover.approved_at && !handover.cancelled_at && <ClubForm current={current} operation="cancel-handover" label="Cancel handover" values={{ ...key,id:handover.id }} />}
          </div>)}
        </section>}
      </div>
    </div>
  </Chrome>;
}
