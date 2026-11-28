import Link from "next/link";
import type {Scope} from "../../lib/scope";
import type {officeBoardingDevices,officeBoardingLog,riderBoardingHistory} from "../../lib/transport/boarding";
import {transportAction} from "../actions/transport";
import {ActionForm} from "../forms";
import {BoardingInput} from "./board-input";
export function RiderBoarding({current,active,history}:{current:Scope;active:boolean;history:Awaited<ReturnType<typeof riderBoardingHistory>>}){
  return <section className="panel stack" aria-label="My bus boarding">
    <h2>Bus boarding</h2>
    {active?<ActionForm action={transportAction} context={current} operation="board-bus" label="Confirm boarding">
      <p className="meta">Scan the screen or sticker when you step onto your bus. The location check uses the bus’s position, never yours.</p>
      <BoardingInput/>
    </ActionForm>:<p>Boarding opens when your trip starts.</p>}
    {history.length>0 && <details><summary>My boarding history</summary><ul className="items">{history.map(x=><li key={x.trip}>{x.day} · {x.vehicle} · {x.stop}</li>)}</ul></details>}
  </section>;
}
export function BoardingOffice({current,vehicles,devices,log}:{current:Scope;vehicles:{id:string;label:string}[];
  devices:Awaited<ReturnType<typeof officeBoardingDevices>>;log:Awaited<ReturnType<typeof officeBoardingLog>>}){
  const options=vehicles.map(v=><option key={v.id} value={v.id}>{v.label}</option>);
  return <section className="panel stack" aria-label="Boarding controls">
    <h2>Boarding controls</h2>
    <div className="row"><Link href="/transport/board" className="button secondary">Open device screen</Link>
      <Link href="/transport/sticker" className="button secondary">Print a sticker</Link></div>
    {(vehicles.length>0)&&<details><summary>Manage boarding credentials</summary>
      <ActionForm action={transportAction} context={current} operation="issue-boarding-device" label="Issue boarding screen credential">
        <label>Boarding vehicle<select name="vehicle" required defaultValue=""><option value="" disabled>Choose a vehicle</option>{options}</select></label>
        <label>Device name<input name="label" maxLength={100} required /></label>
      </ActionForm>
      <ActionForm action={transportAction} context={current} operation="issue-boarding-sticker" label="Issue or replace vehicle sticker" confirmation="Any previous sticker for this bus will stop working.">
        <label>Sticker vehicle<select name="vehicle" required defaultValue=""><option value="" disabled>Choose a vehicle</option>{options}</select></label>
      </ActionForm>
      <ul className="items">{devices.map(d=><li key={d.id}>{d.vehicle} · {d.label} · {d.revoked?"Revoked":"Bound"}
        {!d.revoked&&<ActionForm action={transportAction} context={current} operation="revoke-boarding-device" label="Revoke boarding device"
          secondary confirmation="This device cannot display new boarding codes after revocation.">
          <input type="hidden" name="device" value={d.id}/>
        </ActionForm>}
      </li>)}</ul>
    </details>}
    {log.length>0&&<details><summary>Daily boarding records</summary>
      {log.map(x=><div key={x.trip} className="stack"><h3>{x.day} · {x.vehicle}</h3>
        <p>{x.route} · {x.state} · {x.manifest.filter(m=>m.boarded).length} recorded check-ins</p>
        <ul className="items">{x.manifest.map((m,i)=><li key={i}>{m.name} · {m.stop} · {m.boarded?"Boarded":"No check-in recorded"}</li>)}</ul>
      </div>)}
    </details>}
  </section>;
}
