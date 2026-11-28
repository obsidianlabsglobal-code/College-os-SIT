import { maintenanceDesk } from "../../lib/transport/maintenance";
import { officeAccidentResponses,riderReplacements } from "../../lib/transport/incident-responses";
import { SosDesk,TransportOversight } from "./oversight";
import { busSosDesk,availableRouteTeachers } from "../../lib/transport/sos";
import { transportOversight } from "../../lib/transport/oversight";
import { backupView } from "../../lib/transport/rider-backup";
import { officeBoardingDevices,officeBoardingLog,riderBoardingHistory } from "../../lib/transport/boarding";
import { BoardingOffice,RiderBoarding } from "./boarding-workspace";
import { officeEtaFeedback } from "../../lib/transport/feedback";
import { DisruptionOffice, DisruptionRider } from "./notices";
import { officeDisruptions, riderDisruptions } from "../../lib/transport/disruptions";
import { riderTransportPreferences } from "../../lib/transport/pickup-alerts";
import { BusTimeline } from "./timeline";
import { studentTimeline } from "../../lib/transport/student-timeline";
import { officeTripList, studentActiveTrip } from "../../lib/transport/trips";
import { transportDevices } from "../../lib/transport/telemetry";
import { OfficeOperations } from "./operations";
import Link from "next/link";
import { notFound } from "next/navigation";
import { account, scope, workspaceQuery } from "../../lib/scope";
import { transportCatalog, type TransportRoute } from "../../lib/transport/catalog";
import { transportAction } from "../actions/transport";
import { Chrome } from "../chrome";
import { ActionForm } from "../forms";
import { PageHeader } from "../page-header";

