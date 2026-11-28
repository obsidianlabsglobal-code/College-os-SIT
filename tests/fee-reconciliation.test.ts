import {test} from "node:test";
import assert from "node:assert/strict";
import {canReviewFees,reviewFeeRow,type FeeOperatorGrant,type FeeRow} from "../lib/fee-reconciliation";

const target={institution:"college",department:"eee",id:"demo"};
const grant:FeeOperatorGrant={account:"approved",institution:"college",departments:["eee"],expiresAt:100,revokedAt:null,canReview:true};
test("finance review is explicitly and narrowly granted, independent of job title",()=>{
  for(const role of ["faculty","hod","staff","admin"]) {
    assert.equal(canReviewFees({role,account:"approved"},target,grant,99),true);
    assert.equal(canReviewFees({role,account:"approved"},target,null,99),false);
  }
  const operator={role:"faculty",account:"approved"};
  assert.equal(canReviewFees({...operator,account:"someone-else"},target,grant,99),false);
  assert.equal(canReviewFees(operator,{...target,institution:"other"},grant,99),false);
  assert.equal(canReviewFees(operator,{...target,department:"ece"},grant,99),false);
  assert.equal(canReviewFees(operator,target,grant,100),false);
  assert.equal(canReviewFees(operator,target,{...grant,revokedAt:98},99),false);
  assert.equal(canReviewFees(operator,target,{...grant,canReview:false},99),false);
  assert.equal(canReviewFees({...operator,role:"student"},target,grant,99),false);
});
const lines=Object.freeze([{id:"hostel",label:"Hostel",due:600000},{id:"transport",label:"Transport",due:800000}].map(line=>Object.freeze(line)));
const row:FeeRow={source:"bank",reference:" demo-005 ",received:350001,allocations:[{line:"hostel",amount:100001},{line:"transport",amount:250000}]};
test("split and partial payments are calculated exactly in paise without changing the source",()=>{
  const result=reviewFeeRow(lines,new Set(),row);
  assert.deepEqual(result,{status:"review",reference:"bank:DEMO-005",balanceBefore:1400000,balanceAfter:1049999,totalApplied:350001,
    changes:[{label:"Hostel",before:600000,after:499999},{label:"Transport",before:800000,after:550000}]});
  assert.equal(lines[0].due,600000);
});
test("duplicates, mismatches, invalid money and over-allocation become exceptions",()=>{
  const expect=(candidate:FeeRow,reason:string,seen=new Set<string>())=>assert.deepEqual(reviewFeeRow(lines,seen,candidate),{status:"exception",reason});
  expect(row,"duplicate",new Set(["bank:DEMO-005"]));
  expect({...row,received:400000},"unallocated");
  expect({...row,received:100000},"over-allocation");
  expect({...row,received:10,allocations:[{line:"unknown",amount:10}]},"missing-line");
  expect({...row,received:1.5},"invalid-input");
  expect({...row,received:700000,allocations:[{line:"hostel",amount:400000},{line:"hostel",amount:300000}]},"exceeds-balance");
});
