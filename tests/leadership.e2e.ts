// covers: DH-002, DH-003, DH-006, LE-002, LE-009
import "../scripts/environment";
import { expect, test, type Page } from "@playwright/test";
import { demoEmail, demoPassword } from "../scripts/fixtures";

async function signIn(page: Page, person: string) {
  if (await page.getByRole("button", { name: "Sign out" }).isVisible()) await page.getByRole("button", { name: "Sign out" }).click();
  await page.goto("/login");
  await page.getByLabel("Email").fill(demoEmail(person));
  await page.getByLabel("Password").fill(demoPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

test("HOD and principal boards show responsibilities, rosters and department comparison", async ({ page }, testInfo) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.19.201.14" });
  await signIn(page, "hod");
  await expect(page.getByText("Department focus", { exact: true })).toBeVisible();
  const faculty = page.getByRole("region", { name: "Faculty responsibilities" });
  const riya = faculty.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Riya Rao" }) });
  await expect(riya.getByText(/Introduction to Programming/)).toBeVisible();
  await expect(riya.getByText("Awaiting evaluation")).toBeVisible();
  const sections = page.getByRole("region", { name: "Sections and attendance" });
  const roster = sections.getByText(/^Roster · \d+ students?$/).first();
  await roster.click();
  await expect(sections.getByText("Asha Sen", { exact: true }).first()).toBeVisible();
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.screenshot({ path: testInfo.outputPath(`hod-${width}.png`), fullPage: true });
  }

  await signIn(page, "principal");
  await expect(page.getByRole("heading", { name: "Institution activity" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Escalated requests and decisions" })).toBeVisible();
  const compare = page.getByRole("region", { name: "Department comparison" });
  await expect(compare.getByRole("row", { name: /Electronics and Communication Engineering/ })).toBeVisible();
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.screenshot({ path: testInfo.outputPath(`principal-${width}.png`), fullPage: true });
  }

  await signIn(page, "faculty");
  await expect(page.getByLabel("Your workload")).toContainText(/Workload · \d+ sections? · /);
  await expect(page.getByRole("heading", { name: "Teaching priorities" })).toHaveCount(1);
});
