"use client";
import { useState } from "react";
import { reviewFeeRow, type FeeLine, type FeeRow, type FeeResult } from "../../lib/fee-reconciliation";
import styles from "./fees.module.css";

const format=new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",minimumFractionDigits:0,maximumFractionDigits:2});
const money=(value:number)=>format.format(value/100);
const lines:readonly FeeLine[]=[{id:"transport",label:"Transport fees",due:800000},{id:"hostel",label:"Hostel fees",due:600000}];
const cases:Record<string,{title:string;row:FeeRow}> = {
  partial:{title:"Partial hostel payment",row:{source:"bank",reference:"DEMO-031",received:350000,allocations:[{line:"hostel",amount:350000}]}},
  split:{title:"One payment split across two fees",row:{source:"bank",reference:"DEMO-032",received:500000,allocations:[{line:"transport",amount:300000},{line:"hostel",amount:200000}]}},
  duplicate:{title:"Duplicate bank reference",row:{source:"bank",reference:" demo-010 ",received:350000,allocations:[{line:"hostel",amount:350000}]}},
  mismatch:{title:"Payment with no clear allocation",row:{source:"bank",reference:"DEMO-033",received:750000,allocations:[{line:"hostel",amount:500000}]}},
};
const reasons:Record<Extract<FeeResult,{status:"exception"}>["reason"],string>={
  duplicate:"This payment reference is already recorded. Check the original entry; do not enter it again.",
  unallocated:"Some money is not matched to a fee. Verify the source record before assigning it.",
  "over-allocation":"The proposed allocations exceed the received amount.",
  "exceeds-balance":"The proposed allocation exceeds an outstanding line balance.",
  "missing-line":"A selected fee line does not exist on the sample statement.",
  "invalid-input":"The amount or reference cannot be reviewed.",
};
export function FeeRehearsal() {
  const [scenario,setScenario]=useState("partial");
  const [result,setResult]=useState<FeeResult|null>(null);
  const [confirmed,setConfirmed]=useState(false);
  return <section className="panel" aria-labelledby="fee-rehearsal">
    <h2 id="fee-rehearsal">Rehearse a reconciliation</h2>
    <p className="meta">Fictional data only. No records are saved and no money moves.</p>
    <form onSubmit={event=>{event.preventDefault();setConfirmed(false);setResult(reviewFeeRow(lines,new Set(["bank:DEMO-010"]),cases[scenario].row));}}>
      <label>Sample case<select value={scenario} onChange={e=>{setScenario(e.target.value);setResult(null);setConfirmed(false);}}>
        {Object.entries(cases).map(([id,c])=><option key={id} value={id}>{c.title}</option>)}
      </select></label>
      <p className="meta">Sample payment received: {money(cases[scenario].row.received)}</p>
      <button type="submit" className="button">Review sample payment</button>
    </form>
    {result&&<div className={styles.rehearsal} aria-label="Review outcome">
      {result.status==="exception"?<p role="status"><strong>Needs attention.</strong> {reasons[result.reason]}</p>:<>
        <h3>Check the proposed allocation</h3>
        <p>Statement balance: {money(result.balanceBefore)} before, {money(result.balanceAfter)} after.</p>
        <ul>{result.changes.map(item=><li key={item.label}>{item.label}: {money(item.before)} before, {money(item.after)} after</li>)}</ul>
        {confirmed?<p role="status">Sample review complete. Nothing was posted or saved.</p>:<button type="button" className="button" onClick={()=>setConfirmed(true)}>Confirm rehearsal review</button>}
      </>}
    </div>}
  </section>;
}
