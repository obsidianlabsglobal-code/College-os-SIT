import "../scripts/environment";
import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { demoEmail, demoPassword, fixtures as f } from "../scripts/fixtures";
import { createAssignment, publishAssignment } from "../lib/assignments";
import { runJobs } from "../lib/automation";

test.beforeEach(async ({ page }) => {
  const bytes = Buffer.from(randomUUID().replaceAll("-", ""), "hex");
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `198.${18 + bytes[0] % 2}.${bytes[1]}.${bytes[2]}` });
});

async function signIn(page: Page, persona: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(demoEmail(persona));
  await page.getByLabel("Password").fill(demoPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

test("a published assignment reaches the student inbox through the worker, and admins govern the rule", async ({ page }) => {
  const owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
  const { rows: [faculty] } = await owner.query<{ id: string }>('SELECT id FROM "user" WHERE email=$1', [demoEmail("faculty")]);
  await owner.end();
  const teacher = { account: faculty.id, role: "faculty" as const, institution: f.institution };
  const deadline = new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Kolkata" })
    .format(new Date(Date.now() + 30 * 86_400_000)).replace(" ", "T");
  const title = `Inbox check ${randomUUID().slice(0, 8)}`;
  const id = await createAssignment(teacher, { offering: f.offering, title, description: "Fictional.", deadline, marks: 10, file: null });
  await publishAssignment(teacher, id);
  await runJobs({ worker: "e2e" });

  await signIn(page, "student");
  const inbox = page.getByRole("region", { name: "For you" });
  const item = inbox.getByRole("listitem").filter({ hasText: title });
  await expect(item.getByRole("link", { name: new RegExp(`^New assignment: ${title}`) })).toHaveAttribute("href", new RegExp(`/assignments/${id}`));
  await item.getByRole("button", { name: "Mark read" }).click();
  await page.reload();
  await expect(inbox.getByRole("listitem").filter({ hasText: title })).toContainText("Read");
  await expect(inbox.getByRole("listitem").filter({ hasText: title }).getByRole("button", { name: "Mark read" })).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out" }).click();

  await signIn(page, "admin");
  await page.getByRole("link", { name: "Automation" }).first().click();
  await expect(page.getByRole("heading", { name: "Automation Centre" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /Worker (running|not running)/ })).toBeVisible();
  const rule = page.getByRole("listitem").filter({ hasText: "Tell enrolled students about a newly published assignment" });
  await expect(rule.getByRole("img", { name: /runs: \d+ completed/ })).toBeVisible();
  await rule.getByRole("button", { name: "Pause rule" }).click();
  await page.reload();
  await expect(rule.getByText("Paused", { exact: true })).toBeVisible();
  await rule.getByRole("button", { name: "Resume rule" }).click();
  await page.reload();
  await expect(rule.getByText("Active", { exact: true })).toBeVisible();
});

test("students cannot open the Automation Centre", async ({ page }) => {
  await signIn(page, "student");
  const response = await page.goto(`/automation?institution=${f.institution}&role=student`);
  expect(response?.status()).toBe(404);
});
