// covers: AI-001, AI-003
import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { demoEmail, demoPassword, fixtures } from "../scripts/fixtures";

// Runs against the server's real configuration. In local development and CI no model credential is configured,
// so these tests cover the zero-model direct path and the honest "unavailable" fallback, not model inference.

const started = new Date();

test.beforeEach(async ({ page }) => {
  const bytes = Buffer.from(randomUUID().replaceAll("-", ""), "hex");
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `198.${18 + bytes[0] % 2}.${bytes[1]}.${bytes[2]}` });
});

test.afterAll(async () => {
  await import("../scripts/environment");
  const { Pool } = await import("pg");
  const url=process.env.MIGRATION_DATABASE_URL;
  if (!url || !["localhost","127.0.0.1"].includes(new URL(url).hostname)) throw Error("Use a local test database.");
  const owner = new Pool({ connectionString:url });
  try {
    await owner.query(
      `DELETE FROM aura_request WHERE created_at >= $1 AND actor_id IN (SELECT id FROM "user" WHERE email = ANY($2))
       AND NOT EXISTS (SELECT 1 FROM aura_model_call c WHERE c.request_id=aura_request.id)`,
      [started, [demoEmail("student"), demoEmail("faculty")]],
    );
  } finally {
    await owner.end();
  }
});

async function signIn(page: Page, persona: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(demoEmail(persona));
  await page.getByLabel("Password").fill(demoPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

const workspace = (role: string) => `institution=${fixtures.institution}&role=${role}`;

test("a student asks AURA from a phone keyboard and gets a direct database answer with no model call", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, "student");
  await page.goto(`/aura?${workspace("student")}`);
  await expect(page.getByRole("heading", { name: "AURA", exact: true })).toBeVisible();
  await expect(page.getByText(/Model assistance is turned off|No model provider credential/).first()).toBeVisible();

  const box = page.getByLabel("Ask AURA");
  await box.focus();
  await page.keyboard.type("my assignments");
  await page.keyboard.press("Enter");
  const card = page.getByRole("listitem", { name: "Request: my assignments" }).first();
  await expect(card).toBeVisible();
  await expect(card.getByText("Direct system action")).toBeVisible();
  await expect(card.getByRole("list", { name: "Task progress" }).getByRole("listitem")).toHaveText(["Understood", "Checked records", "Answered"]);
  await expect(card.getByText("I checked the database")).toBeVisible();
  await expect(card.getByText("Model calls 0 · Tool operations 1")).toBeVisible();
  await expect(card.getByText(/^Source: Assignments in your active course rosters/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  if (process.env.NEXUS_AURA_SCREENSHOTS) {
    for (const width of [390,1440]) {
      await page.setViewportSize({width,height:900});
      await page.screenshot({path:`${process.env.NEXUS_AURA_SCREENSHOTS}/assistant-${width}.png`,fullPage:true});
    }
  }
  const message = `Help me plan a robotics workshop next Friday for 60 students ${randomUUID().slice(0, 6)}`;
  await box.fill(message);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  const planning = page.getByRole("listitem", { name: `Request: ${message}` });
  await expect(planning.getByText("Model assistance unavailable")).toBeVisible();
  await expect(planning.getByText("I could not complete this")).toBeVisible();
  await expect(planning.getByText(/You can still plan an event without model assistance/)).toBeVisible();
  await expect(planning.getByText("Model calls 0 · Tool operations 0")).toBeVisible();
});

test("faculty use a suggestion to read their evaluation queue, and the empty request is refused", async ({ page }) => {
  await signIn(page, "faculty");
  await page.goto(`/aura?${workspace("faculty")}`);
  await page.getByRole("button", { name: "Pending grading" }).click();
  const card = page.getByRole("listitem", { name: "Request: Pending grading" }).first();
  await expect(card.getByText("Direct system action")).toBeVisible();
  await expect(card.getByRole("link", { name: "Awaiting evaluation" })).toBeVisible();
  await expect(page.getByLabel("Ask AURA")).toHaveAttribute("required", "");
  await expect(page.getByText("Needs confirmation")).toBeVisible();
});

test("roles without AURA and other tenants are refused", async ({ page }) => {
  await signIn(page, "admin");
  const response = await page.goto(`/aura?${workspace("admin")}`);
  expect(response?.status()).toBe(404);
  const other = await page.goto(`/aura?institution=${fixtures.otherInstitution}&role=student`);
  expect(other?.status()).toBe(404);
});
