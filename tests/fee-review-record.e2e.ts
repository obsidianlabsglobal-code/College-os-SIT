import {expect,test,type Page} from "@playwright/test";
import {demoEmail,demoPassword,fixtures} from "../scripts/fixtures";

const signIn=async(page:Page,alias:string)=>{
  await page.goto("/login");
  await page.getByLabel("Email").fill(demoEmail(alias));
  await page.getByLabel("Password").fill(demoPassword);
  await page.getByRole("button",{name:"Sign in"}).click();
  await expect(page.getByRole("button",{name:"Sign out"})).toBeVisible();
};
const fees=(role:string)=>`/fees?institution=${fixtures.institution}&role=${role}`;
test("saved sample evidence survives reload and a separate reviewer confirms it without posting",async ({page,browser})=>{
  test.skip(process.env.NEXUS_FEES_PREVIEW!=="true","Fictional fee preview must be enabled.");
  await signIn(page,"admin");
  await page.goto(fees("admin"));
  const office=page.getByRole("region",{name:"Fictional review record"});
  await office.getByRole("button",{name:"Submit corrected sample for approval"}).click();
  await expect(office.getByText("Awaiting independent approval")).toBeVisible();
  await page.reload();
  await expect(office.getByText("Awaiting independent approval")).toBeVisible();
  await expect(office.getByRole("button",{name:"Approve fictional review"})).toHaveCount(0);
  const evidence=await office.locator("code").textContent();
  const isolated=await browser.newContext({baseURL:new URL(page.url()).origin});
  try{
    const other=await isolated.newPage();
    await signIn(other,"hod");
    await other.goto(fees("hod"));
    const review=other.getByRole("region",{name:"Fictional review record"});
    await expect(review.locator("code")).toHaveText(evidence!);
    await review.getByText("Original allocation and saved correction").click();
    await expect(review.getByText(/Fictional source note/)).toBeVisible();
    await review.getByRole("button",{name:"Approve fictional review"}).click();
    const dialog=other.getByRole("dialog");
    await dialog.getByRole("button",{name:"Confirm change"}).click();
    await expect(review.getByText("Approved in rehearsal")).toBeVisible();
    await expect(review.getByText(/No ledger entry exists/)).toBeVisible();
    await other.reload();
    await expect(review.getByText("Approved in rehearsal")).toBeVisible();
    await expect(review.getByRole("button",{name:"Approve fictional review"})).toHaveCount(0);
    await page.reload();
    await expect(office.getByText("Approved in rehearsal")).toBeVisible();
  }finally{await isolated.close();}
});
