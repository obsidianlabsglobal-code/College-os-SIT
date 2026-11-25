import { openWorkflow } from "./workspace-navigation";
import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { demoEmail, demoPassword } from "../scripts/fixtures";

test("a club organizer requests a room and sees the custodian confirmation after reload",async ({page}) => {
  const suffix = randomUUID().slice(0,6);
  const club = `Venue club ${suffix}`;
  const room = `Seminar room ${suffix}`;
  await page.setExtraHTTPHeaders({"x-forwarded-for":"198.19.128.101"});
  const button = (name:string)=>page.getByRole("button",{name,exact:true});
  const link = (name:string)=>page.getByRole("link",{name,exact:true});
  async function login(as:string) {
    if (await button("Sign out").isVisible()) {
      await button("Sign out").click();
      await expect(page.getByRole("heading",{name:"Sign in"})).toBeVisible();
    }
    await page.goto("/login");
    await page.getByLabel("Email").fill(demoEmail(as));
    await page.getByLabel("Password").fill(demoPassword);
    await button("Sign in").click();
    await expect(button("Sign out")).toBeVisible();
    await openWorkflow(page,"CLUBVERSE");
  }
  await login("faculty");
  await page.getByLabel("Club name").fill(club);
  await page.getByLabel("Purpose",{exact:true}).fill("Demonstrate booking a venue.");
  await page.getByLabel(/Membership rules/).fill("Open workshops.");
  await button("Save club draft").click();
  const proposal = page.getByRole("article").filter({hasText:club});
  await proposal.getByRole("button",{name:"Submit proposal"}).click();

  await login("admin");
  await proposal.getByRole("button",{name:"Start review"}).click();
  await proposal.getByRole("button",{name:"Record decision"}).click();
  await expect(link(club)).toBeVisible();
  await link("Resource bookings").click();
  await page.getByLabel("Resource name").fill(room);
  await page.getByLabel("Location",{exact:true}).fill("Engineering block");
  await button("Add resource").click();
  await page.getByRole("combobox",{name:"Resource",exact:true}).selectOption({label:`${room} · Engineering block`});
  await page.getByRole("combobox",{name:"Custodian",exact:true}).selectOption({label:"Mira Bose"});
  await page.getByLabel("Access duration in days").fill("14");
  await button("Grant custodian access").click();
  await expect(page.getByText(new RegExp(`${room} · Mira Bose`))).toBeVisible();

  await page.setViewportSize({width:390,height:844});
  await login("faculty");
  await link(club).click();
  await page.getByLabel("Event title").fill(`Workshop ${suffix}`);
  await page.getByLabel("Location").fill("Engineering block");
  const stamp = (hours:number)=>new Intl.DateTimeFormat("sv-SE",{
    dateStyle:"short",timeStyle:"short",timeZone:"Asia/Kolkata",
  }).format(new Date(Date.now()+hours*3600000)).replace(" ","T");
  await page.getByLabel(/Starts/).fill(stamp(24));
  await page.getByLabel(/Ends/).fill(stamp(25));
  await page.getByLabel("Capacity",{exact:true}).fill("20");
  await page.getByLabel("Requirements and event plan").fill("Chairs");
  await button("Save event draft").click();
  await link("Manage booking").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading",{name:"Event booking"})).toBeVisible();
  await page.getByRole("listitem").filter({hasText:room}).getByRole("button",{name:"Request resource"}).click();
  await expect(page.getByText("Awaiting custodian decision",{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
  const detail = page.url();

  await login("admin");
  await link("Resource bookings").click();
  const record = page.getByRole("article").filter({hasText:room});
  await record.getByRole("button",{name:"Confirm booking"}).click();
  await expect(record.getByText("Confirmed",{exact:true})).toBeVisible();
  await login("faculty");
  await page.goto(detail);
  await page.reload();
  await expect(page.getByRole("article").filter({hasText:room}).getByText("Confirmed",{exact:true})).toBeVisible();
  await expect(page.getByText("Reserved for this event",{exact:true})).toBeVisible();
  if (process.env.NEXUS_BOOKING_SCREENSHOTS) {
    await page.screenshot({path:`${process.env.NEXUS_BOOKING_SCREENSHOTS}/organizer-mobile.png`,fullPage:true});
    await page.setViewportSize({width:1440,height:900});
    await page.screenshot({path:`${process.env.NEXUS_BOOKING_SCREENSHOTS}/organizer-desktop.png`,fullPage:true});
  }
});
