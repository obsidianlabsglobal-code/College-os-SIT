import type {Scope} from "../../lib/scope";
import type {busSosDesk,availableRouteTeachers} from "../../lib/transport/sos";
import type {maintenanceDesk} from "../../lib/transport/maintenance";
import type {transportOversight} from "../../lib/transport/oversight";
import type {TransportRoute} from "../../lib/transport/catalog";
import {ActionForm} from "../forms";
import {transportAction} from "../actions/transport";

const when=new Intl.DateTimeFormat("en-IN",{timeZone:"Asia/Kolkata",dateStyle:"short",timeStyle:"short"});
export function SosDesk({alerts}:{alerts:Awaited<ReturnType<typeof busSosDesk>>}){
  return <section className="panel stack" aria-label="Bus assistance requests">
    <h2>Bus assistance requests</h2>
    {!alerts.length&&<p>No transport assistance requests are assigned to you.</p>}
    {alerts.map(s=><article className="stack" key={s.id}>
      <h3>{s.vehicle} · {s.mode==="simulated"?"Simulated SOS":"SOS"}</h3>
      <p>Checked-in rider: {s.student}</p>
      <p>{s.position?`Last bus position near ${s.position}`:"No last bus position"}{s.at?` · ${when.format(s.at)} IST`:""}</p>
      <p>Last request {when.format(s.signal)} IST · {s.repeats} signal{s.repeats===1?"":"s"}</p>
    </article>)}
  </section>;
}
export function TransportOversight({current,data,teachers,routes,maintenance,vehicles}:{current:Scope;data:Awaited<ReturnType<typeof transportOversight>>;
  teachers:Awaited<ReturnType<typeof availableRouteTeachers>>;routes:TransportRoute[];
  maintenance:Awaited<ReturnType<typeof maintenanceDesk>>;vehicles:{id:string;label:string}[];}){
  return <section className="panel stack" aria-label="Transport administration">
    <h2>Transport administration</h2>
    {routes.length>0&&teachers.length>0&&<details><summary>Named teacher for SOS</summary>
      <ActionForm action={transportAction} context={current} operation="assign-route-teacher" label="Save route teacher">
        <label>Route<select name="route" required defaultValue=""><option value="" disabled>Choose a route</option>
          {routes.map(r=><option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
        <label>Named teacher<select name="faculty" required defaultValue=""><option value="" disabled>Choose a current teacher</option>
          {teachers.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      </ActionForm>
    </details>}
    <details><summary>Office-only bus fee status</summary>
      <p className="meta">A staff-entered status only. It does not take payments or restrict boarding.</p>
      {data.fees.length?data.fees.map(f=><ActionForm key={f.id} action={transportAction} context={current} operation="fee-status" label="Save fee status" secondary>
        <input type="hidden" name="student" value={f.id}/><p>{f.name} · {f.route}</p>
        <label>Bus fee status<select name="status" required defaultValue={f.status??""}>
          <option value="" disabled>Not recorded</option><option value="paid">Paid</option><option value="due">Due</option><option value="exempt">Exempt</option>
        </select></label>
      </ActionForm>):<p>No current riders to review.</p>}
    </details>
    <details><summary>Speed alerts</summary>
      <p className="meta">Off unless the institution approves it. A phone estimate is not proof of a violation.</p>
      <ActionForm action={transportAction} context={current} operation="speed-policy" label="Save speed policy" secondary>
        <label>Alert threshold (km/h)<input name="limit" type="number" min={10} max={120} required defaultValue={data.policy?.limit_kmh??70}/></label>
        <label><input name="enabled" type="checkbox" defaultChecked={data.policy?.enabled??false} disabled={process.env.NEXUS_TRANSPORT_OVERSPEED_APPROVED!=="true"}/> Enable authorized speed alerts</label>
      </ActionForm>
      {!!data.alerts.length&&<ul className="items">{data.alerts.map(a=><li key={a.id}>{a.vehicle} · sample {a.kmh} km/h above {a.threshold} km/h</li>)}</ul>}
    </details>
    <details><summary>Vehicle maintenance and breakdown history</summary>
      {vehicles.length>0 && <ActionForm action={transportAction} context={current} operation="maintenance-report" label="Add maintenance record">
        <label>Maintenance vehicle<select name="vehicle" required defaultValue=""><option value="" disabled>Choose a bus</option>
          {vehicles.map(v=><option key={v.id} value={v.id}>{v.label}</option>)}</select></label>
        <label>Fault or service summary<input name="summary" maxLength={180} required /></label>
      </ActionForm>}
      {maintenance.items.map(m=><article key={m.id} className="stack"><p><strong>{m.vehicle}</strong> · {m.summary}</p>
        {m.service?<p>Cleared {m.service}: {m.note}</p>:<ActionForm action={transportAction} context={current} operation="maintenance-clear"
          label="Record checked service and clearance" secondary>
          <input name="maintenance" type="hidden" value={m.id}/>
          <label>Actual service date<input name="day" type="date" required /></label>
          <label>Clearance note<input name="note" maxLength={300} required /></label>
        </ActionForm>}
      </article>)}
      <h3>Reported disruption patterns, last 30 days</h3>
      {maintenance.patterns.length?<ul className="items">{maintenance.patterns.map((m,i)=><li key={i}>
        {m.vehicle} · {m.route} · near {m.stop} · {m.kind.replaceAll("_"," ")} · around {m.hour}:00 IST · {m.count} reports
      </li>)}</ul>:<p>No recent recorded disruptions to compare.</p>}
    </details>
    <details><summary>Route insights, last 30 days</summary>
      <p className="meta">Based on recorded boardings, not student or driver location histories. No check-in is not proof that nobody rode.</p>
      {data.insights.map(r=><article key={r.id} className="stack">
        <h3>{r.name}</h3><p>{r.checkins} recorded boardings across {r.trips} completed trips · {r.over} trips with more check-ins than seats</p>
        <ul className="items">{r.stops.map(s=><li key={s.name}>{s.name}: {s.boardings?s.boardings+" boardings":r.trips?"no recorded boardings":"no completed-trip evidence"}</li>)}</ul>
        {!!r.vehicles.length&&<p>By bus: {r.vehicles.map(v=>`${v.name} (${v.boardings})`).join(", ")}</p>}
      </article>)}
      <h3>Route merge screening</h3>
      {data.merge.length?<ul className="items">{data.merge.map(m=><li key={m.routes}>{m.routes}: {m.shared} shared named stops, {m.a}/{m.sa} and {m.b}/{m.sb} recorded boardings per available seats. Review geography and demand before any change.</li>)}</ul>
        :<p>No route pairs meet the current screening criteria.</p>}
    </details>
  </section>;
}
