// covers: AD-019, AD-011, AD-012, SL-014, SL-009
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

test("the office delegates the exam cell, issues a certificate that anyone can verify, and a student joins study life", async ({ page, browser }, testInfo) => {
  const tag = randomUUID().slice(0, 6);
  const db = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await db.connect();
  try {
    await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.19.202.121" });
    await signIn(page, "admin");
    await page.goto(at("admin", "/admin"));
    const lend = page.getByRole("region", { name: "Delegated duties" });
    await lend.getByLabel("Staff member").selectOption({ label: "Riya Rao" });
    await lend.getByLabel("Reason").fill(`Exam week ${tag}`);
    await lend.getByRole("button", { name: "Delegate duty" }).click();
    await expect(lend.getByText(/Examination cell · Riya Rao · until .* · active/)).toBeVisible();

    await page.goto(at("admin", "/certificates"));
    await page.locator("select[name=student]").selectOption({ label: "Asha Sen" });
    await page.getByRole("button", { name: "Prepare draft" }).click();
    const cert = page.getByRole("article", { name: "Bonafide (enrollment) for Asha Sen" }).first();
    await expect(cert).toContainText("This is to certify that Asha Sen");
    await cert.getByRole("button", { name: "Issue certificate" }).click();
    await page.getByRole("dialog", { name: "Issue certificate" }).getByRole("button", { name: "Issue" }).click();
    const code = (await cert.getByText(/Verification code/).textContent())!.match(/[0-9A-F]{12}/)![0];

    const visitor = await browser.newPage();
    await visitor.goto(`/verify?code=${code}`);
    await expect(visitor.getByRole("region", { name: "Verification result" })).toContainText("Valid certificate");
    await expect(visitor.getByRole("region", { name: "Verification result" })).toContainText("A. S.");
    await visitor.close();

    await signIn(page, "faculty");
    await page.goto(at("faculty", "/exams"));
    await expect(page.getByRole("region", { name: "Draft a sitting" })).toBeVisible();

    await signIn(page, "student");
    await page.goto(at("student", "/certificates"));
    await expect(page.getByText(code)).toBeVisible();
    await page.goto(at("student", "/groups"));
    await page.getByLabel("Group name").fill(`Night owls ${tag}`);
    await page.getByRole("button", { name: "Create group" }).click();
    await expect(page.getByRole("article", { name: `Night owls ${tag}` })).toContainText("1 of 6");
    await page.goto(at("student", "/profile"));
    await page.getByLabel("About me").fill("Fictional: building a line follower");
    await page.getByLabel("Who can see this").selectOption("teachers");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText("Profile saved.")).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.screenshot({ path: testInfo.outputPath("profile-student-390.png"), fullPage: true });
  } finally {
    await db.query("DELETE FROM delegation WHERE reason=$1", [`Exam week ${tag}`]);
    await db.query(`DELETE FROM certificate k USING "user" u WHERE u.id=k.student_id AND u.email=$1`, [demoEmail("student")]);
    await db.query("DELETE FROM study_group_member WHERE group_id IN (SELECT id FROM study_group WHERE name=$1)", [`Night owls ${tag}`]);
    await db.query("DELETE FROM study_group WHERE name=$1", [`Night owls ${tag}`]);
    await db.query(`DELETE FROM student_profile p USING "user" u WHERE u.id=p.student_id AND u.email=$1`, [demoEmail("student")]);
    await db.end();
  }
});
