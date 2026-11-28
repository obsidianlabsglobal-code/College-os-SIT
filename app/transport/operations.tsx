import type { Scope } from "../../lib/scope";
import type { transportCatalog } from "../../lib/transport/catalog";
import type { officeTripList } from "../../lib/transport/trips";
import type { transportDevices } from "../../lib/transport/telemetry";
import { transportAction } from "../actions/transport";
import { ActionForm } from "../forms";

const hidden=(name:string,value:string)=><input type="hidden" name={name} value={value}/>;
export function OfficeOperations({current,catalog,ops,devices}:{
  current:Scope;catalog:NonNullable<Awaited<ReturnType<typeof transportCatalog>>>;
  ops:Awaited<ReturnType<typeof officeTripList>>;devices:Awaited<ReturnType<typeof transportDevices>>;
}){
  const schedules=catalog.routes.flatMap(r=>r.schedules.map(s=>({...s,route:r.label})));
  const enabled=process.env.NEXUS_TRANSPORT_LIVE_ENABLED==="true";
  return <section className="panel stack" aria-label="Trip and device operations">
    <h2>Trip and device operations</h2>
    <p className="meta">Live operation is {enabled?"enabled for authorized devices":"off"}.</p>
    <details><summary>Create a trip</summary>
      {schedules.length ? <ActionForm action={transportAction} context={current} operation="create-trip" label="Create dated trip">
        <label>Weekly schedule<select name="schedule" required defaultValue=""><option value="" disabled>Choose a schedule</option>
          {schedules.map(q=><option key={q.id} value={q.id}>{q.route} · {q.vehicle} · {q.departure} IST</option>)}
        </select></label>
        <label>Trip date (IST)<input name="day" type="date" required /></label>
        <label>Tracking mode<select name="mode"><option value="simulated">Simulated</option>{enabled && <option value="live">Live</option>}</select></label>
        <label>Approved driver (required for live)<select name="driver"><option value="">Choose a driver</option>
          {ops.drivers.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
      </ActionForm>:<p>Create a weekly schedule first.</p>}
    </details>
    {ops.trips.length ? <ul className="items">{ops.trips.map(t=><li key={t.id}>
      <p><strong>{t.route}</strong> · {t.vehicle}</p>
      <p>{t.day} {t.departure} IST · {t.mode==="simulated"?"Simulated":"Live"} · {t.state}</p>
      {t.state==="scheduled" && <ActionForm action={transportAction} context={current} operation="start-trip" label="Start trip">
        {hidden("trip",t.id)}</ActionForm>}
      {t.state==="active" && <ActionForm action={transportAction} context={current} operation="complete-trip" label="Complete trip">
        {hidden("trip",t.id)}</ActionForm>}
      {(t.state==="active"||t.state==="scheduled") && <ActionForm action={transportAction} context={current} operation="cancel-trip" label="Cancel trip" secondary
        confirmation="This ends this trip and closes its tracking window." confirmationTitle="Cancel trip" confirmationLabel="Confirm cancellation">
        {hidden("trip",t.id)}</ActionForm>}
      {t.state==="active" && t.mode==="simulated" && process.env.NEXUS_TRANSPORT_SIMULATION_ENABLED==="true" && <details><summary>Publish fictional position</summary>
        <ActionForm action={transportAction} context={current} operation="simulated-position" label="Publish simulated location">
          {hidden("trip",t.id)}
          <label>Fixture latitude<input name="lat" type="number" step="any" min="-90" max="90" required/></label>
          <label>Fixture longitude<input name="lon" type="number" step="any" min="-180" max="180" required/></label>
          <label>Fixture bus speed (km/h, optional)<input name="speed" type="number" min={0} max={150} step="any"/></label>
        </ActionForm>
      </details>}
    </li>)}</ul>:<p>No dated trips yet.</p>}
    <details><summary>Bind a telemetry phone</summary>
      {catalog.vehicles.length>0 ? <ActionForm action={transportAction} context={current} operation="issue-device" label="Issue one-time telemetry token">
        <label>Vehicle for binding<select name="vehicle" required defaultValue=""><option value="" disabled>Choose a vehicle</option>
          {catalog.vehicles.map(v=><option key={v.id} value={v.id}>{v.label}</option>)}</select></label>
        <label>Device label<input name="label" maxLength={100} required /></label>
        <label>Client mode<select name="protocol"><option value="stock">Traccar Client</option><option value="sdk">SDK with Authorization header</option></select></label>
        <label>Configured SDK client ID (SDK only)<input name="clientId" maxLength={100} /></label>
      </ActionForm>:<p>Add a vehicle before binding a phone.</p>}
      {devices.length>0 && <ul className="items">{devices.map(d=><li key={d.id}><p>{d.name} · {d.vehicle} · {d.revoked?"Revoked":"Bound"}</p>
        {!d.revoked && <ActionForm action={transportAction} context={current} operation="revoke-device" label="Revoke device" secondary confirmation="The device will stop being able to send new reports.">
          {hidden("device",d.id)}
        </ActionForm>}
      </li>)}</ul>}
    </details>
    <ActionForm action={transportAction} context={current} operation="purge-history" label="Remove positions older than seven days" secondary />
  </section>;
}
