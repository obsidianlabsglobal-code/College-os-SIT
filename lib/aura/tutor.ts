import { z } from "zod";
import { db, transaction } from "../db";
import { WorkflowError } from "../assignments";
import type { Scope } from "../scope";

export const topics = {pointers:"Pointers in C", fractions:"Fractions and ratios", circuits:"Series and parallel circuits"} as const;
const topicKey = z.enum(["pointers","fractions","circuits"]);
const settings = z.object({
  institution:z.uuid(), key:z.string().min(1), model:z.string().min(1).max(100),
  inputPrice:z.coerce.number().positive().max(1000), outputPrice:z.coerce.number().positive().max(1000),
  daily:z.coerce.number().int().min(1).max(100_000_000),
});
function config() {
  return settings.safeParse({institution:process.env.AURA_TUTOR_INSTITUTION,key:process.env.ANTHROPIC_API_KEY,
    model:process.env.AURA_TUTOR_MODEL,inputPrice:process.env.AURA_INPUT_USD_PER_MTOK,
    outputPrice:process.env.AURA_OUTPUT_USD_PER_MTOK,daily:process.env.AURA_DAILY_MICROUSD});
}
export function tutorEnabled(scope:Scope) {
  const c = config();
  return process.env.AURA_MODEL_ENABLED !== "true" && c.success && c.data.institution===scope.institution && ["faculty","student"].includes(scope.role);
}
const usage = z.object({input_tokens:z.number().int().nonnegative(),output_tokens:z.number().int().nonnegative()});
const answer = z.object({model:z.string(),stop_reason:z.literal("end_turn"),usage,
  content:z.array(z.object({type:z.literal("text"),text:z.string().trim().min(1).max(5000)})).length(1)});
const granted = `SELECT 1 FROM membership WHERE institution_id=$1 AND account_id=$2 AND role=$3 AND ended_at IS NULL`;

export async function explainTopic(scope:Scope,raw:unknown,request:unknown,send:typeof fetch=fetch) {
  const topic=topicKey.parse(raw), id=z.uuid().parse(request), c=config();
  if (!c.success || !tutorEnabled(scope)) throw new WorkflowError("The Claude tutor is unavailable in this workspace.");
  const {model,key,inputPrice,outputPrice,daily}=c.data;
  const actor=[scope.institution,scope.account,scope.role];
  // Only fixed English curriculum prompts are transmitted. There is no user text, record context or tool authority.
  const prompt=`Explain ${topics[topic]} to a first-year engineering student with one worked example and one practice question. Use plain text under 180 words.`;
  const maxOutput=512;
  const reserve=Math.ceil(2048*inputPrice+maxOutput*outputPrice);
  await transaction(async client=>{
    if (!(await client.query(granted+" FOR SHARE",actor)).rowCount) throw new WorkflowError("Tutor access is unavailable.");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",["aura-tutor/"+scope.institution]);
    const {rows:[limits]}=await client.query(`SELECT coalesce(sum(budget_microusd),0) AS spent,
      count(*) FILTER (WHERE actor_id=$2) AS requests FROM aura_tutor_usage
      WHERE institution_id=$1 AND created_at>=now()-interval '24 hours'`,actor.slice(0,2));
    if (Number(limits.spent)+reserve>daily || Number(limits.requests)>=5) throw new WorkflowError("The tutor usage limit has been reached.");
    const saved=await client.query(`INSERT INTO aura_tutor_usage
      (id,institution_id,actor_id,role,topic,model,state,budget_microusd) VALUES ($1,$2,$3,$4,$5,$6,'reserved',$7)
      ON CONFLICT DO NOTHING`,[id,...actor,topic,model,reserve]);
    if (!saved.rowCount) throw new WorkflowError("This request was already submitted.");
  });
  try {
    const response=await send("https://api.anthropic.com/v1/messages",{method:"POST",redirect:"error",signal:AbortSignal.timeout(15000),
      headers:{"x-api-key":key,"anthropic-version":"2023-06-01","content-type":"application/json"},
      body:JSON.stringify({model,max_tokens:maxOutput,messages:[{role:"user",content:prompt}]})});
    if (!response.ok) throw Error("provider");
    const result=answer.parse(await response.json());
    const {input_tokens,output_tokens}=result.usage;
    await db.query(`UPDATE aura_tutor_usage SET state='answered',input_tokens=$2,output_tokens=$3,budget_microusd=$4,
      provider_request=$5 WHERE id=$1`,[id,input_tokens,output_tokens,Math.ceil(input_tokens*inputPrice+output_tokens*outputPrice),response.headers.get("request-id")]);
    if (!(await db.query(granted,actor)).rowCount) throw new WorkflowError("Tutor access changed while preparing the explanation.");
    return result.content[0].text;
  } catch (error) {
    await db.query("UPDATE aura_tutor_usage SET state='unconfirmed' WHERE id=$1 AND state='reserved'",[id]);
    if (error instanceof WorkflowError) throw error;
    throw new WorkflowError("The tutor response could not be confirmed. There was no automatic retry.");
  }
}

export async function tutorActivity(scope:Scope) {
  if (!["student","faculty"].includes(scope.role)) return [];
  return (await db.query<{
    id:string;topic:keyof typeof topics;state:"reserved"|"answered"|"unconfirmed";created_at:Date;
    input_tokens:number|null;output_tokens:number|null;budget_microusd:string;
  }>(`SELECT id,topic,state,created_at,input_tokens,output_tokens,budget_microusd FROM aura_tutor_usage
    WHERE institution_id=$1 AND actor_id=$2 AND role=$3 AND EXISTS (${granted})
    ORDER BY created_at DESC,id LIMIT 5`,[scope.institution,scope.account,scope.role])).rows;
}
