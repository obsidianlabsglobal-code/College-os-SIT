import "../scripts/environment";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { changeClub } from "../lib/clubverse";
import { clubs, clubView } from "../lib/club-views";
import { clubInput, type ClubInput } from "../lib/club-contracts";
import { db } from "../lib/db";
import type { Scope } from "../lib/scope";
import { fixtures, demoEmail } from "../scripts/fixtures";

const owner = new Pool({ connectionString:process.env.MIGRATION_DATABASE_URL });
const accounts = new Map<string,string>();
const viewer = (alias:string,role:Scope["role"],institution = fixtures.institution): Scope => ({
  institution,account:accounts.get(alias)!,role,
});
const stamp = (offset: number) => new Intl.DateTimeFormat("sv-SE",{
  dateStyle:"short",timeStyle:"short",timeZone:"Asia/Kolkata",
}).format(new Date(Date.now()+offset)).replace(" ","T");
const future = () => ({ starts:stamp(3600000),ends:stamp(7200000) });
const proposal = () => ({
  operation:"draft" as const, name:`Workshop club ${randomUUID()}`, purpose:"Build projects together.",
  rules:"Monthly workshops.", category:"technical", joining:"approval" as const, audience:"campus" as const,
});

before(async () => {
  for (const url of [process.env.DATABASE_URL,process.env.MIGRATION_DATABASE_URL]) {
    assert.ok(url && ["localhost","127.0.0.1"].includes(new URL(url).hostname));
  }
  for (const alias of ["student","faculty","outsider","tenant","admin","replacement"]) {
    const result = await owner.query<{ id:string }>('SELECT id FROM "user" WHERE email=$1',[demoEmail(alias)]);
    assert.ok(result.rows[0]);
    accounts.set(alias,result.rows[0].id);
  }
});
after(async () => { await Promise.all([db.end(),owner.end()]); });

async function recognize(founder: Scope, overrides: Partial<ReturnType<typeof proposal>> = {}) {
  const admin = viewer("admin","admin");
  const club = await changeClub(founder,{ ...proposal(),...overrides });
  await changeClub(founder,{ operation:"proposal",id:club,revision:0,next:"submitted" });
  await changeClub(admin,{ operation:"proposal",id:club,revision:1,next:"under_review" });
  await changeClub(admin,{ operation:"proposal",id:club,revision:2,next:"approved" });
  return club;
}

test("recognized club, scoped membership, grant revocation and leadership transfer",async()=>{
  const founder=viewer("faculty","faculty");
  const student=viewer("student","student");
  const admin=viewer("admin","admin");
  const tenant=viewer("tenant","student",fixtures.otherInstitution);
  const advisor=viewer("replacement","faculty");
  const club=await changeClub(founder,proposal());
  assert.equal(await clubView(student,club),null);
  assert.equal((await clubs(student,"","")).recognized.some(row=>row.id===club),false);
  await changeClub(founder,{operation:"proposal",id:club,revision:0,next:"submitted"});
  await assert.rejects(changeClub(student,{operation:"proposal",id:club,revision:1,next:"under_review"}),/unavailable/);
  await changeClub(admin,{operation:"proposal",id:club,revision:1,next:"under_review"});
  await assert.rejects(changeClub(admin,{operation:"proposal",id:club,revision:1,next:"approved"}),/changed/);
  await changeClub(admin,{operation:"proposal",id:club,revision:2,next:"changes_requested",note:"Clarify activities."});
  await changeClub(founder,{...proposal(),operation:"revise",id:club,revision:3});
  await changeClub(founder,{operation:"proposal",id:club,revision:4,next:"submitted"});
  await changeClub(admin,{operation:"proposal",id:club,revision:5,next:"under_review"});
  await changeClub(admin,{operation:"proposal",id:club,revision:6,next:"approved"});
  assert.equal(await clubView(tenant,club),null);
  await assert.rejects(changeClub(tenant,{operation:"join",club}),/unavailable/);
  await changeClub(student,{operation:"join",club});
  await assert.rejects(changeClub(student,{operation:"join",club}),/already requested/);
  assert.equal((await clubView(student,club))?.member,false);
  await changeClub(founder,{operation:"membership",club,person:student.account,next:"active"});
  const eventDraft={operation:"event-draft",club,title:"Private workshop",location:"Lab",requirements:"Bring notes",capacity:5,audience:"club",...future()} satisfies ClubInput;
  await assert.rejects(changeClub(student,eventDraft),/unavailable/);
  await changeClub(founder,{operation:"grant",club,person:student.account,kind:"officer"});
  assert.equal((await clubView(student,club))?.officer,true);
  const event=await changeClub(student,eventDraft);
  const unrelated=await recognize(advisor);
  assert.equal((await clubView(advisor,club))?.events.length,0);
  await assert.rejects(changeClub(advisor,{...eventDraft,club}),/unavailable/);
  await changeClub(advisor,{operation:"join",club});
  await changeClub(founder,{operation:"membership",club,person:advisor.account,next:"active"});
  await changeClub(founder,{operation:"grant",club,person:advisor.account,kind:"advisor"});
  await assert.rejects(changeClub(advisor,{...eventDraft,club}),/unavailable/);
  await assert.rejects(changeClub(advisor,{operation:"event-state",club:unrelated,id:event,revision:0,next:"pending_approval"}),/unavailable/);
  const grant=(await clubView(founder,club))?.grants.find(row=>row.kind==="officer");
  assert.ok(grant);
  await changeClub(founder,{operation:"revoke",club,grant:grant.id});
  await assert.rejects(changeClub(student,eventDraft),/unavailable/);
  await changeClub(founder,{operation:"handover",club,person:student.account,note:"Deliver the schedule."});
  const handover=(await clubView(admin,club))?.handovers[0];
  assert.ok(handover);
  await assert.rejects(changeClub(student,{operation:"approve-handover",club,id:handover.id}),/unavailable/);
  await changeClub(student,{operation:"membership",club,person:student.account,next:"ended"});
  await assert.rejects(changeClub(admin,{operation:"approve-handover",club,id:handover.id}),/unavailable/);
  await changeClub(founder,{operation:"cancel-handover",club,id:handover.id});
  await changeClub(student,{operation:"join",club});
  await changeClub(founder,{operation:"membership",club,person:student.account,next:"active"});
  await changeClub(founder,{operation:"handover",club,person:student.account,note:"Updated schedule."});
  const replacement=(await clubView(admin,club))?.handovers.find(row=>!row.approved_at && !row.cancelled_at);
  assert.ok(replacement);
  await changeClub(admin,{operation:"approve-handover",club,id:replacement.id});
  assert.equal((await clubView(student,club))?.lead,true);
  assert.equal((await clubView(founder,club))?.officer,false);
  await changeClub(admin,{operation:"club-state",club,next:"archived"});
  await assert.rejects(changeClub(student,eventDraft),/unavailable/);
  assert.equal(await clubView(student,club),null);
});

