// covers: SA-015, AD-009, AD-029, LE-008, LE-010, DH-025
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
const local = (days: number, hour: number) =>
  `${new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(Date.now() + days * 86400000))}T${String(hour).padStart(2, "0")}:00`;

test("the office publishes an internal sitting that the student and invigilator then see", async ({ page }, testInfo) => {
  const db = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await db.connect();
  const [room, title] = [randomUUID(), `CIE ${randomUUID().slice(0, 6)}`];
  try {
    await db.query("INSERT INTO campus_resource (institution_id,id,name,kind,location,capacity) VALUES ($1,$2,$3,'room','Fictional',40)", [f.institution, room, `Hall ${room.slice(0, 6)}`]);
    await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.19.202.71" });
    await signIn(page, "admin");
    await page.goto(`/exams?institution=${f.institution}&role=admin`);
    const form = page.getByRole("region", { name: "Draft a sitting" });
    await form.locator("select[name=offering]").selectOption({ label: "Introduction to Programming · Section A · Term 1" });
    await form.getByLabel("Title").fill(title);
    await form.getByLabel("Starts").fill(local(9, 10));
    await form.getByLabel("Ends").fill(local(9, 11));
    await form.locator("select[name=room]").selectOption({ label: `Hall ${room.slice(0, 6)} · Fictional · 40 seats` });
    await form.locator("select[name=invigilator]").selectOption({ label: "Riya Rao" });
    await form.getByRole("button", { name: "Save draft sitting" }).click();
    const sitting = page.getByRole("article", { name: new RegExp(title) });
    await expect(sitting).toContainText("Draft");
    await sitting.getByRole("button", { name: "Publish sitting" }).click();
    await expect(sitting).toContainText("Published");

    await signIn(page, "faculty");
    await page.goto(`/exams?institution=${f.institution}&role=faculty`);
    await expect(page.getByRole("article", { name: new RegExp(title) })).toContainText("(your duty)");
    await signIn(page, "student");
    await page.goto(`/exams?institution=${f.institution}&role=student`);
    await expect(page.getByRole("article", { name: new RegExp(title) })).toContainText("Invigilator Riya Rao");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.screenshot({ path: testInfo.outputPath("exams-student-390.png"), fullPage: true });
  } finally {
    await db.query("DELETE FROM exam_sitting WHERE institution_id=$1 AND room_id=$2", [f.institution, room]);
    await db.query("DELETE FROM campus_resource WHERE institution_id=$1 AND id=$2", [f.institution, room]);
    await db.end();
  }
});

test("the principal assigns an improvement action and its owner records progress", async ({ page }, testInfo) => {
  const db = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await db.connect();
  const title = `Test action ${randomUUID().slice(0, 6)}`;
  try {
    await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.19.202.72" });
    await signIn(page, "principal");
    await page.goto(`/improvement?institution=${f.institution}&role=principal`);
    await page.getByLabel("Action", { exact: true }).fill(title);
    await page.getByLabel("How success is measured").fill("Every course plan approved before week 2");
    await page.locator("select[name=owner]").selectOption({ label: "Dev Iyer · Department head" });
    await page.getByLabel("Due").fill(local(20, 0).slice(0, 10));
    await page.getByRole("button", { name: "Create action" }).click();
    await expect(page.getByRole("article", { name: title })).toContainText("Owner Dev Iyer");

    await signIn(page, "hod");
    await page.goto(`/improvement?institution=${f.institution}&role=hod`);
    const action = page.getByRole("article", { name: title });
    await action.getByLabel("Progress (%)").fill("60");
    await action.getByLabel("Update").fill("Three of five plans approved");
    await action.getByRole("button", { name: "Record progress" }).click();
    await expect(action.getByText("60%").first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("improvement-hod-1280.png"), fullPage: true });
  } finally {
    await db.query("DELETE FROM improvement_update WHERE action_id IN (SELECT id FROM improvement_action WHERE title=$1)", [title]);
    await db.query("DELETE FROM improvement_action WHERE title=$1", [title]);
    await db.end();
  }
});
