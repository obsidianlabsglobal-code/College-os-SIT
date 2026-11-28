import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { demoEmail, demoPassword, fixtures } from "../scripts/fixtures";

test("join and fictional approval are preview-only", async ({page}) => {
  const enabled=process.env.NEXUS_ONBOARDING_PREVIEW==="true";
  // /join/student is the real sign-up (cc/pilot-access): it asks a signed-out visitor to sign in by email code first.
  await page.goto("/join/student");
  await expect(page).toHaveURL(/\/login\/code\?next=/);
  const join=await page.goto("/join/faculty");
  if (!enabled) {
    expect(join?.status()).toBe(404);
    return;
  }
  await expect(page.getByRole("heading",{name:"Join NEXUS as faculty"})).toBeVisible();
  await expect(page.getByText("This QR page does not give you access.")).toBeVisible();
  await expect(page.locator("input")).toHaveCount(0);
  expect((await page.goto("/join/principal"))?.status()).toBe(404);
  await page.goto("/login");
  await page.getByLabel("Email").fill(demoEmail("admin"));
  await page.getByLabel("Password").fill(demoPassword);
  await page.getByRole("button",{name:"Sign in",exact:true}).click();
  await page.waitForURL(url=>url.pathname==="/");
  await page.goto(`/admin?institution=${fixtures.institution}&role=admin`);
  const area=page.getByRole("heading",{name:"Student admissions preview"}).locator("..");
  await expect(area).toBeVisible();
  const email=demoEmail("browser-"+randomUUID());
  await area.getByLabel("Fictional student email").fill(email);
  await area.getByLabel("Admission section").selectOption(fixtures.section);
  await area.getByLabel("Admission term").selectOption(fixtures.term);
  await area.getByRole("button",{name:"Save fictional approval"}).click();
  await expect(area.getByRole("status")).toHaveText("Fictional approval saved.");
  await page.reload();
  const row=area.getByRole("listitem").filter({hasText:email});
  await row.getByRole("button",{name:"Revoke approval"}).click();
  await page.getByRole("dialog").getByRole("button",{name:"Confirm change"}).click();
  await expect(row.getByText("Revoked",{exact:true})).toBeVisible();
});
