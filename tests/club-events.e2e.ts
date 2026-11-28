// covers: CL-044, CL-046, CL-028, SL-003, CL-047, DH-020
import "../scripts/environment";
import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { changeClub } from "../lib/clubverse";
import { demoEmail, demoPassword, fixtures as f } from "../scripts/fixtures";

async function signIn(page: Page, person: string) {
  if (await page.getByRole("button", { name: "Sign out", exact: true }).isVisible()) {
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
  }
  await page.goto("/login");
  await page.getByLabel("Email").fill(demoEmail(person));
  await page.getByLabel("Password").fill(demoPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
}
const stamp = (offset: number) => new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Kolkata" })
  .format(new Date(Date.now() + offset)).replace(" ", "T");

test("a full event offers the waitlist, and a seat given up goes to the first person waiting", async ({ page }) => {
  const db = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await db.connect();
  try {
    const user = async (alias: string) => (await db.query('SELECT id FROM "user" WHERE email=$1', [demoEmail(alias)])).rows[0].id as string;
    const founder = { institution: f.institution, account: await user("faculty"), role: "faculty" as const };
    const admin = { institution: f.institution, account: await user("admin"), role: "admin" as const };
    const asha = { institution: f.institution, account: await user("student"), role: "student" as const };
    const tag = randomUUID().slice(0, 6), name = `Drone club ${tag}`;
    const club = await changeClub(founder, { operation: "draft", name, purpose: "Fly.", rules: "Weekly.", category: "technical", joining: "open", audience: "campus" });
    for (const [revision, next, who] of [[0, "submitted", founder], [1, "under_review", admin], [2, "approved", admin]] as const)
      await changeClub(who, { operation: "proposal", id: club, revision, next });
    const event = await changeClub(founder, { operation: "event-draft", club, title: `First flight ${tag}`, location: "Ground", requirements: "None",
      audience: "eligible", capacity: 1, starts: stamp(600000), ends: stamp(4200000) });
    for (const [revision, next, who] of [[0, "pending_approval", founder], [1, "approved", admin], [2, "published", founder], [3, "registration_open", founder]] as const)
      await changeClub(who, { operation: "event-state", club, id: event, revision, next });
    await changeClub(asha, { operation: "register", club, id: event });

    await page.setExtraHTTPHeaders({ "x-forwarded-for": `198.18.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}` });
    const url = (role: string) => `/clubverse/${club}?institution=${f.institution}&role=${role}`;
    await signIn(page, "outsider");
    await page.goto(`/clubverse?institution=${f.institution}&role=student`);
    await page.getByRole("region", { name: "Upcoming events" }).getByRole("link", { name: `First flight ${tag}` }).click();
    await expect(page.getByText("This event is full.")).toBeVisible();
    await page.getByRole("button", { name: "Join the waitlist" }).click();
    await expect(page.getByText("On the waitlist · place 1 of 1")).toBeVisible();

    await signIn(page, "student");
    await page.goto(url("student"));
    await page.getByRole("button", { name: "Give up my seat" }).click();
    await expect(page.getByRole("button", { name: "Join the waitlist" })).toBeVisible();

    await signIn(page, "outsider");
    await page.goto(url("student"));
    await expect(page.getByText("Registered · participation unverified")).toBeVisible();

    // The founder (club lead) posts a notice for everyone eligible; a student who is not a member sees it.
    await signIn(page, "faculty");
    await page.goto(url("faculty"));
    await page.getByText("Post a notice").click();
    await page.getByLabel("Title", { exact: true }).fill("Bring a charged battery");
    await page.getByLabel("Notice", { exact: true }).fill("Flights start at 9 sharp.");
    await page.getByLabel("Who sees it").selectOption("eligible");
    await page.getByLabel("Show until").fill(new Date(Date.now() + 3 * 86400000).toLocaleDateString("sv-SE", { timeZone: "Asia/Kolkata" }));
    await page.getByRole("button", { name: "Post notice" }).click();
    await expect(page.getByRole("region", { name: "Notices" })).toContainText("Bring a charged battery");
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Kolkata" });
    const tasks = page.getByRole("region", { name: "Meeting decisions and tasks" });
    await tasks.getByText("Record a decision").click();
    await tasks.getByLabel("Meeting date").fill(today);
    await tasks.getByLabel("Decision").fill("Charge spare batteries");
    await tasks.getByLabel("Owner").selectOption({ label: "Riya Rao" });
    await tasks.getByLabel("Due").fill(today);
    await tasks.getByRole("button", { name: "Add task" }).click();
    await expect(tasks).toContainText(`Charge spare batteries Riya Rao · due ${today}`);
    await tasks.getByRole("button", { name: "Mark done" }).click();
    await expect(tasks).toContainText(" · done");

    // The office links the club to ECE; the ECE head sees it on their board.
    await signIn(page, "admin");
    await page.goto(url("admin"));
    await page.getByRole("combobox", { name: "Department", exact: true }).selectOption({ label: "Electronics and Communication Engineering" });
    await page.getByRole("button", { name: "Save department link" }).click();
    await expect(page.getByText("Departmental association · Electronics and Communication Engineering")).toBeVisible();
    await signIn(page, "hod");
    await page.goto(`/?institution=${f.institution}&role=hod`);
    await expect(page.getByRole("region", { name: "Department clubs" })).toContainText(name);
    await signIn(page, "outsider");
    await page.goto(url("student"));
    await expect(page.getByRole("region", { name: "Notices" })).toContainText("Flights start at 9 sharp.");
  } finally {
    await db.end(); // the app pool is shared with other tests in this worker; leave it open
  }
});
