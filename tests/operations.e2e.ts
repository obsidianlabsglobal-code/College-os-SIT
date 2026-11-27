// covers: AD-018, AD-022, AD-024, SA-017
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

test("admin claims a request from the unassigned queue, then finds the change in the audit log", async ({ page }, testInfo) => {
  const text = `Fictional bonafide letter ${randomUUID().slice(0, 8)}`;
  const db = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await db.connect();
  await db.query(`INSERT INTO service_request (institution_id,student_id,description) SELECT $1,id,$2 FROM "user" WHERE email=$3`, [f.institution, text, demoEmail("student")]);
  await db.end();
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.19.202.31" });
  await signIn(page, "admin");
  await expect(page.getByLabel("Operations report")).toContainText("Unassigned open requests");
  await page.goto(`/requests?institution=${f.institution}&role=admin&view=unassigned`);
  const record = page.getByRole("article").filter({ hasText: text });
  await expect(record.getByText("Unassigned")).toBeVisible();
  await record.getByRole("button", { name: "Assign" }).click();
  await expect(record.getByText("Assigned to Mira Bose")).toHaveCount(0);
  await page.getByRole("link", { name: "Assigned to me" }).click();
  const mine = page.getByRole("article").filter({ hasText: text });
  await expect(mine.getByText("Assigned to Mira Bose")).toBeVisible();
  await mine.getByRole("button", { name: "Start review" }).click();
  await expect(mine.getByRole("button", { name: "Record outcome" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: testInfo.outputPath("requests-mine-390.png"), fullPage: true });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("link", { name: "Audit log" }).first().click();
  await page.getByLabel("Action starts with").fill("service_request.assigned");
  await page.getByRole("button", { name: "Search" }).click();
  const events = page.getByRole("region", { name: "Audit events" });
  await expect(events.getByRole("row").filter({ hasText: "service_request.assigned" }).first()).toContainText("Mira Bose");
  await expect(events).not.toContainText(text);
  await page.screenshot({ path: testInfo.outputPath("audit-1280.png"), fullPage: true });

  await signIn(page, "principal");
  expect((await page.goto(`/audit?institution=${f.institution}&role=principal`))?.status()).toBe(404);
  await signIn(page, "student");
  expect((await page.goto(`/audit?institution=${f.institution}&role=student`))?.status()).toBe(404);
  await page.goto(`/?institution=${f.institution}&role=student`);
  await page.getByRole("link", { name: "Assessment history" }).first().click();
  await expect(page.getByRole("heading", { name: "All assessments, newest first" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Assessment record" }).getByRole("row").nth(1)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
