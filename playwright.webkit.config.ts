import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

// ID-016: iPhone-size WebKit runs for sign-in, join, install and in-app alerts. Needs Playwright's WebKit browser, which the
// cloud sandbox does not have; run where it is installed: npx playwright test -c playwright.webkit.config.ts
export default defineConfig({
  ...base,
  testMatch: ["**/install.e2e.ts", "**/pilot-mobile.e2e.ts", "**/pilot-access.e2e.ts"],
  projects: [{ name: "webkit-iphone", use: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 }, serviceWorkers: "block" } }],
});
