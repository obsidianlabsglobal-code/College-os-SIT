import { expect,test } from "@playwright/test";
import { Client } from "pg";
import { demoEmail,demoPassword,fixtures } from "../../scripts/fixtures";

test("student explicitly requests a topic, sees a response and a persistent private usage record",async ({page})=>{
  const db=new Client({connectionString:process.env.MIGRATION_DATABASE_URL});
  await db.connect();
  try {
    await page.setViewportSize({width:390,height:844});
    await page.emulateMedia({reducedMotion:"reduce"});
    await page.goto("/login");
    await page.getByLabel("Email").fill(demoEmail("student"));
    await page.getByLabel("Password").fill(demoPassword);
    await page.getByRole("button",{name:"Sign in"}).click();
    await expect(page.getByRole("button",{name:"Sign out"})).toBeVisible();
    await page.goto(`/aura?institution=${fixtures.institution}&role=student`);
    await page.getByText("Study with Claude",{exact:true}).focus();
    await page.keyboard.press("Enter");
    await page.getByLabel("Study topic").selectOption("pointers");
    await page.getByRole("button",{name:"Generate explanation"}).click();
    await expect(page.getByText("Fixture explanation of pointers.")).toBeVisible();
    await page.reload();
    await expect(page.getByText(/75 input and 100 output tokens/).first()).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
  } finally {
    await db.query("DELETE FROM aura_tutor_usage WHERE institution_id=$1 AND model='browser-fixture'",[fixtures.institution]);
    await db.end();
  }
});
