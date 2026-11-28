// covers: AI-011, AI-017
import "../scripts/environment";
import { expect, test } from "@playwright/test";
import { demoEmail, demoPassword, fixtures as f } from "../scripts/fixtures";

test("a student asks AURA in plain words and gets sourced answers from their own records", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.19.210.91" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await page.getByLabel("Email").fill(demoEmail("student"));
  await page.getByLabel("Password").fill(demoPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await page.goto(`/aura?institution=${f.institution}&role=student`);
  await page.getByRole("link", { name: "Ask AURA a question in plain words" }).click();
  await page.getByRole("textbox", { name: "Question" }).fill("What's due this week and where is my lab?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByRole("region", { name: "Due in the next seven days" })).toContainText("Source: Your published assignments");
  await expect(page.getByRole("region", { name: "Your next classes and rooms" })).toContainText("Source: Your published timetable");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
