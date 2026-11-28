import "./scripts/environment";
import { defineConfig } from "@playwright/test";

// Rehearses docs/DEMO_DEC2.md against a clean demo database (db:migrate, db:seed, db:seed-demo). Not part of CI: it changes the demo data.
for (const value of [process.env.DATABASE_URL, process.env.MIGRATION_DATABASE_URL]) {
  if (!value || !["localhost", "127.0.0.1"].includes(new URL(value).hostname)) throw Error("Use a local demo database.");
}
const baseURL = "http://127.0.0.1:3000";
export default defineConfig({
  testDir: "tests/demo", testMatch: "*.rehearsal.ts", workers: 1, timeout: 240000,
  use: { baseURL, launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {} },
  webServer: { command: "npm run start -- --hostname 127.0.0.1", url: baseURL + "/api/health", reuseExistingServer: true, timeout: 120000 },
});
