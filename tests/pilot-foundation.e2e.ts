// covers: TR-025, TO-012
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

test("a student reports a transport incident the transport office resolves, and the office switches a department", async ({ page }, testInfo) => {
  const tag = randomUUID().slice(0, 6);
  const db = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await db.connect();
  try {
    // Rohan Roy (fictional) also works in the transport office for this test.
    await db.query(`INSERT INTO membership (institution_id,account_id,role) SELECT $1,id,'transport' FROM "user" WHERE email=$2 ON CONFLICT DO NOTHING`,
      [f.institution, demoEmail("replacement")]);
    await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.19.208.71" });
    await signIn(page, "student");
    await page.goto(at("student", "/cases") + "&kind=transport_incident");
    await page.getByLabel("Subject").fill(`Bus 3 skipped Hebbal ${tag}`);
    await page.getByLabel("Details").fill("Fictional: the bus did not stop.");
    await page.getByRole("button", { name: "Send report" }).click();
    await expect(page.getByRole("article", { name: `Bus 3 skipped Hebbal ${tag}` })).toContainText("Open");

    await signIn(page, "replacement");
    await page.goto(at("transport", "/"));
    await expect(page.getByRole("heading", { name: "Transport office" })).toBeVisible();
    await expect(page.getByRole("navigation").getByRole("link", { name: "Cases" }).first()).toBeVisible();
    await page.goto(at("transport", "/cases") + "&kind=transport_incident");
    const report = page.getByRole("article", { name: `Bus 3 skipped Hebbal ${tag}` });
    await report.getByLabel("Owner").selectOption({ label: "Rohan Roy" });
    await report.getByRole("button", { name: "Assign" }).click();
    await expect(report).toContainText("Owner Rohan Roy");
    await report.getByText("Close this case").click();
    await report.getByLabel("Reason").fill("Driver briefed about the stop.");
    await report.getByRole("button", { name: "Record outcome" }).click();
    await expect(report).toContainText("Driver briefed about the stop.");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await page.screenshot({ path: testInfo.outputPath("transport-office-390.png"), fullPage: true });

    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page, "admin");
    await page.goto(at("admin", "/admin"));
    const switches = page.getByRole("region", { name: "Departments switched on" });
    const mech = switches.getByRole("listitem").filter({ hasText: "Mechanical Engineering" });
    await mech.getByLabel("Reason").fill(`Pilot starts with ECE ${tag}`);
    await mech.getByRole("button", { name: "Switch off" }).click();
    await expect(mech).toContainText("Mechanical Engineering · Off");
  } finally {
    await db.query("UPDATE department SET active=true WHERE institution_id=$1", [f.institution]);
    const ids = (await db.query("SELECT id FROM case_record WHERE institution_id=$1 AND title LIKE $2", [f.institution, `% ${tag}`])).rows.map(r => r.id);
    await db.query("DELETE FROM notification WHERE institution_id=$1 AND entity_id=ANY($2)", [f.institution, ids]);
    await db.query("DELETE FROM job WHERE institution_id=$1 AND event_id IN (SELECT id FROM audit_event WHERE institution_id=$1 AND entity_id=ANY($2))", [f.institution, ids]);
    await db.query("DELETE FROM case_record WHERE institution_id=$1 AND id=ANY($2)", [f.institution, ids]);
    await db.query(`DELETE FROM membership WHERE institution_id=$1 AND role='transport' AND account_id=(SELECT id FROM "user" WHERE email=$2)`, [f.institution, demoEmail("replacement")]);
    await db.end();
  }
});
