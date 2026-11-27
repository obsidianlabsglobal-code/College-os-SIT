import assert from "node:assert/strict";
import {test} from "node:test";
import {addFeeCorrection,parseFeeImport,reviewFeeBatch} from "../lib/fee-batch-review";

const header="student_key,source,reference,received_paise,transport_paise,hostel_paise";
const accounts=new Map([["SAMPLE-01",[{id:"transport",label:"Transport",due:500},{id:"hostel",label:"Hostel",due:500}]]]);
const parse=(...lines:string[])=>parseFeeImport([header,...lines].join("\n"));
test("batch parsing preserves original line numbers and rejects partially malformed imports as a whole",()=>{
  const a=parse("SAMPLE-01,bank,AA-01,400,400,0","SAMPLE-01,bank,AA-02,3.5,0,100");
  assert.deepEqual(a.rows,[]);
  assert.deepEqual(a.errors.map(err=>err.lineNumber),[3]);
  assert.equal(parse("SAMPLE-01,bank,AA-01,400,400,0").rows[0].lineNumber,2);
  assert.equal(parseFeeImport(header).errors.length,1);
});
test("exact keys, canonical duplicate detection and projected balances prevent unsafe approval",()=>{
  const {rows}=parse("SAMPLE-01,bank,AA-01,400,400,0","SAMPLE-01,bank,AA-02,200,200,0",
    "SAMPLE-01,bank, dup-3 ,100,0,100","SAMPLE-01,bank,DUP-3,100,0,100","SAMPLE-99,bank,AA-05,200,200,0");
  const result=reviewFeeBatch(rows,accounts,new Set());
  assert.equal(result.ready,1);
  assert.deepEqual(result.rows.slice(1).map(row=>row.result.status==="exception"&&row.result.reason),
    ["exceeds-balance","duplicate-in-batch","duplicate-in-batch","student-not-matched"]);
  assert.equal(accounts.get("SAMPLE-01")![0].due,500);
});
test("corrections preserve original allocation and every reason while the last revision is reviewed",()=>{
  const {rows}=parse("SAMPLE-01,bank,AA-01,400,300,0");
  const original=JSON.stringify(rows[0]);
  assert.throws(()=>addFeeCorrection([],rows[0],"",[{line:"hostel",amount:400}]));
  let trail=addFeeCorrection([],rows[0],"Still missing some allocation",[{line:"transport",amount:350}]);
  assert.equal(reviewFeeBatch(rows,accounts,new Set(),trail).ready,0);
  trail=addFeeCorrection(trail,rows[0],"Matched missing amount with source note",[{line:"transport",amount:300},{line:"hostel",amount:100}]);
  const batch=reviewFeeBatch(rows,accounts,new Set(),trail);
  assert.equal(batch.ready,1);
  assert.equal(batch.rows[0].correctionTrail.length,2);
  assert.equal(JSON.stringify(batch.rows[0].original),original);
  assert.equal(reviewFeeBatch(rows,accounts,new Set(["bank:AA-01"]),trail).ready,0);
});
