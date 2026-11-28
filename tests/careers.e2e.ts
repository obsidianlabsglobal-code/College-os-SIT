// covers: CR-002, CR-016, CR-032, CR-033
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

test("a student tracks a placement drive and submits, and the office shortlists and records an offer", async ({ page }, testInfo) => {
  const tag = randomUUID().slice(0, 6), id = randomUUID(), title = `Campus drive ${tag}`;
  const db = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await db.connect();
  try {
    await db.query(`INSERT INTO opportunity_listing (institution_id,id,kind,title,sponsor,eligibility,source_url,deadline,verified_by,department_id)
      SELECT $1,$2,'placement',$3,'Fictional Systems','Final-year ECE students','https://example.org/drive',current_date+7,u.id,$4 FROM "user" u WHERE u.email=$5`,
    [f.institution, id, title, f.department, demoEmail("admin")]);
    await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.19.205.23" });
    await signIn(page, "student");
    await page.goto(at("student", "/opportunities") + `&query=${tag}`);
    const card = page.locator(".listing-card").filter({ hasText: title });
    await expect(card).toContainText("Only for students taking a Electronics and Communication Engineering course");
    await card.getByRole("button", { name: "Track" }).click();
    await expect(card.getByRole("status")).toHaveText("Saved to My applications.");
    await page.goto(at("student", "/careers"));
    const app = page.getByRole("article", { name: title });
    await expect(app.locator(".tag")).toHaveText("Saved");
    await app.getByText("Mark as submitted").click();
    await app.getByLabel("Final statement").fill("I led a fictional robotics club project.");
    await app.getByRole("button", { name: "Submit application" }).click();
    await expect(app.locator(".tag")).toHaveText("Submitted");

    await signIn(page, "admin");
    await page.goto(at("admin", "/careers"));
    const applicant = page.getByRole("article", { name: `Asha Sen · ${title}` });
    await applicant.getByLabel("Note").fill("Interview on Monday");
    await applicant.getByRole("button", { name: "Record outcome" }).click();
    await expect(applicant.locator(".tag")).toHaveText("Shortlisted");
    await applicant.getByLabel("Outcome").selectOption({ label: "Offer recorded" });
    await applicant.getByLabel("Note").fill("Offer letter issued");
    await applicant.getByRole("button", { name: "Record outcome" }).click();
    await expect(applicant.locator(".tag")).toHaveText("Offer recorded");
    await expect(page.getByRole("region", { name: "Placement outcomes by department" })).toContainText("Electronics and Communication Engineering");

    await signIn(page, "student");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(at("student", "/careers"));
    await expect(page.getByRole("article", { name: title })).toContainText("Office note: Offer letter issued");
    await expect(page.getByLabel("Résumé text")).toHaveValue(/^Asha Sen/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await page.screenshot({ path: testInfo.outputPath("careers-student-390.png"), fullPage: true });
  } finally {
    await db.query("DELETE FROM opportunity_application WHERE institution_id=$1 AND listing_id=$2", [f.institution, id]);
    await db.query("DELETE FROM opportunity_listing WHERE institution_id=$1 AND id=$2", [f.institution, id]);
    await db.end();
  }
});
