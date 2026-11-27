// covers: FC-027, LE-018, SL-016
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
const local = (days: number) => `${new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(Date.now() + days * 86400000))}T09:00`;

test("a department head minutes a meeting with an action, the principal compares a scenario, and students back an issue", async ({ page }, testInfo) => {
  const tag = randomUUID().slice(0, 6);
  const db = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await db.connect();
  try {
    await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.19.202.131" });
    await signIn(page, "hod");
    await page.goto(at("hod", "/meetings"));
    const form = page.getByRole("region", { name: "Schedule a meeting" });
    await form.getByLabel("Title").fill(`Results review ${tag}`);
    await form.locator("input[name=start]").fill(local(-1));
    await form.getByLabel("Agenda").fill("Fictional: pending results");
    await form.getByLabel("Riya Rao").check();
    await form.getByRole("button", { name: "Schedule meeting" }).click();
    const meeting = page.getByRole("article", { name: `Results review ${tag}` });
    await meeting.getByText("Minutes and actions").click();
    await meeting.getByLabel("Minutes").fill("Agreed to publish by Friday.");
    await meeting.getByRole("button", { name: "Save minutes" }).click();
    await expect(meeting.getByText("Agreed to publish by Friday.").first()).toBeVisible();
    await meeting.locator("select[name=owner]").selectOption({ label: "Riya Rao" });
    await meeting.getByLabel("Action").fill("Publish CIE results");
    await meeting.getByLabel("Due").fill(local(3).slice(0, 10));
    await meeting.getByRole("button", { name: "Assign action" }).click();
    await expect(meeting).toContainText("Publish CIE results · Riya Rao");

    await signIn(page, "faculty");
    await page.goto(at("faculty", "/meetings"));
    const mine = page.getByRole("article", { name: `Results review ${tag}` });
    await mine.getByRole("button", { name: "Mark done" }).click();
    await expect(mine).toContainText("· done");

    await signIn(page, "principal");
    await page.goto(at("principal", "/decisions"));
    await page.getByLabel("Proposed minimum (%)").fill("90");
    await page.getByRole("button", { name: "Compare" }).click();
    await expect(page).toHaveURL(/threshold=90/);
    await page.screenshot({ path: testInfo.outputPath("decisions-1280.png"), fullPage: true });

    await signIn(page, "student");
    await page.goto(at("student", "/cases") + "&kind=representation");
    await page.getByLabel("Subject").fill(`Water coolers ${tag}`);
    await page.getByLabel("Details").fill("Fictional: add a cooler on floor 2");
    await page.getByRole("button", { name: "Raise issue" }).click();
    await expect(page.getByRole("article", { name: `Water coolers ${tag}` })).toContainText("0 students support");
    await signIn(page, "outsider");
    await page.goto(at("student", "/cases") + "&kind=representation");
    const issue = page.getByRole("article", { name: `Water coolers ${tag}` });
    await issue.getByRole("button", { name: "Add my support" }).click();
    await expect(issue).toContainText("1 student supports");
  } finally {
    await db.query("DELETE FROM meeting_action WHERE meeting_id IN (SELECT id FROM meeting WHERE title=$1)", [`Results review ${tag}`]);
    await db.query("DELETE FROM meeting_participant WHERE meeting_id IN (SELECT id FROM meeting WHERE title=$1)", [`Results review ${tag}`]);
    await db.query("DELETE FROM meeting WHERE title=$1", [`Results review ${tag}`]);
    const ids = (await db.query("SELECT id FROM case_record WHERE title=$1", [`Water coolers ${tag}`])).rows.map(r => r.id);
    await db.query("DELETE FROM case_support WHERE case_id=ANY($1)", [ids]);
    await db.query("DELETE FROM notification WHERE entity_id=ANY($1)", [ids]);
    await db.query("DELETE FROM job WHERE event_id IN (SELECT id FROM audit_event WHERE entity_id=ANY($1))", [ids]);
    await db.query("DELETE FROM case_record WHERE id=ANY($1)", [ids]);
    await db.end();
  }
});
