// covers: ID-016, ID-015
import "../scripts/environment";
import { expect, test } from "@playwright/test";
import { demoEmail, demoPassword, fixtures as f } from "../scripts/fixtures";

const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";

test("Get the app shows the visitor's own device first, without signing in", async ({ browser }, testInfo) => {
  for (const [ua, first, size] of [[ANDROID, "Android phone", { width: 390, height: 844 }], [IPHONE, "iPhone", { width: 390, height: 844 }],
    [undefined, "Laptop or desktop", { width: 1366, height: 768 }]] as const) {
    const context = await browser.newContext({ userAgent: ua, viewport: size });
    const page = await context.newPage();
    await page.goto("/get-app");
    await expect(page.getByRole("heading", { level: 2 }).first()).toHaveText(first);
    await expect(page.getByRole("heading", { level: 2 })).toHaveCount(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);
    await page.screenshot({ path: testInfo.outputPath(`get-app-${first.split(" ")[0].toLowerCase()}-${size.width}.png`), fullPage: true });
    await context.close();
  }
});

test("in a browser tab the install banner shows on every visit until closed for that visit; never inside the installed app", async ({ browser }) => {
  const signIn = async (standalone: boolean) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: IPHONE,
      extraHTTPHeaders: { "x-forwarded-for": `198.18.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}` } });
    if (standalone) await context.addInitScript(() => { Object.defineProperty(navigator, "standalone", { value: true }); });
    const page = await context.newPage();
    await page.goto("/login");
    await page.getByLabel("Email").fill(demoEmail("student"));
    await page.getByLabel("Password").fill(demoPassword);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
    return { context, page };
  };
  const tab = await signIn(false);
  const banner = tab.page.getByRole("complementary", { name: "Install College OS" });
  await expect(banner).toBeVisible();
  await banner.getByRole("button", { name: "Not now" }).click();
  await expect(banner).toHaveCount(0);
  await tab.page.goto(`/timetable?institution=${f.institution}&role=student`);
  await expect(tab.page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(banner).toHaveCount(0, { timeout: 2000 });
  await tab.context.close();

  const nextVisit = await signIn(false);
  await expect(nextVisit.page.getByRole("complementary", { name: "Install College OS" })).toBeVisible();
  await nextVisit.page.getByRole("complementary", { name: "Install College OS" }).getByRole("link", { name: "How to install" }).click();
  await expect(nextVisit.page.getByRole("heading", { level: 2 }).first()).toHaveText("iPhone");
  await nextVisit.context.close();

  const app = await signIn(true);
  await expect(app.page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(app.page.getByRole("complementary", { name: "Install College OS" })).toHaveCount(0, { timeout: 2000 });
  await app.context.close();
});
