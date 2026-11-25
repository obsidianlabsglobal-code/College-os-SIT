import {createHash} from "node:crypto";
import {db} from "./db";
import type {Scope} from "./scope";
import {feesPreviewAvailable} from "./fees-preview";
import {parseFeeImport,addFeeCorrection,reviewFeeBatch} from "./fee-batch-review";
import type {FeeLine} from "./fee-reconciliation";

type Person={id:string;email:string};
export function feeReviewDuty(scope:Scope,user:Person) {
  if(!feesPreviewAvailable(scope,user))return null;
  if(scope.role==="admin")return "submit";
  if(scope.role==="hod")return "approve";
  return null;
}
type Evidence = {template:string;originalTransportPaise:number;originalHostelPaise:number;correctedHostelPaise:number;receivedPaise:number;correctionReason:string;beforePaise:number;afterPaise:number};
type Entry={id:string;digest:string;evidence:Evidence;submitted_at:Date;approved_at:Date|null;is_submitter:boolean};
const sampleKey="fee-review-demo-v1";
const activeMembership=`EXISTS (SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role=$3 AND ended_at IS NULL)`;
const sqlParams=(scope:Scope)=>[scope.institution,scope.account,scope.role];
export async function getFeeReview(scope:Scope,user:Person):Promise<Entry|null>{
  if(!feeReviewDuty(scope,user))return null;
  const {rows}=await db.query<Entry>(`SELECT r.id,r.evidence_sha256 AS digest,r.evidence,r.submitted_at,a.approved_at,
    r.submitted_by=$2 AS is_submitter FROM fee_review_rehearsal r
    LEFT JOIN fee_review_rehearsal_approval a ON (a.institution_id,a.review_id)=(r.institution_id,r.id)
    WHERE r.institution_id=$1 AND r.sample_key=$4 AND ${activeMembership}`,[...sqlParams(scope),sampleKey]);
  return rows[0]??null;
}

function sampleEvidence():Evidence {
  const original=parseFeeImport("student_key,source,reference,received_paise,transport_paise,hostel_paise\nDEMO-A,bank,REVIEW-01,400000,300000,0");
  const roster=new Map<string,readonly FeeLine[]>([["DEMO-A",[{id:"transport",label:"Transport",due:800000},{id:"hostel",label:"Hostel",due:600000}]]]);
  const correctionReason="Fictional source note assigns the remaining amount to hostel.";
  const trail=addFeeCorrection([],original.rows[0],correctionReason,[{line:"transport",amount:300000},{line:"hostel",amount:100000}]);
  const result=reviewFeeBatch(original.rows,roster,new Set(),trail).rows[0].result;
  if(result.status!=="review")throw new Error("Invalid sample configuration");
  return {template:sampleKey,originalTransportPaise:300000,originalHostelPaise:0,correctedHostelPaise:100000,
    receivedPaise:400000,correctionReason,beforePaise:result.balanceBefore,afterPaise:result.balanceAfter};
}

export async function submitFeeReview(scope:Scope,user:Person){
  if(feeReviewDuty(scope,user)!=="submit")return false;
  const raw=JSON.stringify(sampleEvidence());
  const digest=createHash("sha256").update(raw).digest("hex");
  const saved=await db.query(`INSERT INTO fee_review_rehearsal (institution_id,submitted_by,sample_key,evidence,evidence_sha256)
    SELECT $1,$2,$4,$5::jsonb,$6 WHERE ${activeMembership} ON CONFLICT (institution_id,sample_key) DO NOTHING`,
    [...sqlParams(scope),sampleKey,raw,digest]);
  return saved.rowCount===1;
}
export async function approveFeeReview(scope:Scope,user:Person,id:string,digest:string){
  if(feeReviewDuty(scope,user)!=="approve")return false;
  const saved=await db.query(`INSERT INTO fee_review_rehearsal_approval (institution_id,review_id,evidence_sha256,submitted_by,approved_by)
    SELECT r.institution_id,r.id,r.evidence_sha256,r.submitted_by,$2 FROM fee_review_rehearsal r
    WHERE r.institution_id=$1 AND r.sample_key=$4 AND r.id=$5 AND r.evidence_sha256=$6 AND r.submitted_by<>$2
      AND ${activeMembership} ON CONFLICT (institution_id,review_id) DO NOTHING`,
    [...sqlParams(scope),sampleKey,id,digest]);
  return saved.rowCount===1;
}
