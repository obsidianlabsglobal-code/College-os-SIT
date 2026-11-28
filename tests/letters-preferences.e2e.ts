// covers: AD-020, SL-010, SL-015
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

test("a student submits a letter the office decides, sets larger text, and finds a support service the office published", async ({ page }, testInfo) => {
  const tag = randomUUID().slice(0, 6);
  const db = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await db.connect();
  try {
    await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.19.203.41" });
    await signIn(page, "student");
    await page.goto(at("student", "/letters"));
    await page.getByLabel("Addressed to").fill(`Office ${tag}`);
    await page.getByLabel("From date").fill("2026-12-21");
    await page.getByLabel("Through date").fill("2026-12-22");
    await page.getByLabel("Brief reason").fill("a family function");
    await page.getByRole("button", { name: "Generate draft" }).click();
    const submit = page.getByRole("region", { name: "Submit to the office" });
    await submit.getByRole("button", { name: "Submit letter" }).click();
    await expect(submit.getByRole("status")).toHaveText("Case opened.");
    await page.goto(at("student", "/cases") + "&kind=letter");
    const mine = page.getByRole("article", { name: "Leave request · 2026-12-21 to 2026-12-22" }).first();
    await expect(mine).toContainText(`Office ${tag}`);
    await expect(mine).toContainText("Open");
    await page.screenshot({ path: testInfo.outputPath("letter-submitted.png"), fullPage: true });

    await signIn(page, "admin");
    await page.goto(at("admin", "/cases") + "&kind=letter");
    const letter = page.getByRole("article").filter({ hasText: `Office ${tag}` });
    await expect(letter).toContainText("Opened by Asha Sen");
    await letter.getByLabel("Owner").selectOption({ label: "Mira Bose" });
    await letter.getByRole("button", { name: "Assign" }).click();
    await expect(letter).toContainText("Owner Mira Bose");
    await letter.getByText("Close this case").click();
    await letter.getByLabel("Reason").fill("Leave approved; inform your teachers.");
    await letter.getByRole("button", { name: "Record outcome" }).click();
    await expect(letter).toContainText("Leave approved; inform your teachers.");

    await page.goto(at("admin", "/support"));
    const publish = page.getByRole("region", { name: "Publish a service" });
    await publish.getByLabel("Category").selectOption("counselling");
    await publish.getByLabel("Service name").fill(`Student counselling ${tag}`);
    await publish.getByLabel("What it offers").fill("Fictional: confidential one-to-one sessions.");
    await publish.getByLabel("How to reach it").fill("Room 12, Health centre");
    await publish.getByLabel("Hours").fill("Mon–Sat, 10:00–17:00");
    await publish.getByRole("button", { name: "Publish service" }).click();
    await expect(page.getByRole("article", { name: `Student counselling ${tag}` })).toBeVisible();

    await signIn(page, "student");
    await page.goto(at("student", "/cases") + "&kind=letter");
    await expect(page.getByRole("article").filter({ hasText: `Office ${tag}` })).toContainText("Leave approved; inform your teachers.");
    await page.goto(at("student", "/support"));
    await page.getByRole("navigation", { name: "Service category" }).getByRole("link", { name: "Counselling" }).click();
    await expect(page.getByRole("article", { name: `Student counselling ${tag}` })).toContainText("Room 12, Health centre");
    await page.getByRole("navigation", { name: "Service category" }).getByRole("link", { name: "Health", exact: true }).click();
    await expect(page.getByRole("article", { name: `Student counselling ${tag}` })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Withdraw" })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("support-directory.png"), fullPage: true });

    await page.goto(at("student", "/settings"));
    await expect(page.locator(".app-shell")).not.toHaveAttribute("data-text", "large");
    await page.getByLabel("Larger text").check();
    await page.getByLabel("Cases and requests").check();
    await page.getByRole("button", { name: "Save preferences" }).click();
    await expect(page.getByRole("status")).toHaveText("Preferences saved.");
    await page.reload();
    await expect(page.locator(".app-shell")).toHaveAttribute("data-text", "large");
    await expect(page.getByLabel("Cases and requests")).toBeChecked();
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe("18px");
    await page.screenshot({ path: testInfo.outputPath("settings-large-text.png"), fullPage: true });
  } finally {
    await db.query("DELETE FROM account_preference WHERE institution_id=$1", [f.institution]);
    await db.query("DELETE FROM support_service WHERE institution_id=$1 AND name LIKE $2", [f.institution, `% ${tag}`]);
    const ids = (await db.query("SELECT id FROM case_record WHERE institution_id=$1 AND kind='letter' AND body LIKE $2", [f.institution, `%Office ${tag}%`])).rows.map(r => r.id);
    await db.query("DELETE FROM notification WHERE institution_id=$1 AND entity_id=ANY($2)", [f.institution, ids]);
    await db.query("DELETE FROM job WHERE institution_id=$1 AND event_id IN (SELECT id FROM audit_event WHERE institution_id=$1 AND entity_id=ANY($2))", [f.institution, ids]);
    await db.query("DELETE FROM case_record WHERE institution_id=$1 AND id=ANY($2)", [f.institution, ids]);
    await db.end();
  }
});
