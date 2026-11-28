// covers: ID-004, ID-014, ID-015
import "../scripts/environment";
import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { demoEmail, demoPassword, fixtures as f } from "../scripts/fixtures";

test("a student searches once across notices, college dates and opportunities", async ({ page }, testInfo) => {
  const tag = `zq${randomUUID().slice(0, 6)}`, notice = randomUUID();
  const db = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await db.connect();
  try {
    await db.query(`INSERT INTO notice (institution_id,id,author_id,author_role,title,body,published_at)
      SELECT $1,$2,id,'admin',$3,'Fictional circular: internal assessment timetable.',now() FROM "user" WHERE email=$4`, [f.institution, notice, `Circular ${tag}`, demoEmail("admin")]);
    await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.19.211.31" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/login");
    await page.getByLabel("Email").fill(demoEmail("student"));
    await page.getByLabel("Password").fill(demoPassword);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await page.goto(`/search?institution=${f.institution}&role=student`);
    await page.getByLabel("Search for").fill(`circular ${tag}`);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    const hit = page.getByRole("article", { name: `Circular ${tag}` });
    await expect(hit).toContainText("Notice");
    await hit.getByRole("link", { name: `Circular ${tag}` }).click();
    await expect(page).toHaveURL(/\/notices\?.*#notice-/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);

    // The header bar on any page: "/" focuses it; a typo still finds the circular; results are grouped by type.
    await page.goto(`/timetable?institution=${f.institution}&role=student`);
    const bar = page.getByRole("searchbox", { name: "Search College OS" });
    await expect(bar).toBeVisible();
    await expect(async () => { await page.keyboard.press("/"); await expect(bar).toBeFocused({ timeout: 500 }); }).toPass(); // after hydration
    await bar.fill(`circulr ${tag}`);
    await bar.press("Enter");
    await expect(page.getByRole("region", { name: "Notice" }).getByRole("link", { name: `Circular ${tag}` })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await page.screenshot({ path: testInfo.outputPath("search-390.png"), fullPage: true });
    await page.setViewportSize({ width: 1366, height: 768 });
    await expect(async () => { await page.keyboard.press("/"); await expect(page.getByRole("searchbox", { name: "Search College OS" })).toBeFocused({ timeout: 500 }); }).toPass();
    await page.getByRole("searchbox", { name: "Search College OS" }).fill("atendence");
    await page.getByRole("searchbox", { name: "Search College OS" }).press("Enter");
    await expect(page.getByRole("region", { name: "Go to" }).getByRole("link", { name: "My attendance" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1366);
    await page.screenshot({ path: testInfo.outputPath("search-1366.png"), fullPage: true });
  } finally {
    await db.query("DELETE FROM notice WHERE institution_id=$1 AND id=$2", [f.institution, notice]);
    await db.end();
  }
});
