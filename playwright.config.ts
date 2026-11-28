import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.e2e.ts",
  workers: 1,
  timeout: 60000,
  expect: { timeout: 8000 },
  use: {
    baseURL: "http://127.0.0.1:3000",
    // The app-shell service worker would hide navigations from page.route; tests/app-shell.e2e.ts allows it explicitly.
    serviceWorkers: "block",
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1",
    url: "http://127.0.0.1:3000/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
