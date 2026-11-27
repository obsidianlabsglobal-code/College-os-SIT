// covers: ID-004, CR-005
import "../scripts/environment";
import assert from "node:assert/strict";
import { test,before,after } from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { changeOpportunity,directoryFilters,opportunities,openOpportunityCount } from "../lib/opportunities";
import { db } from "../lib/db";
import { fixtures,demoEmail } from "../scripts/fixtures";
import type { Scope } from "../lib/scope";

const owner=new Pool({connectionString:process.env.MIGRATION_DATABASE_URL});
const actors=new Map<string,Scope>();
before(async()=>{
  for(const url of [process.env.MIGRATION_DATABASE_URL,process.env.DATABASE_URL]) assert.ok(url && ["127.0.0.1","localhost"].includes(new URL(url).hostname));
  for(const alias of ["admin","student","tenant"]) {
    const {rows:[row]}=await owner.query('SELECT id FROM "user" WHERE email=$1',[demoEmail(alias)]);
    actors.set(alias,{account:row.id,role:alias==="admin"?"admin":"student",institution:alias==="tenant"?fixtures.otherInstitution:fixtures.institution});
  }
});
after(async()=>{await Promise.all([db.end(),owner.end()]);});

test("reviewed opportunities have scoped publication, date and category filters, audit and withdrawal",async()=>{
  const admin=actors.get("admin")!, student=actors.get("student")!, tenant=actors.get("tenant")!;
  const initialCount=await openOpportunityCount(student);
  const tenantCount=await openOpportunityCount(tenant);
  const title="Fictional "+randomUUID();
  const input={id:randomUUID(),operation:"publish",kind:"scholarship",title,sponsor:"Example Foundation",eligibility:"First-year students",source:"https://example.org/award",verified:"on",deadline:"2099-12-01"};
  const filter={query:title,page:1};
  await assert.rejects(changeOpportunity(student,input),/unavailable/);
  await assert.rejects(changeOpportunity({...tenant,role:"admin"},input),/unavailable/);
  for (const override of [{verified:""},{source:"javascript:alert(1)"},{source:"https://user:pwd@example.org/"},{deadline:"2001-01-01"}])
    await assert.rejects(changeOpportunity(admin,{...input,...override}));
  const attempts=await Promise.allSettled([changeOpportunity(admin,input),changeOpportunity(admin,input)]);
  assert.equal(attempts.filter(r=>r.status==="fulfilled").length,1);
  assert.equal(await openOpportunityCount(student),initialCount+1);
  assert.equal(await openOpportunityCount(tenant),tenantCount);
  assert.equal((await opportunities(student,filter)).rows[0].status,"Open");
  assert.equal((await opportunities(tenant,filter)).rows.length,0);
  assert.equal((await opportunities(student,{...filter,page:2})).rows.length,0);
  assert.equal((await opportunities(student,{...filter,kind:"internship"})).rows.length,0);
  assert.equal(directoryFilters({page:"0"}).success,false);
  await assert.rejects(changeOpportunity({...admin,institution:fixtures.otherInstitution},{operation:"withdraw",id:input.id,reason:"Duplicate"}),/unavailable/);
  await changeOpportunity(admin,{operation:"withdraw",id:input.id,reason:"Organizer cancelled"});
  await assert.rejects(changeOpportunity(admin,{operation:"withdraw",id:input.id,reason:"Again"}),/already withdrawn/);
  assert.equal((await opportunities(student,filter)).rows.length,0);
  assert.equal((await opportunities(admin,filter)).rows[0].status,"Withdrawn");
  const audit=await owner.query("SELECT action FROM audit_event WHERE institution_id=$1 AND entity_id=$2 ORDER BY action",[admin.institution,input.id]);
  assert.deepEqual(audit.rows.map(r=>r.action),["opportunity.publish","opportunity.withdraw"]);
  const expired=randomUUID();
  await changeOpportunity(admin,{...input,id:expired});
  await owner.query("UPDATE opportunity_listing SET deadline='2000-01-01' WHERE id=$1",[expired]);
  assert.equal((await opportunities(student,filter)).rows.length,0);
  assert.equal(await openOpportunityCount(student),initialCount);
  assert.equal((await opportunities(admin,filter)).rows.find(r=>r.id===expired)?.status,"Expired");
});
