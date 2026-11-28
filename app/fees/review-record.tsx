import {feeReviewDuty,getFeeReview} from "../../lib/fee-review-record";
import type {Scope} from "../../lib/scope";
import {ActionForm} from "../forms";
import {feeReviewAction} from "./review-actions";

const rupees=new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",minimumFractionDigits:0,maximumFractionDigits:2});
const money=(paise:number)=>rupees.format(paise/100);
export async function FeeReviewRecord({current,user}:{current:Scope;user:{id:string;email:string}}){
  const duty=feeReviewDuty(current,user);
  if(!duty)return null;
  const record=await getFeeReview(current,user);
  return <section className="panel" aria-labelledby="fee-review-record">
    <h2 id="fee-review-record">Fictional review record</h2>
    <p className="meta">This saves a sample review and its approval, never a charge or payment. It is separate from the five-row practice batch.</p>
    {!record?<>
      <p>No review has been submitted.</p>
      {duty==="submit"&&<ActionForm action={feeReviewAction} context={current} operation="submit" label="Submit corrected sample for approval">
        <p>Prepared example: ₹4,000 received. Original allocation: ₹3,000 transport, ₹0 hostel. The fictional source note allocates the remaining ₹1,000 to hostel. Projected balance: ₹14,000 before, ₹10,000 after.</p>
      </ActionForm>}
    </>:<>
      <p><strong>{record.approved_at?"Approved in rehearsal":"Awaiting independent approval"}</strong></p>
      <p>Evidence reference: <code>{record.digest.slice(0,12)}</code>. No ledger entry exists.</p>
      <details><summary>Original allocation and saved correction</summary>
        <p>Original: {money(record.evidence.originalTransportPaise)} transport, {money(record.evidence.originalHostelPaise)} hostel.</p>
        <p>Correction: {money(record.evidence.correctedHostelPaise)} to hostel. {record.evidence.correctionReason}</p>
        <p>Projected balance: {money(record.evidence.beforePaise)} before, {money(record.evidence.afterPaise)} after.</p>
      </details>
      {duty==="approve"&&!record.is_submitter&&!record.approved_at&&<ActionForm action={feeReviewAction} context={current} operation="approve"
        label="Approve fictional review" confirmation="Approve this exact fictional evidence as its independent reviewer. This will not post a payment.">
        <input type="hidden" name="review" value={record.id}/><input type="hidden" name="digest" value={record.digest}/>
      </ActionForm>}
    </>}
  </section>;
}
