import {expect, type Page} from "@playwright/test";

export async function openWorkflow(page:Page, name:string | RegExp) {
  const nav = page.getByRole("navigation",{name:"Campus workflows"});
  await expect(nav).toBeVisible();
  const primary = nav.getByRole("link",{name,exact:true});
  if (await primary.isVisible()) {
    await primary.click();
    return;
  }
  await nav.getByRole("button",{name:"More",exact:true}).click();
  await page.getByRole("dialog").getByRole("link",{name,exact:true}).click();
}
