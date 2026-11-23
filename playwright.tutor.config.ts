import "./scripts/environment";
import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";
import { fixtures } from "./scripts/fixtures";

for (const value of [process.env.DATABASE_URL,process.env.MIGRATION_DATABASE_URL]) {
  if (!value || !["localhost","127.0.0.1"].includes(new URL(value).hostname)) throw Error("Use a local test database.");
}
const baseURL="http://127.0.0.1:3013";
export default defineConfig({
  testDir:"tests/tutor-browser", testMatch:"*.spec.ts", workers:1,
  use:{baseURL,launchOptions:process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {}},
  webServer:{command:"npm run start -- --hostname 127.0.0.1 --port 3013",url:baseURL+"/api/health",reuseExistingServer:false,
    env:{BETTER_AUTH_URL:baseURL,ANTHROPIC_API_KEY:"browser-fixture",AURA_TUTOR_MODEL:"browser-fixture",
      AURA_TUTOR_INSTITUTION:fixtures.institution,AURA_INPUT_USD_PER_MTOK:"1",AURA_OUTPUT_USD_PER_MTOK:"2",AURA_DAILY_MICROUSD:"100000",
      NODE_OPTIONS:"--require="+resolve("tests/tutor-browser/provider-fixture.cjs")}},
});
