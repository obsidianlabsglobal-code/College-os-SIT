// covers: FC-030
import "../scripts/environment";
import { expect, test } from "@playwright/test";
import { Pool } from "pg";
import { demoEmail, demoPassword, fixtures as f } from "../scripts/fixtures";
import { busDelayFixture } from "./bus-delay-fixture";

test("the teacher sees the bus-delay note on the student's first class, with only the reported time", async ({ page }) => {
  const owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
  const fx = await busDelayFixture(owner);
  try {
    await fx.disrupt();
    await fx.board();
    await page.setExtraHTTPHeaders({ "x-forwarded-for": `198.18.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}` });
    await page.goto("/login");
    await page.getByLabel("Email").fill(demoEmail("faculty"));
    await page.getByLabel("Password").fill(demoPassword);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
    await page.goto(`/timetable?institution=${f.institution}&role=faculty&session=${fx.ids.first}`);
    const note = page.getByRole("region", { name: "Bus delays" });
    await expect(note).toContainText("Asha Sen");
    await expect(note).toContainText("Your attendance mark stands");
    await expect(note).not.toContainText(/traffic|stop|route/i);
    await page.goto(`/timetable?institution=${f.institution}&role=faculty&session=${fx.ids.second}`);
    await expect(page.getByRole("region", { name: "Bus delays" })).toHaveCount(0);
  } finally {
    await fx.clear();
    await owner.end();
  }
});
