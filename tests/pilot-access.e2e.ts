// covers: ID-012, AD-002, ID-009
import "../scripts/environment";
import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { Client } from "pg";
import { demoEmail, demoPassword, fixtures as f } from "../scripts/fixtures";

const at = (role: string, path: string) => `${path}?institution=${f.institution}&role=${role}`;

test("the office imports a teacher, a new student joins by email code, the teacher approves, and the student accepts the notice", async ({ page }, testInfo) => {
  const tag = randomUUID().slice(0, 6);
  const teacherEmail = `teacher-${tag}@nexus.example.invalid`, studentEmail = `student-${tag}@nexus.example.invalid`;
  const db = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await db.connect();
  const sent = async (email: string) => (await db.query("SELECT count(*)::int AS n FROM dev_mailbox WHERE to_email=$1", [email])).rows[0].n as number;
  const latestCode = async (email: string, before = 0) => {
    await expect.poll(() => sent(email)).toBeGreaterThan(before);
    return (await db.query("SELECT body FROM dev_mailbox WHERE to_email=$1 ORDER BY id DESC LIMIT 1", [email])).rows[0].body.match(/\b(\d{6})\b/)[1] as string;
  };
  const codeSignIn = async (email: string) => {
    if (await page.getByRole("button", { name: "Sign out" }).isVisible()) {
      await page.getByRole("button", { name: "Sign out" }).click();
      await expect(page).toHaveURL(/\/login$/);
    }
    await page.goto("/login/code");
    await page.getByLabel("Email").fill(email);
    const before = await sent(email);
    await page.getByRole("button", { name: "Email me a code" }).click();
    await page.getByLabel("6-digit code").fill(await latestCode(email, before));
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).not.toHaveURL(/\/login/);
  };
  try {
    await page.setExtraHTTPHeaders({ "x-forwarded-for": `198.18.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}` });
    await page.goto("/login");
    await page.getByLabel("Email").fill(demoEmail("admin"));
    await page.getByLabel("Password").fill(demoPassword);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await page.goto(at("admin", "/admin/roster-import"));
    await page.getByLabel("Or paste the CSV").fill(`name,email,phone,department,teaches,mentor_of\nAnita Rao ${tag},${teacherEmail},+91 98450 00002,Electronics and Communication Engineering,Introduction to Programming / Section B,Section B`);
    await page.getByRole("button", { name: "Check the sheet" }).click();
    await expect(page.getByRole("heading", { name: "1 rows ready" })).toBeVisible();
    await page.getByRole("button", { name: "Add 1 teachers" }).click();
    await expect(page.getByRole("heading", { name: "Imported" })).toBeVisible();

    // A new student opens the college's join link, signs in with a code, and asks to join Section B.
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto(`/join/student?institution=${f.institution}`);
    await expect(page).toHaveURL(/\/login\/code\?next=/);
    await page.getByLabel("Email").fill(studentEmail);
    await page.getByRole("button", { name: "Email me a code" }).click();
    await page.getByLabel("6-digit code").fill(await latestCode(studentEmail));
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "Join as a student" })).toBeVisible();
    await page.getByLabel("Full name").fill(`Meera Iyer ${tag}`);
    await page.getByLabel("USN").fill(`4SI${tag}`.toUpperCase());
    await page.getByLabel("Semester").fill("3");
    await page.getByLabel("Section").selectOption({ label: "Section B · Electronics and Communication Engineering · Term 1" });
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByText("Waiting for your class mentor or a teacher of your section")).toBeVisible();
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "No workspace yet" })).toBeVisible();
    await expect(page.getByText("Waiting for your teacher's approval")).toBeVisible();

    // The imported teacher signs in with a code and approves.
    await codeSignIn(teacherEmail);
    await page.goto(at("faculty", "/approvals/students"));
    await page.getByLabel(new RegExp(`Meera Iyer ${tag}`)).first().check();
    await page.getByRole("button", { name: "Approve selected" }).click();
    await expect(page.getByRole("region", { name: "Decided in the last 30 days" })).toContainText(`Meera Iyer ${tag} · ${`4SI${tag}`.toUpperCase()} · Section B · Approved`);

    // The office requires the privacy notice; the student must accept it before the workspace opens.
    await db.query("UPDATE institution SET consent_required=true WHERE id=$1", [f.institution]);
    await codeSignIn(studentEmail);
    await expect(page.getByRole("heading", { name: "How NEXUS uses your information" })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await page.screenshot({ path: testInfo.outputPath("privacy-notice-390.png"), fullPage: true });
    await page.getByRole("button", { name: "I have read this and agree" }).click();
    await expect(page.getByRole("heading", { name: /Good to see you|Welcome back/ })).toBeVisible();
    // Same switch as the app shell: once the transport page is built, home points to it.
    if (existsSync("app/transport/page.tsx")) await expect(page.getByRole("link", { name: "Pick my route and stop" })).toHaveAttribute("href", /\/transport\?/);
    else await expect(page.getByRole("heading", { name: "Pick your bus stop (coming soon)" })).toBeVisible();
  } finally {
    await db.query("UPDATE institution SET consent_required=false WHERE id=$1", [f.institution]);
    await db.end();
  }
});
