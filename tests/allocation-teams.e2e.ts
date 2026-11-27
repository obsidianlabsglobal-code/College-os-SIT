// covers: DH-007, DH-004, LE-004, FC-017, FC-018, ID-009
import "../scripts/environment";
import { expect, test, type Page } from "@playwright/test";
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

test("allocation goes from the department head to the office, and teams submit milestone evidence", async ({ page }, testInfo) => {
  const db = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await db.connect();
  const cleanup = async () => {
    await db.query("DELETE FROM milestone_evidence WHERE institution_id=$1 AND offering_id=$2", [f.institution, f.offering]);
    await db.query("DELETE FROM team_milestone WHERE institution_id=$1 AND offering_id=$2", [f.institution, f.offering]);
    await db.query("DELETE FROM team_member WHERE institution_id=$1 AND offering_id=$2", [f.institution, f.offering]);
    await db.query("DELETE FROM project_team WHERE institution_id=$1 AND offering_id=$2", [f.institution, f.offering]);
    await db.query("DELETE FROM allocation_proposal WHERE institution_id=$1 AND offering_id=$2", [f.institution, f.offering]);
    await db.query(`DELETE FROM roster r USING "user" u WHERE u.id=r.account_id AND r.institution_id=$1 AND r.offering_id=$2 AND r.role='faculty' AND u.email=$3`,
      [f.institution, f.offering, demoEmail("replacement")]);
  };
  try {
    await cleanup();
    await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.19.202.81" });
    await signIn(page, "hod");
    const allocation = page.getByRole("region", { name: "Teaching allocation" });
    await allocation.locator("select[name=offering]").selectOption({ label: "Introduction to Programming · Section A · Term 1" });
    await allocation.locator("select[name=faculty]").selectOption({ label: "Rohan Roy" });
    await allocation.getByLabel("Reason").fill("Second lab batch");
    await allocation.getByRole("button", { name: "Propose allocation" }).click();
    await expect(allocation.getByText("Awaiting the office")).toBeVisible();
    await expect(page.getByRole("region", { name: "Schemes and cohorts" })).toContainText("Introduction to Programming");

    await signIn(page, "admin");
    const decisions = page.getByRole("region", { name: "Teaching allocation proposals" });
    await decisions.getByLabel("Decision").selectOption("approve");
    await decisions.getByLabel("Reason").fill("Within workload limits");
    await decisions.getByRole("button", { name: "Record allocation decision" }).click();
    await expect(decisions).toHaveCount(0);

    await signIn(page, "faculty");
    await page.goto(`/courses/${f.offering}?institution=${f.institution}&role=faculty`);
    const teams = page.getByRole("region", { name: "Project teams" });
    await teams.getByText("Form a team").click();
    await teams.getByLabel("Team name").fill("Line follower");
    await teams.getByLabel("Asha Sen").check();
    await teams.getByRole("button", { name: "Form team" }).click();
    await expect(teams.getByRole("article", { name: "Line follower" })).toBeVisible();
    await teams.getByText("Set a milestone").click();
    await teams.getByLabel("Milestone").fill("Prototype demo");
    await teams.locator("input[name=due]").fill(`${new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(Date.now() + 5 * 86400000))}T16:00`);
    await teams.getByRole("button", { name: "Set milestone" }).click();
    await expect(teams.getByText("No evidence yet")).toBeVisible();

    await signIn(page, "student");
    await page.goto(`/courses/${f.offering}?institution=${f.institution}&role=student`);
    const mine = page.getByRole("region", { name: "My project team" });
    await mine.getByLabel("Evidence").fill("Video link to the prototype run");
    await mine.getByRole("button", { name: "Submit evidence for Prototype demo" }).click();
    await expect(mine.getByText(/Awaiting review/)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("team-student-1280.png"), fullPage: true });

    await signIn(page, "principal");
    await expect(page.getByRole("region", { name: "Quality indicators" })).toContainText("Attendance correction rate");
  } finally {
    await cleanup();
    await db.end();
  }
});

test("the office offboards a person after confirming, and the effects are reported", async ({ page }) => {
  const db = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await db.connect();
  const { rows: [{ id }] } = await db.query('SELECT id FROM "user" WHERE email=$1', [demoEmail("outsider")]);
  const memberships = (await db.query("SELECT id FROM membership WHERE institution_id=$1 AND account_id=$2 AND ended_at IS NULL", [f.institution, id])).rows.map(r => r.id);
  const rosters = (await db.query("SELECT offering_id,role FROM roster WHERE institution_id=$1 AND account_id=$2 AND ended_at IS NULL", [f.institution, id])).rows;
  try {
    await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.19.202.82" });
    await signIn(page, "admin");
    await page.goto(`/admin?institution=${f.institution}&role=admin`);
    const section = page.getByRole("region", { name: "Offboard a person" });
    await section.getByLabel("Person to offboard").selectOption({ label: "Neel Das" });
    await section.getByRole("button", { name: "Review offboarding" }).click();
    await page.getByRole("dialog", { name: "Confirm offboarding" }).getByRole("button", { name: "End all access" }).click();
    await expect(section.getByText(/^Access ended: 1 posts, 1 course rosters/)).toBeVisible();
  } finally {
    await db.query("UPDATE membership SET ended_at=NULL WHERE id=ANY($1)", [memberships]);
    for (const r of rosters) await db.query("UPDATE roster SET ended_at=NULL WHERE institution_id=$1 AND offering_id=$2 AND account_id=$3 AND role=$4", [f.institution, r.offering_id, id, r.role]);
    await db.end();
  }
});
