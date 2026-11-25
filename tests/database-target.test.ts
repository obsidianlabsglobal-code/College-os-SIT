import assert from "node:assert/strict";
import {test} from "node:test";
import {databaseConnection} from "../lib/database-target";

test("remote connections require exact tool-specific nonsecret identities and verified TLS",()=>{
  const target="postgresql://nexus_app.fictional@pool.invalid:6543/postgres";
  const uri=target.replace("@",":fixture@")+"?sslmode=verify-full";
  const env={DATABASE_URL:uri,NEXUS_RUNTIME_TARGET:target};
  assert.equal(databaseConnection("runtime",env),uri);
  for(const other of [uri.replace("fictional","unrelated"),uri.replace(":6543",":5432"),uri.replace("/postgres?","/different?"),uri.replace("verify-full","disable"),uri+"&host=other.invalid"]) {
    assert.throws(()=>databaseConnection("runtime",{...env,DATABASE_URL:other}),/approved NEXUS/);
  }
  assert.throws(()=>databaseConnection("runtime",{DATABASE_URL:uri}));
  assert.throws(()=>databaseConnection("runtime",{DATABASE_URL:uri.replace("nexus_app","postgres"),NEXUS_RUNTIME_TARGET:target.replace("nexus_app","postgres")}));
  assert.throws(()=>databaseConnection("migration",{...env,MIGRATION_DATABASE_URL:uri}));
  assert.equal(databaseConnection("migration",{MIGRATION_DATABASE_URL:uri,NEXUS_MIGRATION_TARGET:target}),uri);
  const local="postgresql://nexus_app@127.0.0.1/nexus";
  assert.equal(databaseConnection("runtime",{DATABASE_URL:local}),local);
  assert.throws(()=>databaseConnection("runtime",{DATABASE_URL:local+"?host=another.invalid"}));
  assert.throws(()=>databaseConnection("migration",{MIGRATION_DATABASE_URL:local,NEXUS_MIGRATION_TARGET:target}));
});
