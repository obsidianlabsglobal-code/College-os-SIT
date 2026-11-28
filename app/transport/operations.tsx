import type { Scope } from "../../lib/scope";
import type { transportCatalog } from "../../lib/transport/catalog";
import type { officeTripList } from "../../lib/transport/trips";
import type { transportDevices } from "../../lib/transport/telemetry";
import { transportAction } from "../actions/transport";
import { officeDriverQueue } from "../../lib/transport/driver-office";
import { driverPhoneList } from "../../lib/transport/driver-phone";
import { ActionForm } from "../forms";

const hidden=(name:string,value:string)=><input type="hidden" name={name} value={value}/>;
export async function OfficeOperations({current,catalog,ops,devices}:{
  current:Scope;catalog:NonNullable<Awaited<ReturnType<typeof transportCatalog>>>;
  ops:Awaited<ReturnType<typeof officeTripList>>;devices:Awaited<ReturnType<typeof transportDevices>>;
}){
  const [phones,driverQueue]=await Promise.all([driverPhoneList(current),officeDriverQueue(current)]);
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
    <details><summary>Set up a NEXUS Driver phone</summary>
      <ActionForm action={transportAction} context={current} operation="bind-driver-phone" label="Issue driver phone enrollment code">
        <label>Bus<select name="vehicle" required defaultValue=""><option value="" disabled>Select bus</option>
          {catalog.vehicles.map(v=><option key={v.id} value={v.id}>{v.label}</option>)}</select></label>
        <label>Driver<select name="driver" required defaultValue=""><option value="" disabled>Select driver</option>
          {ops.drivers.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label>Driver PIN (4 digits)<input name="primaryPin" type="password" pattern="[0-9]{4}" inputMode="numeric" required autoComplete="new-password"/></label>
        <label>Backup driver<select name="backup" defaultValue=""><option value="">No backup</option>
          {ops.drivers.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label>Distinct backup PIN (4 digits, when used)<input name="backupPin" type="password" pattern="[0-9]{4}" inputMode="numeric" autoComplete="new-password"/></label>
      </ActionForm>
      <ActionForm action={transportAction} context={current} operation="driver-office-contact" label="Set driver SOS callback">
        <label>Transport office phone<input type="tel" name="phone" required /></label>
      </ActionForm>
      {phones.filter(p=>!p.revoked).map(p=><ActionForm key={p.id} action={transportAction} context={current} operation="revoke-driver-phone" label={`Revoke ${p.driver} · ${p.vehicle} phone`}>
        {hidden("device",p.id)}
      </ActionForm>)}
    </details>
    <details><summary>Driver messages, documents and leave</summary>
      <ActionForm action={transportAction} context={current} operation="driver-send-message" label="Send office message">
        <label>Trip<select name="trip" defaultValue="" required><option value="" disabled>Select trip</option>
          {ops.trips.filter(t=>t.state==="scheduled"||t.state==="active").map(t=><option key={t.id} value={t.id}>{t.vehicle} · {t.day} {t.departure}</option>)}</select></label>
        <label>Kind<select name="kind"><option value="replacement">Replacement bus</option><option value="diversion">Diversion</option><option value="stop_change">Stop change</option></select></label>
        <label>English<textarea name="bodyEn" maxLength={240} required/></label><label>Kannada<textarea name="bodyKn" maxLength={240} required/></label>
      </ActionForm>
      {driverQueue.messages.map(m=><p key={m.id}>{m.vehicle} · {m.kind.replaceAll("_"," ")} · {m.read_at?"Acknowledged":"Not yet acknowledged"}</p>)}
      <ActionForm action={transportAction} context={current} operation="driver-document-expiry" label="Record document expiry">
        <label>Bus<select name="vehicle" required>{catalog.vehicles.map(v=><option key={v.id} value={v.id}>{v.label}</option>)}</select></label>
        <label>Driver<select name="driver" required>{ops.drivers.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label>Document<select name="kind"><option value="licence">Licence</option><option value="fitness">Bus fitness</option><option value="insurance">Insurance</option>
          <option value="permit">Permit</option><option value="puc">PUC</option></select></label>
        <label>Expiry date<input type="date" name="expiry" required/></label>
      </ActionForm>
      {driverQueue.requests.map(r=><div key={r.id}><p>{r.driver} · {r.vehicle} · {r.day} · {r.kind} · {r.state}</p>
        {r.state==="pending"&&<ActionForm action={transportAction} context={current} operation="driver-decide-leave" label="Record leave decision">
          {hidden("request",r.id)}<label>Decision<select name="decision"><option value="approved">Approve</option><option value="rejected">Reject</option></select></label>
        </ActionForm>}
      </div>)}
    </details>
    <ActionForm action={transportAction} context={current} operation="purge-history" label="Remove positions older than seven days" secondary />
  </section>;
}
