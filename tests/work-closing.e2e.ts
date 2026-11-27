// covers: AD-018, SA-010, SA-002, LE-019
import "../scripts/environment";
import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { demoEmail, demoPassword, fixtures as f } from "../scripts/fixtures";

async function signIn(page: Page, person: string) {
  if (await page.getByRole("button", { name: "Sign out" }).isVisible()) await page.getByRole("button", { name: "Sign out" }).click();
  await page.goto("/login");
  await page.getByLabel("Email").fill(demoEmail(person));
  await page.getByLabel("Password").fill(demoPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}
const at = (role: string, path: string) => `${path}?institution=${f.institution}&role=${role}`;
const today = () => new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date());

test("the office publishes a date and hides an offering; staff see their queue; the principal downloads a dated report", async ({ page, context }, testInfo) => {
  const tag = randomUUID().slice(0, 6);
  const db = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await db.connect();
  try {
    await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.19.202.111" });
    await signIn(page, "admin");
    await page.goto(at("admin", "/admin"));
    const calendar = page.getByRole("region", { name: "Institution calendar" });
    await calendar.getByLabel("Title").fill(`Sports day ${tag}`);
    await calendar.getByLabel("Type").selectOption("event");
    await calendar.getByLabel("From").fill(today());
    await calendar.getByLabel("To").fill(today());
    await calendar.getByRole("button", { name: "Publish date" }).click();
    await expect(calendar.getByText(`Sports day ${tag} · ${today()}`)).toBeVisible();

    await page.goto(at("admin", "/catalog"));
    const row = page.getByRole("region", { name: "Mechanical Engineering offerings" }).getByRole("row").filter({ hasText: "Engineering Mechanics" });
    await row.getByRole("button", { name: "Hide" }).click();
    await expect(row.getByRole("button", { name: "Show" })).toBeVisible();

    await page.goto(at("admin", "/work"));
    await expect(page.getByRole("heading", { name: "My work" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("work-admin-1280.png"), fullPage: true });

    await signIn(page, "student");
    await page.goto(at("student", "/calendar") + "&kind=institution");
    await expect(page.getByText(`Sports day ${tag}`)).toBeVisible();
    await page.goto(at("student", "/catalog"));
    await expect(page.getByText("Engineering Mechanics")).toHaveCount(0);

    await signIn(page, "principal");
    const report = await context.request.get(`/records/export?institution=${f.institution}&role=principal&from=${today()}&to=${today()}`);
    expect(await report.text()).toContain(`${today()} to ${today()}`);
    await expect(page.getByRole("form", { name: "Executive report for dates" })).toBeVisible();
  } finally {
    await db.query("DELETE FROM calendar_entry WHERE title=$1", [`Sports day ${tag}`]);
    await db.query("UPDATE offering SET catalog_visible=true WHERE institution_id=$1", [f.institution]);
    await db.end();
  }
});
