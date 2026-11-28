// covers: ID-005
import "../scripts/environment";
import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { demoEmail, demoPassword, fixtures as f } from "../scripts/fixtures";

test.use({ serviceWorkers: "allow" });

async function signIn(page: Page, person: string) {
  if (await page.getByRole("button", { name: "Sign out" }).isVisible()) await page.getByRole("button", { name: "Sign out" }).click();
  await page.goto("/login");
  await page.getByLabel("Email").fill(demoEmail(person));
  await page.getByLabel("Password").fill(demoPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

test("the app installs from a manifest, shows an offline page without caching records, and every home fits a phone", async ({ page, context, request }, testInfo) => {
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest).toMatchObject({ name: "NEXUS College OS", short_name: "NEXUS", display: "standalone", start_url: "/" });
  for (const icon of manifest.icons) expect((await request.get(icon.src)).status()).toBe(200);
  expect((await request.get("/offline.html")).status()).toBe(200);
  expect((await request.get("/api/push")).status(), "phone messages need a session").toBe(401);

  const db = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await db.connect();
  try {
    await db.query(`INSERT INTO membership (institution_id,account_id,role) SELECT $1,id,r FROM "user", unnest(ARRAY['transport','driver']) r WHERE email=$2 ON CONFLICT DO NOTHING`,
      [f.institution, demoEmail("replacement")]);
    await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.19.209.81" });
    await page.setViewportSize({ width: 390, height: 844 });
    const homes: [string, string][] = [["student", "student"], ["faculty", "faculty"], ["hod", "hod"], ["admin", "admin"], ["principal", "principal"],
      ["replacement", "transport"], ["replacement", "driver"]];
    for (const [person, role] of homes) {
      await signIn(page, person);
      await page.goto(`/?institution=${f.institution}&role=${role}`);
      await expect(page.locator("h1").first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `${role} home at 390 px`).toBe(390);
    }
    await page.screenshot({ path: testInfo.outputPath("driver-home-390.png"), fullPage: true });

    // The worker controls the page after it activates; offline navigations get the static page, never a stored record.
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload();
    expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    const cached = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async key => (await (await caches.open(key)).keys()).map(r => new URL(r.url).pathname)))).flat());
    expect(cached.sort()).toEqual(["/icons/icon-192.png", "/offline.html"]);
    await context.setOffline(true);
    await page.goto(`/timetable?institution=${f.institution}&role=driver`).catch(() => undefined);
    await expect(page.getByRole("heading", { name: "You are offline" })).toBeVisible();
    await context.setOffline(false);
  } finally {
    await db.query(`DELETE FROM membership WHERE institution_id=$1 AND role IN ('transport','driver') AND account_id=(SELECT id FROM "user" WHERE email=$2)`, [f.institution, demoEmail("replacement")]);
    await db.end();
  }
});
