import { expect, test, type Page } from "@playwright/test";
import { demoEmail, demoPassword, fixtures } from "../scripts/fixtures";

async function signIn(page:Page,person:string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(demoEmail(person));
  await page.getByLabel("Password").fill(demoPassword);
  await page.getByRole("button",{name:"Sign in"}).click();
  await expect(page.getByRole("button",{name:"Sign out"})).toBeVisible();
}
const fees=(role:string,institution=fixtures.institution)=>`/fees?institution=${institution}&role=${role}`;
const enabled=process.env.NEXUS_FEES_PREVIEW==="true";
test("fees preview is disabled by default",async ({page})=>{
  test.skip(enabled,"This case covers flag-off behavior");
  expect((await page.goto(fees("student")))?.status()).toBe(404);
});
test("student sees four fictional fee categories and an internally consistent balance",async ({page})=>{
  test.skip(!enabled,"The fictional view must be explicitly enabled");
  await page.setViewportSize({width:390,height:844});
  await signIn(page,"student");
  await page.getByRole("button",{name:"More",exact:true}).click();
  await page.getByRole("dialog").getByRole("link",{name:"Fees & dues"}).click();
  await expect(page.getByRole("heading",{name:"Fees & dues"})).toBeVisible();
  for (const category of ["College fees","Transport fees","Hostel fees","Other fees"]) {
    await expect(page.getByRole("heading",{name:category,exact:true})).toBeVisible();
  }
  await expect(page.getByRole("region",{name:"Fee totals"})).toContainText("14,000");
  await expect(page.getByRole("heading",{name:"Department totals"})).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
});
for (const role of ["hod","admin","principal"] as const) {
  test(`${role} gets aggregate fees and no student breakdown`,async ({page})=>{
    test.skip(!enabled,"The fictional view must be explicitly enabled");
    await signIn(page,role);
    await page.goto(fees(role));
    const summary=page.getByRole("region",{name:"Department totals"});
    await expect(summary.getByRole("heading",{name:"Electronics and Communication Engineering"})).toBeVisible();
    await expect(summary.getByRole("heading",{name:"Mechanical Engineering"})).toHaveCount(role==="hod"?0:1);
    await expect(page.getByRole("heading",{name:"Your fee breakdown"})).toHaveCount(0);
    await expect(page.getByRole("button",{name:/^(Pay now|Record payment|Issue receipt)$/i})).toHaveCount(0);
  });
}
for (const [person,role,inst] of [["faculty","faculty",fixtures.institution],["outsider","student",fixtures.institution],["tenant","student",fixtures.otherInstitution]] as const) {
  test(`${person} cannot open the fictional fee workspace`,async ({page})=>{
    test.skip(!enabled,"The fictional view must be explicitly enabled");
    await signIn(page,person);
    expect((await page.goto(fees(role,inst)))?.status()).toBe(404);
  });
}

test("the fictional fee steward sees a review, not a payment or irreversible action",async ({page})=>{
  test.skip(!enabled,"The fictional view must be explicitly enabled");
  await signIn(page,"admin");
  await page.goto(fees("admin"));
  const review=page.getByRole("region",{name:"Rehearse a reconciliation"});
  await review.getByRole("button",{name:"Review sample payment"}).click();
  await expect(review.getByText(/14,000 before.*10,500 after/)).toBeVisible();
  await review.getByRole("button",{name:"Confirm rehearsal review"}).click();
  await expect(review.getByRole("status")).toContainText("Nothing was posted or saved.");
  await review.getByLabel("Sample case").selectOption("duplicate");
  await review.getByRole("button",{name:"Review sample payment"}).click();
  await expect(review.getByRole("status")).toContainText("already recorded");
  await expect(review.getByRole("button",{name:"Confirm rehearsal review"})).toHaveCount(0);
  await review.getByLabel("Sample case").selectOption("mismatch");
  await review.getByRole("button",{name:"Review sample payment"}).click();
  await expect(review.getByRole("status")).toContainText("not matched");
});

test("sample fee batch separates exceptions and keeps the original allocation after a correction",async ({page})=>{
  test.skip(!enabled,"The fictional view must be explicitly enabled");
  await signIn(page,"admin");
  await page.goto(fees("admin"));
  const batch=page.getByRole("region",{name:"Review a sample fee import"});
  await batch.getByRole("button",{name:"Load sample batch"}).click();
  await expect(batch.getByRole("status")).toHaveText("1 ready for review · 4 need attention");
  await expect(batch.getByText(/no exact roster match/i)).toBeVisible();
  await expect(batch.getByText(/duplicate reference in this batch/i)).toHaveCount(2);
  await batch.getByRole("button",{name:"Apply sample allocation correction"}).click();
  await expect(batch.getByRole("status")).toHaveText("2 ready for review · 3 need attention");
  const row=batch.getByRole("heading",{name:/Row 3 · DEMO-202/}).locator("..");
  await row.getByText("Original allocation and correction history").click();
  await expect(row.getByText(/Original: transport.*3,000/)).toBeVisible();
  await expect(row.getByText(/Correction 1: Fictional source note/)).toBeVisible();
  await expect(row.getByText(/6,500\.00 after/)).toBeVisible();
  await batch.getByRole("button",{name:"Reset sample batch"}).click();
  await expect(batch.getByRole("button",{name:"Load sample batch"})).toBeVisible();
});
