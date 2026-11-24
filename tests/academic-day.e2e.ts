import "../scripts/environment";
import { expect,test,type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { demoEmail,demoPassword,fixtures as f } from "../scripts/fixtures";

async function signIn(page:Page,person:string) {
  if (await page.getByRole("button",{name:"Sign out"}).isVisible()) {
    await page.getByRole("button",{name:"Sign out"}).click();
  }
  await page.goto("/login");
  await page.getByLabel("Email").fill(demoEmail(person));
  await page.getByLabel("Password").fill(demoPassword);
  await page.getByRole("button",{name:"Sign in"}).click();
  await expect(page.getByRole("button",{name:"Sign out"})).toBeVisible();
}

test("admin publishes a timetable and faculty posts a corrected attendance record",async ({page})=>{
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url || !["127.0.0.1","localhost"].includes(new URL(url).hostname)) throw Error("Local test database required.");
  const room = randomUUID();
  const roomName = "Teaching lab " + room.slice(0,8);
  const db = new Client({connectionString:url});
  await db.connect();
  await db.query("INSERT INTO campus_resource (institution_id,id,name,kind,location) VALUES ($1,$2,$3,'room','Fictional campus')",[f.institution,room,roomName]);
  await db.end();
  try {
    const octet = parseInt(room.slice(0,2),16);
    await page.setExtraHTTPHeaders({"x-forwarded-for":`198.19.173.${octet}`});
    const localDate = (offset:number)=>new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Kolkata",dateStyle:"short"})
      .format(new Date(Date.now()+offset*86400000));
    const course = "Introduction to Programming";
    const path = (role:string,day:string,session="") => `/timetable?institution=${f.institution}&role=${role}&day=${day}${session}`;
    await signIn(page,"admin");
    await page.getByRole("link",{name:"Timetable"}).click();
    const policy = page.locator("details").filter({has:page.locator("summary").filter({hasText:course+" · Section A · Term 1"})}).first();
    await policy.locator("summary").click();
    await policy.getByLabel("Target percentage").fill("80");
    await policy.getByLabel("Policy reference").fill("Fictional handbook");
    await policy.getByRole("button",{name:"Save planning target"}).click();
    await expect(policy.locator("summary")).toContainText("80%");
    const draft = async (day:string) => {
      const form = page.getByRole("heading",{name:"Draft a weekly series"}).locator("..");
      await form.getByLabel("Course and instructor").selectOption({label:`${course} · Section A · Term 1 · Riya Rao`});
      await form.getByLabel("Room").selectOption(room);
      await form.getByLabel("First start").fill(`${day}T10:00`);
      await form.getByLabel("First end").fill(`${day}T11:00`);
      await form.getByRole("button",{name:"Create class draft"}).click();
      await expect(page.getByRole("button",{name:"Publish series"})).toBeVisible();
      const session = new URL(page.url()).searchParams.get("session");
      expect(session).toBeTruthy();
      await page.getByRole("button",{name:"Publish series"}).click();
      await expect(page.getByRole("button",{name:"Publish series"})).toHaveCount(0);
      return `&session=${session}`;
    };
    const historical = localDate(-2);
    const future = localDate(2);
    const oldSession = await draft(historical);
    await draft(future);
    await signIn(page,"student");
    const next = page.getByRole("region",{name:"Next class"});
    await expect(next.getByText(roomName,{exact:false})).toBeVisible();
    await next.getByRole("link",{name:course}).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading",{name:`${course} class`})).toBeVisible();
    await expect(page.getByRole("button",{name:"Record attendance"})).toHaveCount(0);

    await signIn(page,"faculty");
    await page.goto(path("faculty",historical,oldSession));
    await page.getByRole("button",{name:"Mark all absent"}).click();
    await page.getByRole("button",{name:"Record attendance"}).click();
    await expect(page.getByRole("button",{name:"Save correction"})).toBeVisible();
    await page.getByRole("button",{name:"Mark all present"}).click();
    await page.getByLabel("Correction reason").fill("Verified the laboratory register");
    await page.getByRole("button",{name:"Save correction"}).click();
    await expect(page.getByText("Attendance recorded",{exact:true}).last()).toBeVisible();
    await expect(page.getByLabel("Correction reason")).toBeEmpty();

    await signIn(page,"student");
    await page.goto(path("student",historical,oldSession));
    await expect(page.getByText("Your attendance: present")).toBeVisible();
    const summary = page.getByRole("region",{name:"My attendance"});
    await expect(summary.getByText(/recorded classes attended/)).toBeVisible();
    const recorded = await summary.locator("li").first().getByText(/recorded classes attended/).textContent();
    await summary.getByText("Try an attendance scenario").first().click();
    await summary.getByLabel("Classes you would attend").first().fill("0");
    await expect(summary.getByText("Planning target 80% · Fictional handbook")).toBeVisible();
    await expect(summary.getByText(/falls below the planning target/)).toBeVisible();
    await expect(summary.getByText(/Projected/)).toBeVisible();
    await expect(summary.getByText(recorded!,{exact:true})).toBeVisible();

    await page.goto(`/aura?institution=${f.institution}&role=student`);
    const ask=page.getByLabel("Ask AURA");
    await ask.fill("When is my next class?");
    await ask.press("Enter");
    const nextAnswer=page.getByRole("listitem",{name:"Request: When is my next class?"}).first();
    await expect(nextAnswer.getByText("Model calls 0 · Tool operations 1")).toBeVisible();
    await expect(nextAnswer.getByText(new RegExp(roomName))).toBeVisible();
    await nextAnswer.getByRole("link",{name:course}).click();
    await expect(page.getByRole("heading",{name:course+" class"})).toBeVisible();
    await page.goto(`/aura?institution=${f.institution}&role=student`);
    await ask.fill("What's my attendance percentage?");
    await ask.press("Enter");
    const response=page.getByRole("listitem",{name:"Request: What's my attendance percentage?"}).first();
    const source=response.getByRole("link",{name:new RegExp(course+".*100.0%")});
    await expect(source).toBeVisible();
    await source.click();
    await expect(page.getByRole("heading",{name:"Timetable",exact:true})).toBeVisible();
    await page.goto(path("student",historical,oldSession));

    await page.emulateMedia({reducedMotion:"reduce"});
    for (const width of [360,390,768,1024,1440]) {
      await page.setViewportSize({width,height:900});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
      if (process.env.NEXUS_ACADEMIC_SCREENSHOTS) {
        await page.evaluate(()=>window.scrollTo(0,0));
        await page.screenshot({path:`${process.env.NEXUS_ACADEMIC_SCREENSHOTS}/timetable-${width}.png`,fullPage:true});
      }
    }

    await signIn(page,"outsider");
    expect((await page.goto(path("student",historical,oldSession)))?.status()).toBe(404);
    expect((await page.goto(path("faculty",historical,oldSession)))?.status()).toBe(404);
  } finally {
    const cleanup = new Client({connectionString:url});
    await cleanup.connect();
    try {
      const args = [f.institution,room];
      await cleanup.query(`DELETE FROM class_attendance_mark WHERE institution_id=$1 AND session_id IN
        (SELECT id FROM class_session WHERE institution_id=$1 AND room_id=$2)`,args);
      await cleanup.query(`DELETE FROM class_attendance_revision WHERE institution_id=$1 AND session_id IN
        (SELECT id FROM class_session WHERE institution_id=$1 AND room_id=$2)`,args);
      await cleanup.query("DELETE FROM class_session WHERE institution_id=$1 AND room_id=$2",args);
      await cleanup.query("DELETE FROM campus_resource WHERE institution_id=$1 AND id=$2",args);
    } finally {
      await cleanup.end();
    }
  }
});
