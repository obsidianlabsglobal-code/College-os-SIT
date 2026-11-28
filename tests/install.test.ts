// covers: ID-016
import assert from "node:assert/strict";
import { test } from "node:test";
import { GET } from "../app/.well-known/assetlinks.json/route";

test("assetlinks is served only when a package and valid fingerprints are configured", async () => {
  const saved = [process.env.NEXUS_ANDROID_PACKAGE, process.env.NEXUS_ANDROID_SHA256];
  try {
    delete process.env.NEXUS_ANDROID_PACKAGE; delete process.env.NEXUS_ANDROID_SHA256;
    assert.equal(GET().status, 404, "nothing claimed by default");
    process.env.NEXUS_ANDROID_PACKAGE = "org.example.collegeos";
    process.env.NEXUS_ANDROID_SHA256 = "not-a-fingerprint";
    assert.equal(GET().status, 404, "a malformed fingerprint is refused");
    const print = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, "0")).join(":");
    process.env.NEXUS_ANDROID_SHA256 = ` ${print} `;
    const res = GET();
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), [{ relation: ["delegate_permission/common.handle_all_urls"],
      target: { namespace: "android_app", package_name: "org.example.collegeos", sha256_cert_fingerprints: [print.toUpperCase()] } }]);
  } finally {
    for (const [i, key] of (["NEXUS_ANDROID_PACKAGE", "NEXUS_ANDROID_SHA256"] as const).entries())
      if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i];
  }
});
