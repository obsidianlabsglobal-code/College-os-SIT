// covers: ID-012, ID-009
import "../scripts/environment";
import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { demoEmail, demoPassword, fixtures as f } from "../scripts/fixtures";

test("the office checks a student sheet and admits the clean rows", async ({ page }) => {
  const tag = randomUUID().slice(0, 6);
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `198.18.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}` });
  await page.goto("/login");
  await page.getByLabel("Email").fill(demoEmail("admin"));
  await page.getByLabel("Password").fill(demoPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await page.goto(`/admin/roster-import?institution=${f.institution}&role=admin`);
  const sheet = (rows: string) => `name,email,usn,semester,section,phone\n${rows}`;
  await page.getByLabel("How students are added").selectOption("approved");
  await page.getByLabel("Or paste the student CSV").fill(sheet(`Kavya ${tag},kavya-${tag}@nexus.example.invalid,4SI${tag}X,3,Section B,\nTwin ${tag},kavya-${tag}@nexus.example.invalid,4SI${tag}Y,3,Section B,`));
  await page.getByRole("button", { name: "Check the student sheet" }).click();
  await expect(page.getByRole("heading", { name: "1 of 2 student rows need fixing" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Checked student rows" })).toContainText("Same email as line 2");
  await page.getByLabel("How students are added").selectOption("approved");
  await page.getByLabel("Or paste the student CSV").fill(sheet(`Kavya ${tag},kavya-${tag}@nexus.example.invalid,4SI${tag}X,3,Section B,`));
  await page.getByRole("button", { name: "Check the student sheet" }).click();
  await expect(page.getByRole("heading", { name: "1 student rows ready" })).toBeVisible();
  await page.getByRole("button", { name: "Add 1 students" }).click();
  await expect(page.getByRole("heading", { name: "Students imported" })).toBeVisible();
  await page.goto(`/admin/pilot-health?institution=${f.institution}&role=admin`);
  await expect(page.getByRole("heading", { name: "Pilot health" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Pilot summary" })).toContainText("Waiting for approval");
});
