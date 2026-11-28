import { notFound } from "next/navigation";
import { account,scope } from "../../lib/scope";
import { feesAggregateExample,feesPreviewAvailable,studentExample,studentTotals } from "../../lib/fees-preview";
import { Chrome } from "../chrome";
import { ExperienceHeading } from "../experience/heading";
import styles from "./fees.module.css";
import { FeeReviewRecord } from "./review-record";
import { FeeRehearsal } from "./rehearsal";
import { FeeBatchRehearsal } from "./batch-rehearsal";
import { canReviewFees } from "../../lib/fee-reconciliation";

const rupees = new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:0});
const money = (value:number) => rupees.format(value);

export default async function Fees({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}) {
  const params = await searchParams;
  if (process.env.NEXUS_FEES_PREVIEW !== "true") notFound();
  const [user,current] = await Promise.all([account(),scope(params.institution,params.role)]);
  const role = current.role;
  if (role === "faculty" || role === "transport" || role === "driver" || !feesPreviewAvailable(current,user)) notFound();
  // Explicit synthetic operator grant for this rehearsal. A real operator directory does not exist yet.
  const rehearsal = role==="admin" && canReviewFees({role,account:user.id},
    {institution:current.institution,department:"demo-eee",id:"fictional-statement"}, {
      account:user.id,institution:current.institution,departments:["demo-eee"],expiresAt:2,
      revokedAt:null,canReview:true,
    },1); // Fixed clock for the non-persistent fictional rehearsal.
  const totals = role === "student" ? studentTotals : feesAggregateExample(role).reduce<{billed:number;paid:number}>(
    (sum,row)=>({billed:sum.billed+row.billed,paid:sum.paid+row.paid}),{billed:0,paid:0});
  return <Chrome user={user} current={current} section="/fees">
    <ExperienceHeading title="Fees & dues" context="Fictional finance preview. No live records, receipt verification or payments." />
    <section className={`panel ${styles.hero}`} aria-label="Fee totals">
      <span className="tag">Sample term · Indian rupees</span>
      <h2>{role === "student" ? "Your fee overview" : role === "hod" ? "Department fee overview" : role === "principal" ? "Institution fee overview" : "Office fee overview"}</h2>
      <dl className={styles.metrics}>
        <div><dt>Amount billed</dt><dd>{money(totals.billed)}</dd></div>
        <div><dt>Payments recorded</dt><dd>{money(totals.paid)}</dd></div>
        <div><dt>Balance due</dt><dd>{money(totals.billed-totals.paid)}</dd></div>
      </dl>
    </section>
    {role === "student" ? <section className="panel" aria-labelledby="fee-breakdown">
      <h2 id="fee-breakdown">Your fee breakdown</h2>
      <ul className={styles.cards}>{studentExample.map(f=><li key={f.name}>
        <div className="row spread"><h3>{f.name}</h3><span className={f.paid<f.billed?"tag tag-attention":"tag"}>{f.paid===f.billed?"Paid":f.paid?"Part paid":"Unpaid"}</span></div>
        <dl className={styles.metrics}>
          <div><dt>Billed</dt><dd>{money(f.billed)}</dd></div>
          <div><dt>Paid</dt><dd>{money(f.paid)}</dd></div>
          <div><dt>Outstanding</dt><dd>{money(f.billed-f.paid)}</dd></div>
        </dl>
        {f.due && <p className="meta">Illustrative due date: {f.due}</p>}
      </li>)}</ul>
    </section> : <section className="panel" aria-labelledby="fee-summary">
      <h2 id="fee-summary">Department totals</h2>
      <p className="meta">Fictional aggregate amounts only. Individual student records are not shown.</p>
      <ul className={styles.cards}>{feesAggregateExample(role).map(row=><li key={row.department}>
        <h3>{row.department}</h3>
        <dl className={styles.metrics}>
          <div><dt>Billed</dt><dd>{money(row.billed)}</dd></div>
          <div><dt>Paid</dt><dd>{money(row.paid)}</dd></div>
          <div><dt>Outstanding</dt><dd>{money(row.billed-row.paid)}</dd></div>
        </dl>
      </li>)}</ul>
    </section>}
    <FeeReviewRecord current={current} user={user} />
    {rehearsal && <><FeeBatchRehearsal /><FeeRehearsal /></>}
    {role==="admin" && <section className="panel"><h2>Office workflow</h2>
      <p>College, transport, hostel and other charges would be maintained by specifically authorized finance staff. This preview can rehearse reconciliation decisions, but it cannot record payments, edit receipts or export records.</p>
    </section>}
  </Chrome>;
}
