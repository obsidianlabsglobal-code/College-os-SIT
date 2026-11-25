/** Pure reconciliation preview. This module cannot write a ledger, send a receipt, or move money. */
export type FeeAccount = { institution:string; department:string; id:string };
export type FeeOperatorGrant = {
  account:string; institution:string; departments:readonly string[]; expiresAt:number; revokedAt:number|null;
  canReview:boolean;
};
export function canReviewFees(operator:{account:string;role:string}, target:FeeAccount, grant:FeeOperatorGrant|null, now:number) {
  return ["faculty","hod","staff","admin"].includes(operator.role) && !!grant &&
    grant.account===operator.account && grant.institution===target.institution &&
    grant.departments.includes(target.department) && grant.canReview && grant.revokedAt===null && grant.expiresAt>now;
}
export type FeeLine = { id:string; label:string; due:number };
export type FeeRow = { source:"bank"|"counter"; reference:string; received:number; allocations:readonly {line:string;amount:number}[] };
export type FeeResult =
  | {status:"review"; balanceBefore:number; balanceAfter:number; totalApplied:number; reference:string; changes:{label:string;before:number;after:number}[]}
  | {status:"exception"; reason:"invalid-input"|"duplicate"|"missing-line"|"unallocated"|"over-allocation"|"exceeds-balance"};
const amountValid=(n:number)=>Number.isSafeInteger(n)&&n>=0&&n<=100_000_000_000;
export function feeReference(source:FeeRow["source"], reference:string) {
  if(source!=="bank"&&source!=="counter")return null;
  const ref=reference.trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9/_-]{1,63}$/.test(ref)?`${source}:${ref}`:null;
}
export function reviewFeeRow(lines:readonly FeeLine[], postedReferences:ReadonlySet<string>, row:FeeRow):FeeResult {
  const reference=feeReference(row.source,row.reference);
  if(!reference||!amountValid(row.received)||row.received===0||lines.length===0||lines.length>100||
    row.allocations.length>100||lines.some(l=>!amountValid(l.due))||new Set(lines.map(l=>l.id)).size!==lines.length)
    return {status:"exception",reason:"invalid-input"};
  if(postedReferences.has(reference))return {status:"exception",reason:"duplicate"};
  const balances=new Map(lines.map(l=>[l.id,l]));
  const applied=new Map<string,number>();
  let total=0;
  for(const item of row.allocations) {
    if(!balances.has(item.line))return {status:"exception",reason:"missing-line"};
    if(!amountValid(item.amount)||item.amount===0)return {status:"exception",reason:"invalid-input"};
    const next=(applied.get(item.line)??0)+item.amount;
    if(next>balances.get(item.line)!.due)return {status:"exception",reason:"exceeds-balance"};
    applied.set(item.line,next);
    total+=item.amount;
  }
  if(total>row.received)return {status:"exception",reason:"over-allocation"};
  if(total<row.received)return {status:"exception",reason:"unallocated"};
  const before=lines.reduce((sum,l)=>sum+l.due,0);
  return {status:"review",reference,balanceBefore:before,balanceAfter:before-total,totalApplied:total,
    changes:lines.filter(l=>applied.has(l.id)).map(l=>({label:l.label,before:l.due,after:l.due-applied.get(l.id)!}))};
}
