import assert from "node:assert/strict";
import { test } from "node:test";
import { assertReleaseHealth, isReleaseRevision } from "../lib/release-revision";

const revision = "a".repeat(40);

test("a release revision is an exact full lowercase Git SHA", () => {
  assert.equal(isReleaseRevision(revision),true);
  for (const invalid of [undefined,{},revision.slice(0,7),revision+"\n",revision.toUpperCase()]) {
    assert.equal(isReleaseRevision(invalid),false);
  }
});

test("hosted acceptance rejects stale aliases, missing attestations and unhealthy responses", () => {
  assert.doesNotThrow(() => assertReleaseHealth(200,{status:"ok",revision},revision));
  assert.doesNotThrow(() => assertReleaseHealth(200,{status:"ok"}));
  assert.throws(() => assertReleaseHealth(200,{status:"ok",revision:"b".repeat(40)},revision),/expected NEXUS revision/);
  assert.throws(() => assertReleaseHealth(200,{status:"ok"},revision),/expected NEXUS revision/);
  assert.throws(() => assertReleaseHealth(200,{status:"ok",revision},""),/expected NEXUS revision/);
  assert.throws(() => assertReleaseHealth(302,{status:"ok",revision},revision),/health check failed/);
  assert.throws(() => assertReleaseHealth(503,null,revision),/health check failed/);
  assert.throws(() => assertReleaseHealth(200,null,revision),/health check failed/);
});
