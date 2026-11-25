import { z } from "zod";
import { audit,WorkflowError } from "./assignments";
import { db,transaction } from "./db";
import type { Scope } from "./scope";

export const kinds = ["internship","scholarship","competition"] as const;
const kindSchema = z.enum(kinds);
const name = z.string().trim().min(1).max(140);
const verifiedSource = z.url({protocol:/^https$/}).max(2048).refine(value=>{
  const url=new URL(value);
  return !url.username && !url.password;
});
const command = z.discriminatedUnion("operation",[
  z.object({operation:z.literal("publish"),id:z.uuid(),kind:kindSchema,title:name,sponsor:name,
    eligibility:z.string().trim().min(1).max(1500),source:verifiedSource,deadline:z.iso.date(),verified:z.literal("on")}),
  z.object({operation:z.literal("withdraw"),id:z.uuid(),reason:z.string().trim().min(1).max(300)}),
]);

export async function changeOpportunity(scope:Scope,raw:unknown) {
  if (scope.role!=="admin") throw new WorkflowError("Opportunity administration is unavailable.");
  const input=command.parse(raw);
  await transaction(async client=>{
    const grant=await client.query("SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role='admin' AND ended_at IS NULL FOR SHARE",[scope.institution,scope.account]);
    if (!grant.rowCount) throw new WorkflowError("Opportunity administration is unavailable.");
    if (input.operation==="publish") {
      const added=await client.query(`INSERT INTO opportunity_listing(institution_id,id,kind,title,sponsor,eligibility,source_url,deadline,verified_by)
        SELECT id,$2,$3,$4,$5,$6,$7,$8,$9 FROM institution
        WHERE id=$1 AND $8::date >= (now() AT TIME ZONE timezone)::date ON CONFLICT DO NOTHING`,
        [scope.institution,input.id,input.kind,input.title,input.sponsor,input.eligibility,input.source,input.deadline,scope.account]);
      if (!added.rowCount) throw new WorkflowError("Check that the deadline is current and the listing has not already been published.");
    } else {
      const result=await client.query(`UPDATE opportunity_listing SET withdrawn_at=clock_timestamp(),withdrawn_by=$3,withdrawal_reason=$4
        WHERE institution_id=$1 AND id=$2 AND withdrawn_at IS NULL`,[scope.institution,input.id,scope.account,input.reason]);
      if (!result.rowCount) throw new WorkflowError("This listing is unavailable or already withdrawn.");
    }
    await audit(client,scope,input.id,"opportunity."+input.operation);
  });
}

const filters = z.object({kind:kindSchema.optional(),query:z.string().trim().max(120).default(""),page:z.coerce.number().int().min(1).max(100000).default(1)});
export function directoryFilters(raw:Record<string,unknown>) {
  return filters.safeParse({...raw,kind:raw.kind || undefined});
}
const currentMember = `EXISTS (SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role=$3 AND ended_at IS NULL)`;
const openListing = `l.withdrawn_at IS NULL AND l.deadline >= (now() AT TIME ZONE i.timezone)::date`;

export async function openOpportunityCount(scope: Scope) {
  if (scope.role !== "student") throw new WorkflowError("The student directory is unavailable.");
  const {rows:[row]} = await db.query<{count:number}>(`
    SELECT count(*)::int AS count FROM opportunity_listing l JOIN institution i ON i.id=l.institution_id
    WHERE l.institution_id=$1 AND ${currentMember} AND ${openListing}`,[scope.institution,scope.account,scope.role]);
  return row.count;
}

export async function opportunities(scope:Scope,input:z.infer<typeof filters>) {
  const {kind,query,page}=filters.parse(input);
  if (scope.role!=="admin" && scope.role!=="student") throw new WorkflowError("The directory is unavailable.");
  const result=await db.query<{id:string;kind:typeof kinds[number];title:string;sponsor:string;eligibility:string;source_url:string;
    deadline:string;verified_at:Date;withdrawal_reason:string|null;status:"Open"|"Expired"|"Withdrawn"}>(`
    SELECT l.id,l.kind,l.title,l.sponsor,l.eligibility,l.source_url,to_char(l.deadline,'YYYY-MM-DD') AS deadline,l.verified_at,l.withdrawal_reason,
      CASE WHEN withdrawn_at IS NOT NULL THEN 'Withdrawn' WHEN deadline<(now() AT TIME ZONE i.timezone)::date THEN 'Expired' ELSE 'Open' END AS status
    FROM opportunity_listing l JOIN institution i ON i.id=l.institution_id
    WHERE l.institution_id=$1 AND ${currentMember}
      AND ($3='admin' OR (${openListing}))
      AND ($4::text IS NULL OR kind=$4) AND strpos(lower(concat_ws(' ',title,sponsor,eligibility)),lower($5))>0
    ORDER BY l.deadline,l.id LIMIT 21 OFFSET $6`,[scope.institution,scope.account,scope.role,kind??null,query,(page-1)*20]);
  return {rows:result.rows.slice(0,20),more:result.rows.length>20};
}
