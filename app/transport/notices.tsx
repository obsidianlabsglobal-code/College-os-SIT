import {OfficeWarningPoll} from "./office-warning-poll";
import type {Scope} from "../../lib/scope";
import { disruptionKinds } from "../../lib/transport/disruption-copy";
import type { officeDisruptions,riderDisruptions } from "../../lib/transport/disruptions";
import type {officeAccidentResponses,riderReplacements} from "../../lib/transport/incident-responses";
import type {TransportRoute} from "../../lib/transport/catalog";
import {ActionForm} from "../forms";
import {transportAction} from "../actions/transport";
const hidden=(name:string,value:string|number)=><input type="hidden" name={name} value={value}/>;
const kinds:Record<typeof disruptionKinds[number],string>={
  puncture:"Flat tyre",breakdown:"Breakdown",road_block:"Road closure",accident_no_injuries:"Accident; no injuries reported",
  accident_injury:"Accident with injury",heavy_traffic:"Heavy traffic",weather_flooding:"Bad weather or flooding",fuel:"Fuel issue",
  driver_delayed:"Delayed departure",route_diverted:"Route diverted",trip_cancelled:"Trip cancelled",
};
function Timing({routes}:{routes:TransportRoute[]}){
  return <>
    <label>Timing<select name="clock"><option value="update">Promise an update</option><option value="eta">Estimated arrival</option><option value="actual">Recorded arrival for all-clear</option></select></label>
    <label>Date and time (IST)<input type="datetime-local" name="when" required /></label>
    <label>Minutes late (optional, estimate only)<input name="delay" type="number" min={0} max={240}/></label>
    <label>What riders should do<select name="action">
      <option value="await_staff">Follow transport staff directions</option><option value="wait_at_stop">Wait at their stop</option>
      <option value="take_route">Take another route</option><option value="replacement">Wait for the replacement bus</option>
      <option value="resume">Continue as directed (all-clear)</option>
    </select></label>
    <label>Optional English message edit<textarea name="noteEn" maxLength={160}/></label>
    <label>Optional Kannada message edit<textarea name="noteKn" maxLength={160}/></label>
    <p className="meta">The standard message keeps the stop, timing and action. Add a short, confirmed clarification without names, phone numbers or coordinates.</p>
    <label>Alternative route (if selected)<select name="alternative"><option value="">Not applicable</option>
      {routes.filter(r=>r.published_revision).map(r=><option key={r.id} value={r.id}>{r.code} · {r.label}</option>)}</select></label>
  </>;
}
const time=new Intl.DateTimeFormat("en-IN",{timeZone:"Asia/Kolkata",dateStyle:"short",timeStyle:"short"});
export function DisruptionOffice({current,data,routes,responses}:{current:Scope;data:Awaited<ReturnType<typeof officeDisruptions>>;routes:TransportRoute[];
  responses:Awaited<ReturnType<typeof officeAccidentResponses>>}){
  return <section className="panel stack" id="disruptions" aria-label="Bus disruptions">
    <OfficeWarningPoll institution={current.institution}/>
    <h2>Bus disruptions</h2>
    <p>In-app notices use each rider’s selected language. Only confirmed transport information should be published.</p>
    {data.trips.map(t=><details key={t.id}><summary>{t.name} · {t.mode==="simulated"?"Simulated":"Live"} · {t.state}</summary>
      <ActionForm action={transportAction} context={current} operation="open-disruption" label="Publish disruption notice" confirmation="Confirm the incident, timing and what riders should do.">
        {hidden("trip",t.id)}
        <label>Incident type<select name="kind">{disruptionKinds.filter(k=>t.state==="active"||k==="trip_cancelled").map(k=><option key={k} value={k}>{kinds[k]}</option>)}</select></label>
        <label>Closest confirmed stop<select name="stop" defaultValue="" required><option value="" disabled>Choose a named stop</option>{t.stops.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
        <Timing routes={routes}/>
      </ActionForm>
    </details>)}
    {!data.events.length && <p>No disruption history.</p>}
    {data.events.map(e=><section className="panel stack" key={e.id} aria-label={`${e.vehicle}: ${e.kind}`}>
      <h3>{e.vehicle} · {kinds[e.kind as keyof typeof kinds]}</h3>
      <p>{e.location} · {e.state} · {e.age} minutes {e.state==="resolved"?"to resolve":"since reporting"}</p>
      {e.photo && <p><a href={`/api/transport/driver/photo?institution=${current.institution}&incident=${e.id}`}>Open private driver photo</a></p>}
      {e.overdue && <p className="error" role="status">The promised update is overdue.</p>}
      <ol className="items">{e.history.map(n=><li key={n.sequence}>{time.format(new Date(n.at))} IST · {n.stage.replaceAll("_"," ")} · {n.read} of {n.receipts} read
        {n.readers.length>0&&<details><summary>Read by</summary><p>{n.readers.join(", ")}</p></details>}</li>)}</ol>
      {responses.filter(r=>r.incident===e.id).map((r,i)=><p key={i}>{r.name}: {r.response==="safe"?"Safe":"Needs help"} · {time.format(r.at)} IST</p>)}
      {e.state==="open" && data.trips.some(t=>t.state==="active") && <details><summary>Assign replacement trip</summary>
        <ActionForm action={transportAction} context={current} operation="replacement-trip" label="Save replacement trip">
          {hidden("incident",e.id)}<label>Replacement and meeting stop<select name="replacement" required defaultValue=""><option value="" disabled>Choose a replacement</option>
            {data.trips.filter(t=>t.state==="active").flatMap(t=>t.stops.map(st=><option key={t.id+st.id} value={t.id+":"+st.id}>{t.name} · {st.label}</option>))}
          </select></label>
        </ActionForm>
      </details>}
      {e.state==="open" && <details><summary>Publish follow-up</summary>
        <ActionForm action={transportAction} context={current} operation="publish-disruption" label="Publish follow-up" confirmation="Check the current status and timing before publishing.">
          {hidden("incident",e.id)}{hidden("expected",e.sequence)}
          <label>Follow-up type<select name="stage"><option value="update">Update</option><option value="all_clear">All-clear</option></select></label>
          <Timing routes={routes}/>
        </ActionForm>
      </details>}
    </section>)}
  </section>;
}
export function DisruptionRider({current,notices,trip,replacements}:{current:Scope;notices:Awaited<ReturnType<typeof riderDisruptions>>;trip?:string;
  replacements:Awaited<ReturnType<typeof riderReplacements>>}){
  if(!notices.length&&!trip)return null;
  return <section className="panel stack" aria-label="Bus notices">
    <h2>Bus notices</h2>
    {replacements.map(r=><section className="panel stack" key={r.incident}><h3>{r.mode==="simulated"?"Simulated replacement":"Replacement bus"}: {r.vehicle}</h3>
      <p>Meeting stop: {r.stop} · {r.expected?`Estimated ${time.format(new Date(r.expected))} IST`:"No live estimate"}</p>
      {r.updated&&<p className="meta">Last position update {time.format(new Date(r.updated))} IST</p>}
    </section>)}
    {notices.map(n=><div className="stack" key={`${n.id}:${n.seq}`}>
      <p lang={n.locale}>{n.body}</p>
      {n.check_in && !notices.some(o=>o.id===n.id&&o.seq>n.seq) && <div className="row" style={{flexWrap:"wrap"}}>
        <ActionForm action={transportAction} context={current} operation="accident-response" label={n.locale==="kn"?"ನಾನು ಸುರಕ್ಷಿತವಾಗಿದ್ದೇನೆ":"I’m safe"} secondary>
          {hidden("incident",n.id)}{hidden("response","safe")}</ActionForm>
        <ActionForm action={transportAction} context={current} operation="accident-response" label={n.locale==="kn"?"ನನಗೆ ಸಹಾಯ ಬೇಕು":"I need help"} secondary>
          {hidden("incident",n.id)}{hidden("response","need_help")}</ActionForm>
      </div>}
      {!n.read && <ActionForm action={transportAction} context={current} operation="read-disruption" label="Mark notice read" secondary>
        {hidden("incident",n.id)}{hidden("sequence",n.seq)}</ActionForm>}
    </div>)}
    {trip && <details><summary>Report a problem with this ride</summary>
      <ActionForm action={transportAction} context={current} operation="report-bus" label="Send ride report">
        {hidden("trip",trip)}
        <label>Summary<input name="summary" required maxLength={120}/></label>
        <label>What happened on the ride?<textarea name="body" required maxLength={1000}/></label>
      </ActionForm>
    </details>}
  </section>;
}
