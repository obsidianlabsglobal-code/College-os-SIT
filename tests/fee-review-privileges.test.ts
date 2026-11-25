import "../scripts/environment";
import {test,after} from "node:test";
import assert from "node:assert/strict";
import {db} from "../lib/db";

after(async()=>{await db.end();});
test("the runtime can append and read review evidence but cannot rewrite or delete it",async()=>{
  const url=process.env.DATABASE_URL;
  assert.ok(url&&["localhost","127.0.0.1"].includes(new URL(url).hostname),"Use the isolated local test database.");
  for(const table of ["fee_review_rehearsal","fee_review_rehearsal_approval"]){
    const {rows:[actual]}=await db.query(`SELECT has_table_privilege($1,'SELECT') AS read,
      has_table_privilege($1,'INSERT') AS append,has_table_privilege($1,'UPDATE') AS change,
      has_table_privilege($1,'DELETE') AS remove,has_table_privilege($1,'TRUNCATE') AS empty`,[table]);
    assert.deepEqual(actual,{read:true,append:true,change:false,remove:false,empty:false});
  }
});
