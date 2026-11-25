import assert from "node:assert/strict";
import { test } from "node:test";
import { renderPilotConfig } from "../lib/render-pilot";

const origin = "https://nexus-sit-fictional-pilot.onrender.com";
const revision = "a".repeat(40);
const env = {
  RENDER:"true", NEXUS_FICTIONAL_PILOT:"true", AURA_MODEL_ENABLED:"false",
  RENDER_EXTERNAL_URL:origin, BETTER_AUTH_URL:origin, RENDER_GIT_COMMIT:revision,
  BETTER_AUTH_SECRET:"test-secret-not-for-deployment".repeat(2),
  DATABASE_URL:"postgresql://nexus_app:fixture@ep-test.neon.tech/nexus?sslmode=verify-full",
  NEXUS_RUNTIME_TARGET:"postgresql://nexus_app@ep-test.neon.tech/nexus",
};

test("accepts the exact fictional Render and Neon release configuration", () => {
  assert.deepEqual(renderPilotConfig(env),{revision,port:10000});
  assert.deepEqual(renderPilotConfig({...env,PORT:"12000"}),{revision,port:12000});
});

test("refuses absent pilot mode, a wrong origin, an unstamped build and missing auth secret", () => {
  for (const override of [
    {RENDER:undefined},{NEXUS_FICTIONAL_PILOT:"false"},{BETTER_AUTH_URL:"https://other.onrender.com"},
    {RENDER_EXTERNAL_URL:"http://nexus-sit-fictional-pilot.onrender.com"},{RENDER_GIT_COMMIT:"short"},
    {BETTER_AUTH_SECRET:"short"},{PORT:"0"},
  ]) assert.throws(() => renderPilotConfig({...env,...override}));
});

test("rejects privileged, AI-enabled or unapproved database configurations", () => {
  for (const override of [
    {MIGRATION_DATABASE_URL:"present"},{NEXUS_DEMO_SEED:"1"},{NEXUS_DEMO_PASSWORD:"present"},
    {ANTHROPIC_API_KEY:"present"},{AURA_MODEL_ENABLED:"true"},{AURA_MODEL_ENABLED:undefined},
    {DATABASE_URL:env.DATABASE_URL.replace("nexus_app","owner")},
    {DATABASE_URL:env.DATABASE_URL.replace("ep-test","ep-other")},
    {DATABASE_URL:env.DATABASE_URL.replace("verify-full","require")},
    {DATABASE_URL:env.DATABASE_URL.replace("neon.tech","example.org"),
      NEXUS_RUNTIME_TARGET:env.NEXUS_RUNTIME_TARGET.replace("neon.tech","example.org")},
  ]) assert.throws(() => renderPilotConfig({...env,...override}));
});
