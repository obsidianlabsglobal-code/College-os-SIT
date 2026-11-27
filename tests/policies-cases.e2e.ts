// covers: AD-021, AD-016, SA-007, AD-031, AD-032, FC-009, FC-008
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

test("a policy is drafted, approved and published, and a repair is resolved then reopened by its reporter", async ({ page }, testInfo) => {
  const tag = randomUUID().slice(0, 6);
  const db = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await db.connect();
  try {
    await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.19.202.91" });
    await signIn(page, "admin");
    await page.goto(at("admin", "/policies"));
    const draft = page.getByRole("region", { name: "Draft a policy or a new version" });
    await draft.getByLabel("Title (new policy)").fill(`Library hours ${tag}`);
    await draft.getByLabel("Type (new policy)").selectOption("service");
    await draft.getByLabel("Text").fill("The library is open 8:00–20:00 on working days.");
    await draft.getByRole("button", { name: "Save draft for approval" }).click();
    await expect(draft.getByText(`Library hours ${tag} v1 · Awaiting principal`)).toBeVisible();

    await signIn(page, "principal");
    await page.goto(at("principal", "/policies"));
    const pending = page.getByRole("article", { name: `Library hours ${tag} version 1` });
    await pending.getByLabel("Decision").selectOption("approve");
    await pending.getByLabel("Reason").fill("Agreed with the librarian");
    await pending.getByRole("button", { name: "Record policy decision" }).click();
    await expect(page.getByRole("article", { name: `Library hours ${tag}` })).toContainText("v1");

    await signIn(page, "student");
    await page.goto(at("student", "/policies"));
    await expect(page.getByRole("article", { name: `Library hours ${tag}` })).toContainText("8:00–20:00");
    await page.goto(at("student", "/cases") + "&kind=facility");
    await page.getByLabel("Subject").fill(`Broken fan ${tag}`);
    await page.getByLabel("Details").fill("Fan in reading room does not turn on.");
    await page.getByRole("button", { name: "Report repair" }).click();
    await expect(page.getByRole("article", { name: `Broken fan ${tag}` })).toContainText("Open");

    await signIn(page, "admin");
    await page.goto(at("admin", "/cases") + "&kind=facility");
    const repair = page.getByRole("article", { name: `Broken fan ${tag}` });
    await repair.getByLabel("Owner").selectOption({ label: "Mira Bose" });
    await repair.getByRole("button", { name: "Assign" }).click();
    await repair.getByText("Close this case").click();
    await repair.getByLabel("Reason").fill("Replaced the capacitor");
    await repair.getByRole("button", { name: "Record outcome" }).click();
    await expect(repair).toContainText("Outcome: Replaced the capacitor");

    await signIn(page, "student");
    await page.goto(at("student", "/cases") + "&kind=facility");
    const mine = page.getByRole("article", { name: `Broken fan ${tag}` });
    await mine.getByText("Not fixed? Reopen").click();
    await mine.getByLabel("What is still wrong").fill("It stopped again the next day");
    await mine.getByRole("button", { name: "Reopen repair" }).click();
    await expect(mine).toContainText("reopened ×1");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.screenshot({ path: testInfo.outputPath("repair-reopened-390.png"), fullPage: true });
  } finally {
    const caseIds = (await db.query("SELECT id FROM case_record WHERE title LIKE $1", [`% ${tag}`])).rows.map(r => r.id);
    await db.query("DELETE FROM notification WHERE entity_id=ANY($1)", [caseIds]);
    await db.query("DELETE FROM job WHERE event_id IN (SELECT id FROM audit_event WHERE entity_id=ANY($1))", [caseIds]);
    await db.query("DELETE FROM case_note WHERE case_id=ANY($1)", [caseIds]);
    await db.query("DELETE FROM case_record WHERE id=ANY($1)", [caseIds]);
    await db.query("DELETE FROM policy_version WHERE policy_id IN (SELECT id FROM policy WHERE title LIKE $1)", [`% ${tag}`]);
    await db.query("DELETE FROM policy WHERE title LIKE $1", [`% ${tag}`]);
    await db.end();
  }
});

test("a teacher banks a question and builds a draft assignment from it", async ({ page }) => {
  const tag = randomUUID().slice(0, 6);
  const db = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await db.connect();
  try {
    await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.19.202.92" });
    await signIn(page, "faculty");
    await page.goto(at("faculty", "/questions"));
    const add = page.getByRole("region", { name: "Add a question" });
    await add.getByLabel("Topic").fill(`Arrays ${tag}`);
    await add.getByLabel("Question").fill("Reverse an array in place.");
    await add.getByLabel("Marks").fill("8");
    await add.getByRole("button", { name: "Save question" }).click();
    await expect(page.getByRole("article", { name: `Arrays ${tag} question` })).toContainText("v1 · 8 marks");
    const compose = page.getByRole("region", { name: "Build a draft assignment" });
    await compose.locator("select[name=offering]").selectOption({ label: "Introduction to Programming · Section A · Term 1" });
    await compose.getByLabel("Title").fill(`Quiz ${tag}`);
    await compose.locator("input[name=deadline]").fill(`${new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(Date.now() + 9 * 86400000))}T17:00`);
    await compose.getByLabel(`Arrays ${tag} · v1 · 8 marks`).check();
    await compose.getByRole("button", { name: "Create draft assignment" }).click();
    await expect(page).toHaveURL(/\/assignments\//);
    await expect(page.getByText("Reverse an array in place.", { exact: false })).toBeVisible();
  } finally {
    await db.query("DELETE FROM assignment WHERE title=$1", [`Quiz ${tag}`]);
    await db.query("DELETE FROM bank_question_version WHERE question_id IN (SELECT id FROM bank_question WHERE topic=$1)", [`Arrays ${tag}`]);
    await db.query("DELETE FROM bank_question WHERE topic=$1", [`Arrays ${tag}`]);
    await db.end();
  }
});
