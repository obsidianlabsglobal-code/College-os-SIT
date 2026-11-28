// covers: ID-015
import "../scripts/environment";
import { expect, test } from "@playwright/test";
import { demoEmail, demoPassword, fixtures as f } from "../scripts/fixtures";

// Founder rule: mobile-first, laptop first-class. Each role's main pages at phone and laptop sizes (and 1920 for the office
// and HOD dashboards) must not scroll sideways. Screenshots go to the test output for the evidence folder.
const sizes = { phone: { width: 390, height: 844 }, laptop: { width: 1366, height: 768 }, wide: { width: 1920, height: 1080 } };
const plan: [string, string, string[], (keyof typeof sizes)[]][] = [
  ["student", "student", ["/", "/timetable", "/transport", "/clubverse", "/notices", "/cases", "/search?q=exam", "/settings"], ["phone", "laptop"]],
  ["faculty", "faculty", ["/", "/timetable", "/grading", "/approvals/students", "/facilities"], ["phone", "laptop"]],
  ["hod", "hod", ["/", "/cases"], ["phone", "laptop", "wide"]],
  ["admin", "admin", ["/", "/admin/pilot-health", "/admin/students", "/facilities", "/cases"], ["phone", "laptop", "wide"]],
];

for (const [person, role, paths, which] of plan) test(`${person} pages fit at ${which.join(", ")}`, async ({ page }, testInfo) => {
  test.setTimeout(120000);
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `198.18.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}` });
  await page.goto("/login");
  await page.getByLabel("Email").fill(demoEmail(person));
  await page.getByLabel("Password").fill(demoPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  const overflow: string[] = [];
  for (const size of which) {
    await page.setViewportSize(sizes[size]);
    for (const path of paths) {
      const [base, q] = path.split("?");
      const response = await page.goto(`${base}?institution=${f.institution}&role=${role}${q ? `&${q}` : ""}`);
      if (response?.status() !== 200) { overflow.push(`${path} answered ${response?.status()}`); continue; }
      await expect(page.locator("main")).toBeVisible();
      await page.waitForLoadState("networkidle");
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      if (width > sizes[size].width) overflow.push(`${path} at ${sizes[size].width}px is ${width}px wide`);
      await page.screenshot({ path: testInfo.outputPath(`${person}-${base.replace(/\//g, "_") || "_home"}-${sizes[size].width}.png`) });
    }
  }
  expect(overflow).toEqual([]);
});
