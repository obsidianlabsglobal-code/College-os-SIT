import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { eventBooking, resourceQueue } from "../../../lib/resource-views";
import { account, scope, workspaceQuery, type Scope } from "../../../lib/scope";
import { Chrome } from "../../chrome";
import { PageHeader } from "../../page-header";
import { ActionForm } from "../../forms";
import { resourceAction } from "./actions";

const states = {requested:"Awaiting custodian decision",confirmed:"Confirmed",declined:"Declined",cancelled:"Cancelled"} as const;

function Form({actor,operation,label,fields={},children}:{
  actor:Scope; operation:string;label:string;fields?:Record<string,string|number>;children?:ReactNode;
}) {
  return <ActionForm context={actor} action={resourceAction} operation={operation} label={label}>
    {Object.entries(fields).map(([name,value])=><input key={name} type="hidden" name={name} value={value}/>)}
    {children}
  </ActionForm>;
}

export default async function BookingPage({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}) {
  const [settings,user] = await Promise.all([searchParams,account()]);
  const actor = await scope(settings.institution,settings.role);
  if (!["student","faculty","admin"].includes(actor.role)) notFound();
  const query = workspaceQuery(actor);
  if (settings.event) {
    if (!z.uuid().safeParse(settings.event).success || actor.role === "admin") notFound();
    const data = await eventBooking(actor,settings.event);
    if (!data) notFound();
    const date = new Intl.DateTimeFormat("en-IN",{dateStyle:"medium",timeStyle:"short",timeZone:data.timezone});
    return <Chrome user={user} current={actor} section="/clubverse">
      <PageHeader title="Event booking" context={data.title} parent={{href:`/clubverse/${data.club_id}?${query}`,label:"Club events"}}/>
      <div className="stack">
        <section className="panel stack"><h2>Resources for this event</h2>
          <p>{date.format(data.starts_at)} to {date.format(data.ends_at)} ({data.timezone})</p>
          {data.canRequest ? <>
            <p className="meta">Availability applies to the event interval. A custodian confirms the reservation.</p>
            {data.resources.length ? <ul className="items">{data.resources.map(resource=>{
              const own = data.bookings.find(booking=>booking.resource_id===resource.id && ["requested","confirmed"].includes(booking.state));
              return <li key={resource.id}>
                <h3>{resource.name}</h3><p>{resource.location} · {resource.kind}{resource.capacity && ` · Capacity ${resource.capacity}`}</p>
                {own ? <p>{own.state==="confirmed" ? "Reserved for this event" : "Requested for this event"}</p> :
                  resource.busy ? <p>Unavailable during this event</p> :
                  <Form actor={actor} operation="request" label="Request resource" fields={{resource:resource.id,event:settings.event!}}/>}
              </li>;
            })}</ul> : <p>No resources have been added for this institution.</p>}
          </> : <p>New requests are closed for this event.</p>}
        </section>
        <section className="panel stack"><h2>Booking updates</h2>
          {!data.bookings.length && <p>No booking requests have been made.</p>}
          {data.bookings.map(booking=><article key={booking.id} className="stack">
            <h3>{booking.name}</h3><p>{states[booking.state as keyof typeof states]}</p>
            {booking.reason && <p className="prose-text">{booking.reason}</p>}
            {data.canCancel && ["requested","confirmed"].includes(booking.state) && <Cancel actor={actor} booking={booking}/>}
          </article>)}
        </section>
      </div>
    </Chrome>;
  }

  const page = z.coerce.number().int().min(1).max(1000).catch(1).parse(settings.page);
  const {bookings,timezone,admin} = await resourceQueue(actor,page);
  const date = new Intl.DateTimeFormat("en-IN",{dateStyle:"medium",timeStyle:"short",timeZone:timezone});
  return <Chrome user={user} current={actor} section="/clubverse">
    <PageHeader title="Resource bookings" parent={{href:`/clubverse?${query}`,label:"CLUBVERSE"}}/>
    <div className="stack">
      <section className="panel stack"><h2>Custodian queue</h2>
        {!bookings.length && <p>No bookings are available on this page for your current custodian assignments.</p>}
        {bookings.slice(0,25).map(booking=><article key={booking.id} className="stack">
          <h3>{booking.name}</h3><p>{date.format(booking.starts)} to {date.format(booking.ends)} ({timezone})</p>
          <p>{states[booking.state as keyof typeof states]}</p>
          {booking.reason && <p className="prose-text">{booking.reason}</p>}
          {booking.state==="requested" && !booking.own && <>
            <Form actor={actor} operation="confirm" label="Confirm booking" fields={{booking:booking.id,revision:booking.revision}}/>
            <Form actor={actor} operation="decline" label="Decline booking" fields={{booking:booking.id,revision:booking.revision}}>
              <label>Decline reason<textarea name="reason" required maxLength={400}/></label>
            </Form>
          </>}
          {["requested","confirmed"].includes(booking.state) && <Cancel actor={actor} booking={booking}/>}
        </article>)}
        <div className="row">
          {page>1 && <Link href={`?${query}&page=${page-1}`}>Previous page</Link>}
          {bookings.length>25 && page<1000 && <Link href={`?${query}&page=${page+1}`}>Next page</Link>}
        </div>
      </section>
      {admin && <section className="panel stack"><h2>Resource catalog and access</h2>
        <Form actor={actor} operation="create" label="Add resource">
          <label>Resource name<input name="name" required maxLength={100}/></label>
          <label>Type<select name="kind"><option value="room">Room</option><option value="equipment">Equipment</option></select></label>
          <label>Location<input name="location" required maxLength={180}/></label>
          <label>Verified capacity<input name="capacity" type="number" min={1} max={100000}/></label>
        </Form>
        {admin.resources.length>0 && admin.people.length>0 && <Form actor={actor} operation="grant" label="Grant custodian access">
          <label>Resource<select name="resource">{admin.resources.map(item=><option key={item.id} value={item.id}>{item.name} · {item.location}</option>)}</select></label>
          <label>Custodian<select name="account">{admin.people.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Access duration in days<input name="days" type="number" required min={1} max={365}/></label>
        </Form>}
        <ul className="items">{admin.grants.map(grant=><li key={grant.id}>
          <p>{grant.name} · {grant.person} · Ends {date.format(grant.ends_at)} ({timezone})</p>
          <Form actor={actor} operation="revoke" label="Revoke custodian access" fields={{grant:grant.id}}/>
        </li>)}</ul>
      </section>}
    </div>
  </Chrome>;
}

function Cancel({actor,booking}:{actor:Scope;booking:{id:string;revision:number}}) {
  return <Form actor={actor} operation="cancel" label="Cancel booking" fields={{booking:booking.id,revision:booking.revision}}>
    <label>Cancellation reason<textarea name="reason" required maxLength={400}/></label>
  </Form>;
}
