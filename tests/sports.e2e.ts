// covers: SP-003, SP-004, SP-005, SP-007, SP-010, SP-011
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
// Yesterday 22:00 in Kolkata: in the past, so the official can record, and outside class hours.
const lastNight = `${new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(Date.now() - 86400000))}T22:00`;

test("the office sets up a league, a coach selects a student, the official records the result, and the student sees the standings", async ({ page }, testInfo) => {
  const tag = randomUUID().slice(0, 6);
  const sport = `Kabaddi ${tag}`, venue = randomUUID();
  const db = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await db.connect();
  try {
    await db.query("INSERT INTO campus_resource (institution_id,id,name,kind,location) VALUES ($1,$2,$3,'room','Fictional')", [f.institution, venue, `Arena ${tag}`]);
    await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.19.204.17" });
    await signIn(page, "admin");
    await page.goto(at("admin", "/sports"));
    const office = page.getByRole("region", { name: "Sports office" });
    await office.getByText("New tournament").click();
    await office.getByLabel("Tournament name").fill(`League ${tag}`);
    await office.getByLabel("Sport", { exact: true }).fill(sport);
    await office.getByLabel("Starts").first().fill("2026-11-01");
    await office.getByLabel("Ends").fill("2027-01-31");
    await office.getByRole("button", { name: "Create tournament" }).click();
    await expect(office.getByRole("status").first()).toHaveText("Tournament created.");
    for (const name of [`ECE ${tag}`, `ECE B ${tag}`]) {
      await page.goto(at("admin", "/sports"));
      await office.getByText("New team or external opponent").click();
      await office.getByLabel("Team name").fill(name);
      await office.getByLabel("Team sport").fill(sport);
      await office.getByLabel("Department (department teams only)").selectOption({ label: "Electronics and Communication Engineering" });
      await office.getByRole("button", { name: "Create team" }).click();
      await expect(page.getByRole("article", { name: name })).toBeVisible();
    }
    for (const name of [`ECE ${tag}`, `ECE B ${tag}`]) {
      await page.goto(at("admin", "/sports"));
      await office.getByText("Enter a team in a tournament").click();
      await office.locator("select[name=tournament]").first().selectOption({ label: `League ${tag}` });
      await office.locator("select[name=team]").selectOption({ label: `${name} · ${sport}` });
      await office.getByRole("button", { name: "Enter team" }).click();
      await expect(office.getByRole("status").first()).toHaveText("Team entered.");
    }
    const ece = page.getByRole("article", { name: `ECE ${tag}`, exact: true });
    await ece.getByLabel("Coach").selectOption({ label: "Riya Rao" });
    await ece.getByRole("button", { name: "Assign coach" }).click();
    await expect(ece).toContainText("Coach: Riya Rao");

    await signIn(page, "faculty");
    await page.goto(at("faculty", "/sports"));
    await page.getByRole("article", { name: `ECE ${tag}`, exact: true }).getByRole("button", { name: "Open trials" }).click();
    await expect(page.getByRole("article", { name: `ECE ${tag}`, exact: true })).toContainText("Trials open");

    await signIn(page, "student");
    await page.goto(at("student", "/sports"));
    await page.getByRole("article", { name: `ECE ${tag}`, exact: true }).getByRole("button", { name: "Request a trial" }).click();
    await expect(page.getByRole("article", { name: `ECE ${tag}`, exact: true })).toContainText("Trial requested");

    await signIn(page, "faculty");
    await page.goto(at("faculty", "/sports"));
    const team = page.getByRole("article", { name: `ECE ${tag}`, exact: true });
    await team.getByText("Decide trial: Asha Sen").click();
    await team.getByLabel("Reason").fill("Quick raider");
    await team.getByRole("button", { name: "Record decision" }).click();
    await expect(team).toContainText("Squad: Asha Sen");

    await signIn(page, "admin");
    await page.goto(at("admin", "/sports"));
    await office.getByText("Schedule a fixture").click();
    await office.locator("select[name=tournament]").last().selectOption({ label: `League ${tag}` });
    await office.getByLabel("Home team").selectOption({ label: `ECE ${tag}` });
    await office.getByLabel("Away team").selectOption({ label: `ECE B ${tag}` });
    await office.getByLabel("Venue").selectOption({ label: `Arena ${tag}` });
    await office.getByLabel("Official").selectOption({ label: "Riya Rao" });
    await office.locator("input[name=start]").fill(lastNight);
    await office.getByRole("button", { name: "Schedule fixture" }).click();
    await expect(page.getByRole("article", { name: `ECE ${tag} v ECE B ${tag}` })).toContainText("Scheduled");

    await signIn(page, "faculty");
    await page.goto(at("faculty", "/sports"));
    const match = page.getByRole("article", { name: `ECE ${tag} v ECE B ${tag}` });
    await match.getByText("Record result").first().click();
    await match.getByLabel(`ECE ${tag} score`).fill("31");
    await match.getByLabel(`ECE B ${tag} score`).fill("27");
    await match.getByRole("button", { name: "Record result" }).click();
    await expect(match.locator(".tag")).toHaveText("31–27");

    await signIn(page, "student");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(at("student", "/sports"));
    await expect(page.getByRole("article", { name: `ECE ${tag}`, exact: true })).toContainText("Selected · Quick raider");
    const standings = page.getByRole("table", { name: `Standings for League ${tag}` });
    await expect(standings.getByRole("row", { name: new RegExp(`^ECE ${tag} 1 1 0 0 31 27 3$`) })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await page.screenshot({ path: testInfo.outputPath("sports-student-390.png"), fullPage: true });
  } finally {
    const teams = (await db.query("SELECT id FROM sport_team WHERE institution_id=$1 AND sport=$2", [f.institution, sport])).rows.map(r => r.id);
    await db.query("DELETE FROM sport_fixture WHERE institution_id=$1 AND home_team_id=ANY($2)", [f.institution, teams]);
    for (const table of ["team_player", "tournament_entry"]) await db.query(`DELETE FROM ${table} WHERE institution_id=$1 AND team_id=ANY($2)`, [f.institution, teams]);
    await db.query("DELETE FROM sport_team WHERE institution_id=$1 AND id=ANY($2)", [f.institution, teams]);
    await db.query("DELETE FROM sport_tournament WHERE institution_id=$1 AND sport=$2", [f.institution, sport]);
    await db.query("DELETE FROM campus_resource WHERE institution_id=$1 AND id=$2", [f.institution, venue]);
    await db.end();
  }
});
