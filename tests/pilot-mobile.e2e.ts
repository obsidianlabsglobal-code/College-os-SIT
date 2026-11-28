// covers: ID-005, AD-002
import "../scripts/environment";
import { expect, test, type Page } from "@playwright/test";
import { demoEmail, demoPassword, fixtures as f } from "../scripts/fixtures";

// Slow 3G as Chrome DevTools defines it: 400 ms latency, about 400 kbit/s down.
async function slow3g(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 400, downloadThroughput: 50_000, uploadThroughput: 50_000 });
}
async function signIn(page: Page, person: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(demoEmail(person));
  await page.getByLabel("Password").fill(demoPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 30_000 });
}
const fits = async (page: Page, what: string) => expect(await page.evaluate(() => document.documentElement.scrollWidth), what).toBe(390);

test("pilot pages load on slow 3G at phone width", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `198.18.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}` });
  await page.setViewportSize({ width: 390, height: 844 });
  await slow3g(page);
  for (const [path, heading] of [["/login", "Sign in"], ["/login/code", "Sign in with an email code"]] as const) {
    const started = Date.now();
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible({ timeout: 20_000 });
    expect(Date.now() - started, `${path} on slow 3G`).toBeLessThan(20_000);
    await fits(page, path);
  }
  await page.goto("/join/student");
  await expect(page).toHaveURL(/\/login\/code\?next=/, { timeout: 20_000 });
  await signIn(page, "student");
  await page.goto(`/?institution=${f.institution}&role=student`);
  await expect(page.locator("h1").first()).toBeVisible({ timeout: 30_000 });
  await fits(page, "student home");
  await page.goto(`/settings?institution=${f.institution}&role=student`);
  await expect(page.getByRole("button", { name: "End sessions on all devices" })).toBeVisible({ timeout: 30_000 });
  await fits(page, "settings");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/, { timeout: 30_000 });
  await signIn(page, "faculty");
  await page.goto(`/approvals/students?institution=${f.institution}&role=faculty`);
  await expect(page.getByRole("heading", { name: "Student approvals" })).toBeVisible({ timeout: 30_000 });
  await fits(page, "approvals");
});

test("signing out on all devices ends a session left open on another phone", async ({ browser }) => {
  const address = `198.18.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;
  const shared = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": address } });
  const own = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": address } });
  const [left, mine] = [await shared.newPage(), await own.newPage()];
  await signIn(left, "outsider");
  await signIn(mine, "outsider");
  await mine.goto(`/settings?institution=${f.institution}&role=student`);
  await mine.getByRole("button", { name: "End sessions on all devices" }).click();
  await expect(mine).toHaveURL(/\/login$/);
  await left.goto(`/?institution=${f.institution}&role=student`);
  await expect(left).toHaveURL(/\/login$/);
  await Promise.all([shared.close(), own.close()]);
});
