import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { demoEmail, demoPassword, fixtures } from "../scripts/fixtures";

// Fictional personas from the seed. Assertions target this run's assignment, because the
// shared local database accumulates records from earlier runs.

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

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
}

const workspace = (role: string) => `institution=${fixtures.institution}&role=${role}`;

test("faculty mission control leads from pending work through the evaluation queue to publication", async ({ page }) => {
  const title = `Queue journey ${randomUUID().slice(0, 8)}`;
  await signIn(page, "faculty");
  await expect(page.getByRole("heading", { name: "What needs your attention" })).toBeVisible();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill(title);
  await page.getByLabel("Instructions").fill("Trace the loop invariant.");
  const deadline = new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Kolkata" })
    .format(new Date(Date.now() + 86_400_000)).replace(" ", "T");
  await page.getByLabel(/Deadline/).fill(deadline);
  await page.getByLabel("Maximum marks").fill("10");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await page.goto(`/?${workspace("faculty")}`);
  const unpublished = page.getByRole("region", { name: "What needs your attention" }).getByRole("listitem").filter({ hasText: title }).last();
  await expect(unpublished.getByText("Not published")).toBeVisible();
  await unpublished.getByRole("link", { name: title }).click();
  await page.getByRole("button", { name: "Publish assignment" }).click();
  await expect(page.getByText("Published", { exact: true })).toBeVisible();
  await signOut(page);

  await signIn(page, "student");
  const denied = await page.goto(`/grading?${workspace("student")}`);
  expect(denied?.status()).toBe(404);
  const forged = await page.goto(`/grading?${workspace("faculty")}`);
  expect(forged?.status()).toBe(404);
  await page.goto(`/?${workspace("student")}`);
  await page.getByRole("link", { name: title }).click();
  await page.getByLabel("Response").fill("The invariant holds before and after each iteration.");
  await page.getByRole("button", { name: "Submit assignment" }).click();
  await expect(page.getByRole("heading", { name: "Submitted" })).toBeVisible();
  await signOut(page);

  await signIn(page, "faculty");
  const progress = page.getByRole("region", { name: "Assignment progress" }).getByRole("listitem").filter({ hasText: title });
  await expect(progress.getByText(/1 of \d+ enrolled students? submitted/)).toBeVisible();
  await progress.getByRole("link", { name: "1 awaiting evaluation" }).click();
  await expect(page.getByRole("heading", { name: "Evaluation queue" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Campus workflows" }).getByRole("link", { name: "Evaluation queue" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("navigation", { name: "Queue status" }).getByRole("link", { name: /Awaiting evaluation/ })).toHaveAttribute("aria-current", "page");
  const row = page.getByRole("listitem").filter({ hasText: "Asha Sen" });
  await expect(row).toHaveCount(1);
  const evaluate = row.getByRole("link", { name: `Evaluate submission by Asha Sen for ${title}` });
  await evaluate.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/submission=/);
  const focusedUrl = page.url();
  await expect(page.getByRole("heading", { name: "Asha Sen" })).toBeVisible();
  await expect(page.getByText("Awaiting evaluation", { exact: true })).toBeVisible();
  await page.getByLabel("Marks", { exact: true }).fill("8");
  await page.getByLabel("Feedback").fill("Clear invariant. State the termination argument.");
  await page.getByRole("button", { name: "Save grade draft" }).click();
  await expect(page.getByText("Draft awaiting publication", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByText("Draft awaiting publication", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Open in evaluation queue" }).click();
  const awaiting = page.getByRole("navigation", { name: "Queue status" }).getByRole("link", { name: /Awaiting publication/ });
  await awaiting.click();
  const drafted = page.getByRole("listitem").filter({ hasText: "Asha Sen" });
  await expect(drafted.getByText("Draft 8/10")).toBeVisible();
  await expect(drafted.getByText("Published", { exact: false })).toHaveCount(0);
  await drafted.getByRole("link", { name: /Review draft/ }).click();
  await page.getByRole("button", { name: "Publish feedback" }).click();
  await expect(page.getByText("Published result · 8/10")).toBeVisible();
  await page.getByRole("link", { name: "Open in evaluation queue" }).click();
  await page.getByRole("navigation", { name: "Queue status" }).getByRole("link", { name: /^Published/ }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Asha Sen" }).getByText("Published 8/10")).toBeVisible();
  expect(page.url()).toContain("assignment=");
  await page.goto(`${page.url()}&offering=${fixtures.otherOffering}`);
  await expect(page).not.toHaveURL(/assignment=/);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await signOut(page);

  await signIn(page, "replacement");
  const unrostered = await page.goto(focusedUrl);
  expect(unrostered?.status()).toBe(404);
  await page.goto(`/grading?${workspace("faculty")}&status=all`);
  await expect(page.getByText(title)).toHaveCount(0);
  await expect(page.getByText("You have no active teaching assignments in this workspace.")).toBeVisible();
});

test("the evaluation queue rejects malformed filters without failing", async ({ page }) => {
  await signIn(page, "faculty");
  const response = await page.goto(`/grading?${workspace("faculty")}&status=%27OR1&sort=drop&page=-3&assignment=nope`);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("navigation", { name: "Queue status" }).getByRole("link", { name: /Awaiting evaluation/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByLabel("Sort")).toHaveValue("oldest");
  const outsideTenant = await page.goto(`/grading?institution=${fixtures.otherInstitution}&role=faculty`);
  expect(outsideTenant?.status()).toBe(404);
});