const day=["","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const routeName=(r:TransportRoute)=>`${r.code} · ${r.label}`;
const h=(name:string,value:string|number)=><input type="hidden" name={name} value={value} />;

export default async function Transport({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
  const [p,user]=await Promise.all([searchParams,account()]);
  const s=await scope(p.institution,p.role);
  if(s.role==="driver") return <Chrome user={user} current={s} section="/transport">
    <PageHeader title="Driver transport tools" parent={{href:`/?${workspaceQuery(s)}`,label:"Workspace"}}
      context="Only use the boarding controls when the vehicle is parked." />
    <section className="panel stack"><h2>Bus boarding screen</h2>
      <p>Ask the transport office for the credential assigned to this bus. No personal phone number or rider roster is shown on the screen.</p>
      <p><Link href="/transport/board" className="button">Open boarding screen</Link></p>
    </section>
  </Chrome>;
  if(s.role==="faculty") {
    const assigned=await busSosDesk(s);
    return <Chrome user={user} current={s} section="/transport"><SosDesk alerts={assigned}/></Chrome>;
  }
  if(s.role!=="transport" && s.role!=="student") notFound();
  const office=s.role==="transport";
  const [catalog,ops,active,devices,timeline,riderPrefs,incidents,notices,feedback,boardDevices,boardLog,boardingHistory]=await Promise.all([transportCatalog(s),officeTripList(s),studentActiveTrip(s),transportDevices(s),studentTimeline(s),riderTransportPreferences(s),officeDisruptions(s),riderDisruptions(s),officeEtaFeedback(s),officeBoardingDevices(s),officeBoardingLog(s),riderBoardingHistory(s)]);
  const configuredTiles=process.env.NEXUS_TRANSPORT_TILE_TEMPLATE??"https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  const tiles=process.env.NEXUS_TRANSPORT_TILES_ENABLED==="true" && /^https:\/\/[a-z0-9.-]+\/[a-zA-Z0-9/e_.{}-]+$/.test(configuredTiles) &&
    ["{z}","{x}","{y}"].every(x=>configuredTiles.includes(x)) ? configuredTiles : null;
  const choice=catalog?.choice;
  const selected=catalog?.routes.find(r=>r.id===choice?.route_id);
  const stop=selected?.stops.find(t=>t.id===choice?.stop_id);
  const [backup,oversight,sos,teachers,accidents,replacements,maintenance]=await Promise.all([timeline?backupView(s,timeline.trip):null,
    transportOversight(s),busSosDesk(s),availableRouteTeachers(s),officeAccidentResponses(s),riderReplacements(s),maintenanceDesk(s)]);
  const firstRun=!office && Boolean(catalog) && !stop;
  return <Chrome user={user} current={s} section="/transport">
    <PageHeader title={office?"Transport office":firstRun?"Choose your bus and stop":"My bus"} parent={{href:`/?${workspaceQuery(s)}`,label:"Workspace"}}
      context={office?"Configure routes, ordered stops, vehicles and weekly service.":firstRun
        ?"Pick your route and pickup stop below. You can change it for future trips."
        :"Choose your bus and pickup stop. A change applies to your next trip."} />
    {!catalog && <p className="panel">Transport is not available for this department.</p>}
    {catalog && office && <section className="panel stack">
      <h2>Transport setup</h2>
      <details><summary>Add a route</summary>
        <ActionForm action={transportAction} context={s} operation="create-route" label="Create route">
          <label>Route code<input name="code" required maxLength={30} /></label>
          <label>Route name<input name="title" required maxLength={120} /></label>
          <label>Direction<select name="direction"><option value="inbound">To campus</option><option value="outbound">From campus</option></select></label>
        </ActionForm>
      </details>
      <details><summary>Add a vehicle</summary>
        <ActionForm action={transportAction} context={s} operation="create-vehicle" label="Create vehicle">
          <label>Vehicle label<input name="title" required maxLength={80} /></label>
          <label>Seats<input name="seats" type="number" min={1} max={250} required /></label>
          <label>Permitted capacity<input name="capacity" type="number" min={1} max={300} required /></label>
        </ActionForm>
        {!!catalog.vehicles.length && <ul className="items">{catalog.vehicles.map(v=><li key={v.id}>{v.label} · {v.seat_capacity} seats</li>)}</ul>}
      </details>
    </section>}
    {firstRun && <section className="panel stack" aria-label="Bus setup">
      <h2>Set up your first ride</h2>
      <p>Review the routes below, choose the stop you use, then save. A full route isn’t open to new riders.</p>
      <p className="meta">If none of these routes is yours, contact the transport office before choosing one.</p>
    </section>}
    {catalog && !office && !firstRun && <section className="panel stack" aria-label="Next trip preference">
      <h2>Your next trip preference</h2>
      {selected && stop ? <p>{routeName(selected)} · {stop.label}</p> : <p>No bus or stop selected.</p>}
      <p className="meta">Scheduled times are not live arrival predictions.</p>
      {active && <p><strong>{active.mode==="simulated"?"Simulated active trip":"Active trip"}</strong>: {active.route} · {active.vehicle} · {active.stop} at {active.scheduled_at} IST (scheduled)</p>}
    </section>}
    {catalog && !office && !firstRun && <DisruptionRider current={s} notices={notices} trip={active?.id} replacements={replacements} />}
    {riderPrefs && !firstRun && <section className="panel stack"><h2>Bus alerts</h2>
      <ActionForm action={transportAction} context={s} operation="save-transport-prefs" label="Save bus alert preferences">
        <label>Notice language<select name="locale" defaultValue={riderPrefs.notice_language}><option value="en">English</option><option value="kn">ಕನ್ನಡ</option></select></label>
        <label><input name="phoneAlerts" type="checkbox" defaultChecked={riderPrefs.phone_alerts}/> Also request phone alerts when available</label>
      </ActionForm>
      <p className="meta">In-app information is always shown when available. Phone alerts require enabled notifications and a connection.</p>
    </section>}
    {timeline && !firstRun && <BusTimeline key={`${timeline.trip}:${timeline.boarded}:${backup?.opted??false}`} initial={timeline} institution={s.institution} tiles={tiles} backupOpted={Boolean(backup?.opted)} />}
    {catalog && !office && !firstRun && <RiderBoarding current={s} active={Boolean(timeline)} history={boardingHistory}/>}
    {timeline && boardingHistory.some(b=>b.trip===timeline.trip) && <section className="panel stack" aria-label="Bus assistance">
      <h2>Need help on the bus?</h2>
      <p>This records a request for college transport staff. It does not call emergency services. If you are in immediate danger, seek emergency assistance directly when safe.</p>
      <ActionForm action={transportAction} context={s} operation="bus-sos" label="Bus SOS"
        confirmation={timeline.mode==="simulated"?"This records a fictional SOS in the test environment.":"Confirm you need assistance from college transport staff."}
        confirmationTitle="Confirm bus SOS" confirmationLabel="Send bus SOS">
        {h("trip",timeline.trip)}
      </ActionForm>
    </section>}
    {timeline && backup && !firstRun && <section className="panel stack" aria-label="Optional backup location">
      <h2>Optional backup location</h2>
      <p>Off until you choose it. If the bus signal has gone quiet after boarding, you may share your phone’s position while this page is open. It estimates the bus location only, is not used to prove boarding, and is deleted when the trip ends or you withdraw.</p>
      <ActionForm action={transportAction} context={s} operation="backup-consent" label={backup.opted?"Withdraw location consent":"Allow backup for this trip"} secondary>
        {h("trip",timeline.trip)}{h("enabled",String(!backup.opted))}
      </ActionForm>

    </section>}
    {timeline?.position && <section className="panel stack"><h2>Was this ETA right?</h2>
      <ActionForm action={transportAction} context={s} operation="eta-feedback" label="Send ETA feedback" secondary>
        {h("trip",timeline.trip)}
        <label>Was the estimated time accurate?<select name="accurate"><option value="yes">Yes</option><option value="no">No</option></select></label>
        <label>Short comment (optional)<input name="comment" maxLength={250}/></label>
      </ActionForm>
    </section>}
    {catalog?.routes.map(r=><section key={r.id} className="panel stack" aria-label={routeName(r)}>
      <h2 style={{overflowWrap:"anywhere"}}>{routeName(r)}</h2>
      <p className="meta">{r.direction==="inbound"?"To campus":"From campus"} · {r.choice_locked?"Full for new riders":"Open to route choices"}</p>
      {r.stops.length>0 && <ol className="items">{r.stops.map(t=><li key={t.id}>{t.label} · +{t.offset} min from departure</li>)}</ol>}
      {r.schedules.length>0 ? <ul className="items">{r.schedules.map(t=><li key={t.id}>
        {day[t.day]} {t.departure} IST · {t.vehicle}
        {office && <ActionForm action={transportAction} context={s} operation="retire-schedule" label="Retire schedule" secondary>{h("schedule",t.id)}</ActionForm>}
      </li>)}</ul>:<p>No scheduled service yet.</p>}
      {office && <details><summary>Publish route stops</summary>
        <ActionForm action={transportAction} context={s} operation="publish-stops" label="Save ordered stop list">
          {h("route",r.id)}{h("expected",r.published_revision??0)}
          <p className="meta">One stop per line: stop name | latitude | longitude | minutes from departure. Start at minute 0.</p>
          <label>Stop list<textarea name="stopText" rows={5} required defaultValue={r.stops.map(t=>[t.label,t.lat,t.lon,t.offset].join(" | ")).join("\n")} /></label>
        </ActionForm>
      </details>}
      {office && r.published_revision && <details><summary>Schedule weekly service</summary>
        {catalog?.vehicles.length ? <ActionForm action={transportAction} context={s} operation="create-schedule" label="Save weekly service">
          {h("route",r.id)}
          <label>Vehicle<select name="vehicle" required defaultValue=""><option value="" disabled>Choose a vehicle</option>{catalog.vehicles.map(v=><option key={v.id} value={v.id}>{v.label}</option>)}</select></label>
          <label>Service day<select name="weekday">{day.slice(1).map((x,i)=><option key={x} value={i+1}>{x}</option>)}</select></label>
          <label>Departure (IST)<input name="departure" type="time" required /></label>
        </ActionForm>:<p>Add a vehicle to create a schedule.</p>}
      </details>}
      {office && <ActionForm action={transportAction} context={s} operation="lock-route" label={r.choice_locked?"Allow new riders":"Mark bus full"} secondary>
        {h("route",r.id)}{h("locked",String(!r.choice_locked))}
      </ActionForm>}
      {!office && (!r.choice_locked || choice?.route_id===r.id) && r.stops.length>0 &&
        <ActionForm action={transportAction} context={s} operation="student-choice" label="Save next trip choice">
          {h("route",r.id)}
          <label>Pickup stop<select name="stop" defaultValue={choice?.route_id===r.id?choice.stop_id:""} required>
            <option value="" disabled>Choose a stop</option>{r.stops.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}
          </select></label>
        </ActionForm>}
    </section>)}
    {catalog && office && <DisruptionOffice current={s} data={incidents} routes={catalog.routes} responses={accidents} />}
    {catalog && office && <BoardingOffice current={s} vehicles={catalog.vehicles} devices={boardDevices} log={boardLog}/> }
    {office && feedback.length>0 && <section className="panel stack"><h2>Recent ETA feedback</h2><ul className="items">
      {feedback.map(f=><li key={f.id}>{f.route} · {f.day} · {f.accurate?"Reported accurate":"Reported inaccurate"}{f.comment?` · ${f.comment}`:""}</li>)}
    </ul></section>}
    {catalog && office && <TransportOversight current={s} data={oversight} teachers={teachers} routes={catalog.routes} maintenance={maintenance} vehicles={catalog.vehicles} />}
    {office && <SosDesk alerts={sos}/>}
    {catalog && office && <OfficeOperations current={s} catalog={catalog} ops={ops} devices={devices} />}
    {catalog && catalog.routes.length===0 && <p className="panel">No routes are available yet.</p>}
  </Chrome>;
}
