// covers: FC-025, DH-016, DH-017, LE-012, LE-015, LE-005, AD-008
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

test("a teacher's development record and research proposal are decided by the HOD and reach the principal", async ({ page }, testInfo) => {
  const tag = randomUUID().slice(0, 6);
  const db = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await db.connect();
  try {
    await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.19.202.101" });
    await signIn(page, "faculty");
    await page.goto(at("faculty", "/growth"));
    const dev = page.getByRole("region", { name: "Professional development" });
    await dev.getByText("Record an activity").click();
    await dev.getByLabel("Activity").fill(`Pedagogy workshop ${tag}`);
    await dev.getByLabel("Completed on").fill(new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date()));
    await dev.getByLabel("Hours").fill("4");
    await dev.getByLabel("Evidence").fill("Fictional certificate");
    await dev.getByRole("button", { name: "Send for verification" }).click();
    await expect(dev.getByRole("article", { name: `Pedagogy workshop ${tag}` })).toContainText("Awaiting verification");
    const research = page.getByRole("region", { name: "Research projects" });
    await research.getByText("Propose a project").click();
    await research.getByLabel("Title").fill(`Solar metering ${tag}`);
    await research.getByLabel("Summary").fill("Fictional study of rooftop generation.");
    await research.getByRole("button", { name: "Send proposal" }).click();
    await expect(research.getByRole("article", { name: `Solar metering ${tag}` })).toContainText("Awaiting approval");

    await signIn(page, "hod");
    await page.goto(at("hod", "/growth"));
    const record = page.getByRole("article", { name: `Pedagogy workshop ${tag}` });
    await record.getByLabel("Decision").selectOption("verify");
    await record.getByLabel("Reason").fill("Certificate seen");
    await record.getByRole("button", { name: "Record verification" }).click();
    await expect(record).toContainText("Verified");
    const project = page.getByRole("article", { name: `Solar metering ${tag}` });
    await project.getByLabel("Decision").selectOption("approve");
    await project.getByLabel("Disclosure").selectOption("institution");
    await project.getByLabel("Reason").fill("Fits the department plan");
    await project.getByRole("button", { name: "Record project decision" }).click();
    await expect(project).toContainText("Approved");

    await signIn(page, "principal");
    await expect(page.getByRole("region", { name: "Campus operations" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Room use · next 7 days" })).toBeVisible();
    await page.goto(at("principal", "/growth"));
    await expect(page.getByRole("article", { name: `Solar metering ${tag}` })).toContainText("Disclosed to the institution");
    await page.screenshot({ path: testInfo.outputPath("principal-research-1280.png"), fullPage: true });
  } finally {
    await db.query("DELETE FROM development_record WHERE title=$1", [`Pedagogy workshop ${tag}`]);
    await db.query("DELETE FROM research_project WHERE title=$1", [`Solar metering ${tag}`]);
    await db.end();
  }
});

test("the office corrects a section name and the history keeps the previous name", async ({ page }) => {
  const db = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await db.connect();
  const { rows: [section] } = await db.query("SELECT name FROM section WHERE institution_id=$1 AND id=$2", [f.institution, f.otherSection]);
  try {
    await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.19.202.102" });
    await signIn(page, "admin");
    await page.goto(at("admin", "/admin"));
    const form = page.getByRole("region", { name: "Correct a course or section name" });
    await form.locator("select[name=target]").selectOption({ label: `Section · ${section.name}` });
    await form.getByLabel("Corrected name").fill(`${section.name} (evening)`);
    await form.getByLabel("Reason").fill("Matches the published timetable");
    await form.getByRole("button", { name: "Save correction" }).click();
    await expect(form.getByText(`section: ${section.name} → ${section.name} (evening) · Matches the published timetable · Mira Bose`)).toBeVisible();
  } finally {
    await db.query("UPDATE section SET name=$3 WHERE institution_id=$1 AND id=$2", [f.institution, f.otherSection, section.name]);
    await db.query("DELETE FROM catalog_name_change WHERE institution_id=$1 AND entity_id=$2", [f.institution, f.otherSection]);
    await db.end();
  }
});
