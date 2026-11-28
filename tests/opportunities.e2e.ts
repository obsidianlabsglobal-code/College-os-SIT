// covers: CR-005
import { openWorkflow } from "./workspace-navigation";
import "../scripts/environment";
import { test,expect,type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { demoEmail,demoPassword } from "../scripts/fixtures";

async function login(page:Page,alias:string) {
  const logout=page.getByRole("button",{name:"Sign out"});
  if (await logout.isVisible()) await logout.click();
  await page.goto("/login");
  await page.getByLabel("Email").fill(demoEmail(alias));
  await page.getByLabel("Password").fill(demoPassword);
  await page.getByRole("button",{name:"Sign in"}).click();
  await openWorkflow(page,"Opportunities");
}
test("reviewer publishes and withdraws a listing found by an authorized student",async({page})=>{
  const title="Fictional scholarship "+randomUUID().slice(0,8);
  await page.setExtraHTTPHeaders({"x-forwarded-for":"198.19.145.77"});
  await login(page,"admin");
  await page.getByText("Publish a verified opportunity").click();
  await page.getByLabel("Title",{exact:true}).fill(title);
  await page.getByLabel("Organizer",{exact:true}).fill("Example Foundation");
  await page.getByLabel("Opportunity type").selectOption("scholarship");
  await page.getByLabel("Eligibility and requirements").fill("Applicants enrolled in year one.");
  await page.getByLabel("Official source URL").fill("https://example.org/award");
  await page.getByLabel("Last application day").fill("2099-12-01");
  await page.getByRole("checkbox").check();
  await page.getByRole("button",{name:"Publish listing"}).click();
  await expect(page.getByRole("heading",{name:title})).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  await page.emulateMedia({reducedMotion:"reduce"});
  await login(page,"student");
  await page.getByLabel("Search listings").fill(title);
  await page.getByLabel("Filter by type").selectOption("scholarship");
  await page.getByRole("button",{name:"Filter",exact:true}).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading",{name:title})).toBeVisible();
  await expect(page.getByRole("link",{name:"Official source · example.org"})).toHaveAttribute("href","https://example.org/award");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
  if (process.env.NEXUS_DIRECTORY_SCREENSHOTS) {
    for (const width of [390,1440]) {
      await page.setViewportSize({width,height:900});
      await page.screenshot({path:`${process.env.NEXUS_DIRECTORY_SCREENSHOTS}/directory-${width}.png`,fullPage:true});
    }
  }
  await expect(page.getByText("Withdraw listing")).toHaveCount(0);
  await login(page,"admin");
  const listing=page.getByRole("article").filter({has:page.getByRole("heading",{name:title})});
  await listing.getByText("Withdraw listing").click();
  await listing.getByLabel("Reason").fill("Sponsor cancelled");
  await listing.getByRole("button",{name:"Confirm withdrawal"}).click();
  await expect(listing.getByText(/Withdrawal reason · Sponsor cancelled/)).toBeVisible();
  await login(page,"student");
  await expect(page.getByRole("heading",{name:title})).toHaveCount(0);
});
