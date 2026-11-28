// covers: OP-002, OP-004, OP-014, SP-012
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
// Tomorrow 21:00 in Kolkata: in the future and outside class hours.
const tomorrowNight = `${new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(Date.now() + 86400000))}T21:00`;
const nextWeek = new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(Date.now() + 7 * 86400000));

test("a student requests a supervised lab slot the office approves, and borrows a library book", async ({ page }, testInfo) => {
  const tag = randomUUID().slice(0, 6), lab = randomUUID();
  const db = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await db.connect();
  try {
    await db.query("INSERT INTO campus_resource (institution_id,id,name,kind,location) VALUES ($1,$2,$3,'room','Fictional')", [f.institution, lab, `Lab ${tag}`]);
    await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.19.206.51" });
    await signIn(page, "student");
    await page.goto(at("student", "/facilities"));
    const form = page.getByRole("region", { name: "Request a room or lab" });
    await form.getByLabel("Room or lab").selectOption({ label: `Lab ${tag}` });
    await form.getByLabel("Purpose").fill(`Robot build ${tag}`);
    await form.getByLabel("Supervising teacher").selectOption({ label: "Riya Rao" });
    await form.locator("input[name=start]").fill(tomorrowNight);
    await form.getByRole("button", { name: "Request booking" }).click();
    await expect(page.getByRole("article", { name: `Lab ${tag} · Robot build ${tag}` }).locator(".tag")).toHaveText("Requested");

    await signIn(page, "admin");
    await page.goto(at("admin", "/facilities"));
    const request = page.getByRole("article", { name: `Lab ${tag} · Robot build ${tag}` });
    await expect(request).toContainText("supervised by Riya Rao");
    await request.getByLabel("Reason").fill("Lab assistant on duty");
    await request.getByRole("button", { name: "Record decision" }).click();
    await expect(request.locator(".tag")).toHaveText("Approved");
    await page.getByText("Add a holding").click();
    await page.getByLabel("Title", { exact: true }).fill(`Microelectronics ${tag}`);
    await page.getByLabel("Author", { exact: true }).fill("Fictional Author");
    await page.getByRole("button", { name: "Add to library" }).click();
    await expect(page.getByRole("region", { name: "Library" }).getByRole("status")).toHaveText("Added to the library.");
    await page.goto(at("admin", "/facilities") + `&q=${tag}`);
    await page.getByText("Issue a book or equipment").click();
    await page.getByLabel("Item").selectOption({ label: `Book · Microelectronics ${tag}` });
    await page.getByLabel("Borrower").selectOption({ label: "Asha Sen" });
    await page.getByLabel("Due").fill(nextWeek);
    await page.getByRole("button", { name: "Issue loan" }).click();
    await expect(page.getByRole("article", { name: `Microelectronics ${tag} · Asha Sen` })).toContainText(`Due ${nextWeek}`);

    await signIn(page, "student");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(at("student", "/facilities") + `&q=${tag}`);
    await expect(page.getByRole("article", { name: `Lab ${tag} · Robot build ${tag}` })).toContainText("Office: Lab assistant on duty");
    await expect(page.getByRole("article", { name: `Microelectronics ${tag} · Asha Sen` })).toBeVisible();
    await expect(page.getByText("0 of 1 available")).toBeVisible();
    const check = page.getByRole("form", { name: "Check when a room is free" });
    await check.getByLabel("Check room").selectOption({ label: `Lab ${tag}` });
    await check.getByLabel("On").fill(tomorrowNight.slice(0, 10));
    await check.getByRole("button", { name: "Show taken times" }).click();
    await expect(page.getByRole("status", { name: "Taken times" })).toContainText(/9:00\s?pm – 10:00\s?pm · Booked/i);
    await expect(page.getByRole("status", { name: "Taken times" })).not.toContainText("Robot build");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await page.screenshot({ path: testInfo.outputPath("facilities-student-390.png"), fullPage: true });
  } finally {
    await db.query("DELETE FROM custody_loan WHERE institution_id=$1 AND book_id IN (SELECT id FROM library_item WHERE institution_id=$1 AND title LIKE $2)", [f.institution, `% ${tag}`]);
    await db.query("DELETE FROM library_item WHERE institution_id=$1 AND title LIKE $2", [f.institution, `% ${tag}`]);
    await db.query("DELETE FROM facility_booking WHERE institution_id=$1 AND resource_id=$2", [f.institution, lab]);
    await db.query("DELETE FROM campus_resource WHERE institution_id=$1 AND id=$2", [f.institution, lab]);
    await db.end();
  }
});
