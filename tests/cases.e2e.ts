// covers: AD-017, AD-020, DH-014, FC-015, AD-024, LE-003
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
const cases = (role: string) => `/cases?institution=${f.institution}&role=${role}`;

test("a student grievance is assigned, resolved by its owner, and the student sees the outcome", async ({ page }, testInfo) => {
  const title = `Fictional grievance ${randomUUID().slice(0, 6)}`;
  const db = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await db.connect();
  try {
    await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.19.202.61" });
    await signIn(page, "student");
    await page.goto(cases("student"));
    await page.getByLabel("Subject").fill(title);
    await page.getByLabel("Details").fill("The library closed early three days in a row.");
    await page.getByRole("button", { name: "Submit grievance" }).click();
    await expect(page.getByRole("article", { name: title })).toContainText("Open");

    await signIn(page, "admin");
    await page.goto(cases("admin"));
    const record = page.getByRole("article", { name: title });
    await record.getByLabel("Owner").selectOption({ label: "Mira Bose" });
    await record.getByRole("button", { name: "Assign" }).click();
    await expect(record).toContainText("Owner Mira Bose");
    await record.getByRole("button", { name: "Start work" }).click();
    await expect(record).toContainText("In progress");
    await record.getByText("Close this case").click();
    await record.getByLabel("Reason").fill("Library hours restored");
    await record.getByRole("button", { name: "Record outcome" }).click();
    await expect(record).toContainText("Outcome: Library hours restored");
    await expect(page.getByRole("region", { name: "Weekly operations digest" })).toHaveCount(0);
    await page.goto(`/?institution=${f.institution}&role=admin`);
    await expect(page.getByRole("region", { name: "Weekly operations digest" })).toBeVisible();

    await signIn(page, "student");
    await page.goto(cases("student"));
    await expect(page.getByRole("article", { name: title })).toContainText("Outcome: Library hours restored");
    await expect(page.getByRole("article", { name: title })).not.toContainText("Mira Bose");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.screenshot({ path: testInfo.outputPath("grievance-student-390.png"), fullPage: true });
  } finally {
    await db.query("DELETE FROM notification WHERE entity_id IN (SELECT id FROM case_record WHERE title=$1)", [title]);
    await db.query("DELETE FROM job WHERE event_id IN (SELECT id FROM audit_event WHERE entity_id IN (SELECT id FROM case_record WHERE title=$1))", [title]);
    await db.query("DELETE FROM case_note WHERE case_id IN (SELECT id FROM case_record WHERE title=$1)", [title]);
    await db.query("DELETE FROM case_record WHERE title=$1", [title]);
    await db.end();
  }
});

test("the department head opens a support case for a teacher, and the principal sees cohort progress", async ({ page }, testInfo) => {
  const title = `Fictional support ${randomUUID().slice(0, 6)}`;
  const db = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await db.connect();
  try {
    await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.19.202.62" });
    await signIn(page, "hod");
    await page.goto(cases("hod"));
    await page.locator("select[name=subject]").selectOption({ index: 1 });
    await page.getByLabel("Subject").fill(title);
    await page.getByLabel("Details").fill("Missed two practicals.");
    await page.getByRole("button", { name: "Open case" }).click();
    const record = page.getByRole("article", { name: title });
    await record.getByLabel("Owner").selectOption({ label: "Riya Rao" });
    await record.getByRole("button", { name: "Assign" }).click();
    await expect(record).toContainText("Owner Riya Rao");

    await signIn(page, "faculty");
    await page.goto(cases("faculty"));
    await expect(page.getByRole("article", { name: title })).toBeVisible();

    await signIn(page, "principal");
    await expect(page.getByRole("region", { name: "Cohort progress" })).toContainText("Section A");
    await page.screenshot({ path: testInfo.outputPath("principal-cohorts-1280.png"), fullPage: true });
  } finally {
    await db.query("DELETE FROM notification WHERE entity_id IN (SELECT id FROM case_record WHERE title=$1)", [title]);
    await db.query("DELETE FROM job WHERE event_id IN (SELECT id FROM audit_event WHERE entity_id IN (SELECT id FROM case_record WHERE title=$1))", [title]);
    await db.query("DELETE FROM case_record WHERE title=$1", [title]);
    await db.end();
  }
});
