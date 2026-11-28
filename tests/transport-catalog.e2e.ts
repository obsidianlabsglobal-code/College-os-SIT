// covers: TO-001, TO-002, TO-003, TO-006, TR-001, TR-003, ID-004
import "../scripts/environment";
import {expect,test,type Page} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {Pool} from "pg";
import {demoEmail,demoPassword,fixtures as f} from "../scripts/fixtures";
import {clearTransportFixture,grantFakeTransportOffice} from "./transport-fixture";

async function signIn(page:Page,person:string,role:string,institution=f.institution as string){
  if(await page.getByRole("button",{name:"Sign out"}).isVisible()) await page.getByRole("button",{name:"Sign out"}).click();
  await page.goto("/login");
  await page.getByLabel("Email").fill(demoEmail(person));
  await page.getByLabel("Password").fill(demoPassword);
  await page.getByRole("button",{name:"Sign in"}).click();
  await expect(page.getByRole("button",{name:"Sign out"})).toBeVisible();
  await page.goto(`/transport?institution=${institution}&role=${role}`);
}

test("office sets up a fictional route and stops; student saves an eligible choice at 390 px",async({page},testInfo)=>{
  const owner=new Pool({connectionString:process.env.MIGRATION_DATABASE_URL});
  page.setDefaultTimeout(9000);
  const suffix=randomUUID().slice(0,7),code=`SIM-${suffix}`,name="Fictional Cedar shuttle",bus=`Fictional vehicle ${suffix}`;
  const grant=await grantFakeTransportOffice(owner);
  const card=()=>page.getByRole("region",{name:`${code} · ${name}`,exact:true});
  await page.setViewportSize({width:390,height:844});
  await page.setExtraHTTPHeaders({"x-forwarded-for":"198.19.208.82"});
  try{
    await signIn(page,"replacement","transport");
    await page.getByText("Add a route",{exact:true}).click();
    await page.getByLabel("Route code").fill(code);
    await page.getByLabel("Route name").fill(name);
    await page.getByRole("button",{name:"Create route"}).click();
    await expect(card()).toBeVisible();
    await card().getByText("Publish route stops",{exact:true}).click();
    await card().getByLabel("Stop list").fill("Cedar Depot | 12.25 | 76.62 | 0\nFern Square | 12.255 | 76.61 | 8");
    await card().getByRole("button",{name:"Save ordered stop list"}).click();
    await expect(card()).toContainText("Fern Square");
    await page.getByText("Add a vehicle",{exact:true}).click();
    await page.getByLabel("Vehicle label").fill(bus);
    await page.getByLabel("Seats",{exact:true}).fill("36");
    await page.getByLabel("Permitted capacity").fill("40");
    await page.getByRole("button",{name:"Create vehicle"}).click();
    await expect(page.getByText(`${bus} · 36 seats`)).toBeVisible();
    await card().getByText("Schedule weekly service",{exact:true}).click();
    await card().locator("select[name=vehicle]").selectOption({label:bus});
    await card().getByLabel("Departure (IST)").fill("07:20");
    await card().getByRole("button",{name:"Save weekly service"}).click();
    await expect(card()).toContainText("Monday 07:20 IST");
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
    await signIn(page,"student","student");
    await expect(page.getByRole("heading",{name:"Choose your bus and stop"})).toBeVisible();
    await expect(page.getByRole("region",{name:"Bus setup"})).toBeVisible();
    await expect(page.getByText("Bus alerts",{exact:true})).toHaveCount(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
    await page.screenshot({path:testInfo.outputPath("transport-first-run-picker-390.png"),fullPage:true});
    await card().locator("select[name=stop]").selectOption({label:"Fern Square"});
    await card().getByRole("button",{name:"Save next trip choice"}).click();
    await expect(page.getByRole("region",{name:"Next trip preference"})).toContainText("Fern Square");
    await page.reload();
    await expect(page.getByRole("region",{name:"Next trip preference"})).toContainText("Fern Square");
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
    await page.screenshot({path:testInfo.outputPath("transport-choice-390.png"),fullPage:true});
    await signIn(page,"replacement","transport");
    await card().getByRole("button",{name:"Mark bus full"}).click();
    await expect(card()).toContainText("Full for new riders");
    await signIn(page,"outsider","student");
    await expect(card().getByRole("button",{name:"Save next trip choice"})).toHaveCount(0);
    await signIn(page,"tenant","student",f.otherInstitution);
    await expect(page.getByText(name,{exact:false})).toHaveCount(0);
  } finally {
    await clearTransportFixture(owner,[code],[bus],grant);
    await owner.end();
  }
});
