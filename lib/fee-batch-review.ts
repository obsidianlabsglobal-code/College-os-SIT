import {feeReference,reviewFeeRow,type FeeLine,type FeeResult,type FeeRow} from "./fee-reconciliation";

export type FeeImportRow = FeeRow & { lineNumber:number; studentKey:string };
export type FeeCorrection = { lineNumber:number; reason:string; allocations:FeeRow["allocations"] };
export type FeeBatchException = Extract<FeeResult,{status:"exception"}>["reason"] | "duplicate-in-batch" | "student-not-matched";
type BatchRow = {original:FeeImportRow; correctionTrail:FeeCorrection[]; result:Extract<FeeResult,{status:"review"}>|{status:"exception";reason:FeeBatchException}};
const keyPattern=/^[A-Z0-9][A-Z0-9_-]{1,39}$/;
const centsPattern=/^(0|[1-9][0-9]{0,10})$/;
const header="student_key,source,reference,received_paise,transport_paise,hostel_paise";
const readPaise=(value:string)=>centsPattern.test(value)&&Number(value)<=100_000_000_000 ? Number(value) : null;

export function parseFeeImport(text:string):{rows:FeeImportRow[];errors:{lineNumber:number;message:string}[]} {
  if(text.length>30000)return {rows:[],errors:[{lineNumber:1,message:"The import exceeds the rehearsal size limit."}]};
  const [head,...records]=text.replace(/^\uFEFF/,"").trimEnd().split(/\r?\n/);
  if(head!==header||records.length===0||records.length>100)return {rows:[],errors:[{lineNumber:1,message:"Use the exact template and 1 to 100 rows."}]};
  const rows:FeeImportRow[]=[];
  const errors:{lineNumber:number;message:string}[]=[];
  records.forEach((line,index)=>{
    const fields=line.split(",").map(v=>v.trim());
    const [studentKey,source,reference,received,transport,hostel]=fields;
    const lineNumber=index+2;
    if(fields.length!==6||!keyPattern.test(studentKey??"")||(source!=="bank"&&source!=="counter")||!feeReference(source,reference??"")){
      errors.push({lineNumber,message:"Check the student key, channel and reference."});return;
    }
    const r=readPaise(received),t=readPaise(transport),h=readPaise(hostel);
    if(r===null||r===0||t===null||h===null){errors.push({lineNumber,message:"Enter whole paise and a positive received amount."});return;}
    rows.push({lineNumber,studentKey,source,reference,received:r,allocations:[{line:"transport",amount:t},{line:"hostel",amount:h}].filter(v=>v.amount>0)});
  });
  // A malformed file fragment must never be silently dropped from a preview.
  return errors.length?{rows:[],errors}:{rows,errors:[]};
}

export function addFeeCorrection(
  previous:readonly FeeCorrection[], row:FeeImportRow, reason:string, allocations:FeeRow["allocations"],
):FeeCorrection[] {
  const note=reason.trim();
  if(note.length<8||note.length>240||allocations.length===0||allocations.length>20)
    throw new Error("A correction needs a reason and at least one allocation.");
  return [...previous,{lineNumber:row.lineNumber,reason:note,allocations:allocations.map(item=>({...item}))}];
}

export function reviewFeeBatch(rows:readonly FeeImportRow[], accounts:ReadonlyMap<string,readonly FeeLine[]>,
  postedReferences:ReadonlySet<string>, corrections:readonly FeeCorrection[]=[]){
  if(rows.length>100||new Set(rows.map(row=>row.lineNumber)).size!==rows.length)throw new Error("Invalid import rows.");
  const counts=new Map<string,number>();
  rows.forEach(row=>{const ref=feeReference(row.source,row.reference);if(ref)counts.set(ref,(counts.get(ref)??0)+1);});
  const projected=new Map<string,readonly FeeLine[]>();
  const results:BatchRow[]=[];
  for(const original of rows){
    const correctionTrail=corrections.filter(note=>note.lineNumber===original.lineNumber);
    const allocations=correctionTrail.at(-1)?.allocations??original.allocations;
    const scope=accounts.get(original.studentKey);
    const ref=feeReference(original.source,original.reference);
    const balances=projected.get(original.studentKey)??scope;
    if(!balances){results.push({original,correctionTrail,result:{status:"exception",reason:"student-not-matched"}});continue;}
    if(ref&&(counts.get(ref)??0)>1){results.push({original,correctionTrail,result:{status:"exception",reason:"duplicate-in-batch"}});continue;}
    const result=reviewFeeRow(balances,postedReferences,{...original,allocations});
    results.push({original,correctionTrail,result});
    if(result.status==="review"){
      const reductions=new Map<string,number>();
      allocations.forEach(line=>reductions.set(line.line,(reductions.get(line.line)??0)+line.amount));
      projected.set(original.studentKey,balances.map(item=>({...item,due:item.due-(reductions.get(item.id)??0)})));
    }
  }
  const ready=results.filter(row=>row.result.status==="review").length;
  return {rows:results,ready,exceptions:results.length-ready};
}
