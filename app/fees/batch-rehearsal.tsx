"use client";
import {useState} from "react";
import {addFeeCorrection,parseFeeImport,reviewFeeBatch,type FeeBatchException,type FeeCorrection} from "../../lib/fee-batch-review";
import type {FeeLine} from "../../lib/fee-reconciliation";
import styles from "./fees.module.css";

const sample=[
  "student_key,source,reference,received_paise,transport_paise,hostel_paise",
  "DEMO-A,bank,DEMO-201,350000,0,350000",
  "DEMO-A,bank,DEMO-202,400000,300000,0",
  "DEMO-B,bank,DEMO-203,250000,250000,0",
  "DEMO-A,bank,DEMO-204,100000,100000,0",
  "DEMO-A,bank,demo-204,100000,100000,0",
].join("\n");
const preview=parseFeeImport(sample);
const accounts=new Map<string,readonly FeeLine[]>([["DEMO-A",[{id:"transport",label:"Transport",due:800000},{id:"hostel",label:"Hostel",due:600000}]]]);
const amount=new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:2});
const money=(paise:number)=>amount.format(paise/100);
const explain:Record<FeeBatchException,string>={
  "duplicate-in-batch":"Duplicate reference in this batch. Compare both source rows; neither is ready.",
  "student-not-matched":"No exact roster match. Verify the approved student key; no guess was made.",
  duplicate:"This reference is already recorded.", "invalid-input":"Check the supplied amount or reference.",
  "missing-line":"The statement does not have this fee category.",unallocated:"The payment is not fully assigned to fees.",
  "over-allocation":"The assigned amount exceeds the amount received.","exceeds-balance":"The allocation exceeds an outstanding balance.",
};
export function FeeBatchRehearsal(){
  const [opened,setOpened]=useState(false);
  const [corrections,setCorrections]=useState<FeeCorrection[]>([]);
  const result=opened?reviewFeeBatch(preview.rows,accounts,new Set(),corrections):null;
  return <section className="panel" aria-labelledby="fee-batch-heading">
    <h2 id="fee-batch-heading">Review a sample fee import</h2>
    <p className="meta">Built-in fictional file. Never upload real records here. Ready means ready for review, not posted.</p>
    {!opened?<button type="button" className="button" onClick={()=>setOpened(true)}>Load sample batch</button>:<>
      {preview.errors.length>0&&<p role="alert">The sample file could not be parsed.</p>}
      {result&&<div className={styles.rehearsal}>
        <p role="status">{result.ready} ready for review · {result.exceptions} need attention</p>
        <ol className="items" aria-label="Sample import rows">{result.rows.map(({original,result:row,correctionTrail})=><li key={original.lineNumber}>
          <h3>Row {original.lineNumber} · {original.reference.trim().toUpperCase()}</h3>
          <p>{original.studentKey} · Received {money(original.received)}</p>
          <p>{row.status==="review"?`Projected balance: ${money(row.balanceBefore)} before, ${money(row.balanceAfter)} after.`:explain[row.reason]}</p>
          <details><summary>Original allocation and correction history</summary>
            <p>Original: {original.allocations.map(item=>`${item.line} ${money(item.amount)}`).join(", ")||"No allocation"}</p>
            {correctionTrail.length>0&&<ol>{correctionTrail.map((item,index)=><li key={index}>Correction {index+1}: {item.reason} · {item.allocations.map(part=>`${part.line} ${money(part.amount)}`).join(", ")}</li>)}</ol>}
          </details>
          {original.lineNumber===3&&row.status==="exception"&&row.reason==="unallocated"&&<button type="button" className="button secondary"
            onClick={()=>setCorrections(previous=>addFeeCorrection(previous,original,"Fictional source note assigns the remaining amount to hostel.",[{line:"transport",amount:300000},{line:"hostel",amount:100000}]))}>Apply sample allocation correction</button>}
        </li>)}</ol>
        <button type="button" className="button secondary" onClick={()=>{setCorrections([]);setOpened(false);}}>Reset sample batch</button>
      </div>}
    </>}
  </section>;
}
