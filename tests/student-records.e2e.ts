// covers: AD-005
import "../scripts/environment";
import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { demoEmail, demoPassword, fixtures as f } from "../scripts/fixtures";

async function signIn(page: Page, person: string) {
  if (await page.getByRole("button", { name: "Sign out", exact: true }).isVisible()) {
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
  }
  await page.goto("/login");
  await page.getByLabel("Email").fill(demoEmail(person));
  await page.getByLabel("Password").fill(demoPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
}

test("the office corrects a student's phone with a reason and the student sees it on their profile", async ({ page }) => {
  const db = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await db.connect();
  try {
    await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.19.213.51" });
    await signIn(page, "admin");
    await page.goto(`/admin/students?institution=${f.institution}&role=admin`);
    await page.getByLabel("Name, email or USN").fill("Asha");
    await page.getByRole("button", { name: "Find", exact: true }).click();
    await page.getByRole("link", { name: "Asha Sen" }).click();
    await page.getByText("Correct a detail").click();
    await page.getByLabel("Detail").selectOption("phone");
    await page.getByLabel("Correct value").fill("+91 98450 22222");
    await page.getByLabel("Reason").fill("Student gave a new number");
    await page.getByRole("button", { name: "Save correction" }).click();
    await expect(page.getByRole("region", { name: "Asha Sen" })).toContainText("+91 98450 22222");
    await expect(page.getByRole("region", { name: "Asha Sen" })).toContainText("Student gave a new number");

    await signIn(page, "student");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/profile?institution=${f.institution}&role=student`);
    await expect(page.getByRole("region", { name: "My college record" })).toContainText("Phone +91 98450 22222");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  } finally {
    const { rows: [u] } = await db.query('SELECT id FROM "user" WHERE email=$1', [demoEmail("student")]);
    await db.query("DELETE FROM person_detail_change WHERE institution_id=$1 AND account_id=$2", [f.institution, u.id]);
    await db.query("DELETE FROM person_detail WHERE institution_id=$1 AND account_id=$2", [f.institution, u.id]);
    await db.end();
  }
});