test("event approval, private audience, final-seat concurrency and verified attendance",async()=>{
  const founder=viewer("faculty","faculty");
  const student=viewer("student","student");
  const outsider=viewer("outsider","student");
  const admin=viewer("admin","admin");
  const club=await recognize(founder);
  const values={operation:"event-draft",club,title:"Final seat",location:"Hall",requirements:"Bring a notebook",audience:"club",capacity:1,...future()} satisfies ClubInput;
  assert.equal(clubInput.safeParse({...values,capacity:0}).success,false);
  const cancelled=await changeClub(founder,{...values,audience:"eligible"});
  await changeClub(founder,{operation:"event-state",club,id:cancelled,revision:0,next:"cancelled"});
  assert.ok(!(await clubView(student,club))?.events.some(event=>event.id===cancelled));
  const id=await changeClub(founder,values);
  await assert.rejects(changeClub(admin,{operation:"event-state",club,id,revision:0,next:"approved"}),/unavailable/);
  await changeClub(founder,{operation:"event-state",club,id,revision:0,next:"pending_approval"});
  await assert.rejects(changeClub(founder,{operation:"event-state",club,id,revision:1,next:"approved"}),/unavailable/);
  await changeClub(admin,{operation:"event-state",club,id,revision:1,next:"approved"});
  await changeClub(founder,{operation:"event-state",club,id,revision:2,next:"published"});
  await changeClub(founder,{operation:"event-state",club,id,revision:3,next:"registration_open"});
  assert.equal((await clubView(student,club))?.events.length,0);
  await assert.rejects(changeClub(student,{operation:"register",club,id}),/unavailable/);
  for(const person of [student,outsider]) {
    await changeClub(person,{operation:"join",club});
    await changeClub(founder,{operation:"membership",club,person:person.account,next:"active"});
  }
  const attempts=await Promise.allSettled([student,outsider].map(person=>changeClub(person,{operation:"register",club,id})));
  assert.equal(attempts.filter(result=>result.status==="fulfilled").length,1);
  const loser=attempts.find(result=>result.status==="rejected") as PromiseRejectedResult;
  assert.match(String(loser.reason),/full/);
  const winner=attempts[0].status==="fulfilled"?student:outsider;
  await assert.rejects(changeClub(winner,{operation:"register",club,id}),/already registered/);
  assert.equal((await clubView(founder,club))?.events.find(row=>row.id===id)?.attended,0);
  await changeClub(founder,{operation:"event-state",club,id,revision:4,next:"registration_closed"});
  await assert.rejects(changeClub(attempts[0].status==="fulfilled"?outsider:student,{operation:"register",club,id}),/closed/);
  await assert.rejects(changeClub(founder,{operation:"event-state",club,id,revision:5,next:"in_progress"}),/has not started/);
  await owner.query("UPDATE club_event SET starts_at=now()-interval '1 minute' WHERE institution_id=$1 AND id=$2",[founder.institution,id]);
  await changeClub(founder,{operation:"event-state",club,id,revision:5,next:"in_progress"});
  await changeClub(founder,{operation:"grant",club,person:winner.account,kind:"officer"});
  await assert.rejects(changeClub(winner,{operation:"verify",club,id,person:winner.account,note:"Self claim"}),/unavailable/);
  await changeClub(founder,{operation:"verify",club,id,person:winner.account,note:"Observed at check-in."});
  await changeClub(founder,{operation:"event-state",club,id,revision:6,next:"completed"});
  assert.equal((await clubView(winner,club))?.events.find(row=>row.id===id)?.verified,true);
  assert.equal((await clubView(winner,club))?.events.find(row=>row.id===id)?.attended,1);
});

test("audit failure rolls back a club proposal",async()=>{
  const founder=viewer("faculty","faculty");
  const input=proposal();
  const connection=await owner.connect();
  try {
    await connection.query("BEGIN");
    await connection.query("LOCK TABLE audit_event IN ACCESS EXCLUSIVE MODE");
    await assert.rejects(changeClub(founder,input),/statement timeout/);
  } finally {
    await connection.query("ROLLBACK");
    connection.release();
  }
  const result=await owner.query("SELECT 1 FROM club_proposal WHERE institution_id=$1 AND name=$2",[founder.institution,input.name]);
  assert.equal(result.rowCount,0);
});
