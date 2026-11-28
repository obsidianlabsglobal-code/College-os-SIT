// covers: ID-004, FC-005
import {expect,test,type Page} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {Client} from "pg";
import {fixtures as f,demoEmail,demoPassword} from "../scripts/fixtures";

async function signIn(page:Page, persona:string){
  await page.goto("/login");
  await page.getByLabel("Email").fill(demoEmail(persona));
  await page.getByLabel("Password").fill(demoPassword);
  await page.getByRole("button",{name:"Sign in"}).click();
  await expect(page.getByRole("button",{name:"Sign out"})).toBeVisible();
}

test("a 60-person fictional roll sheet preserves exceptions, undo, scope and saved totals",async ({page,browser},testInfo)=>{
  const url=process.env.MIGRATION_DATABASE_URL;
  if (!url || !["127.0.0.1","localhost"].includes(new URL(url).hostname)) throw Error("Use a local fictional migration database.");
  const db=new Client({connectionString:url});
  const session=randomUUID(),room=randomUUID();
  const extra=Array.from({length:59},(_,i)=>({id:`${session}-${i}`,name:`Lab Student ${String(i+1).padStart(2,"0")}`}));
  await db.connect();
  try {
    const {rows:[faculty]}=await db.query<{id:string}>('SELECT id FROM "user" WHERE email=$1',[demoEmail("faculty")]);
    await db.query(`INSERT INTO "user" (id,name,email,"emailVerified")
      SELECT x.id,x.name,x.id||'@nexus.example.invalid',false FROM jsonb_to_recordset($1::jsonb) x(id text,name text)`,[JSON.stringify(extra)]);
    const keys=extra.map(row=>row.id);
    await db.query("INSERT INTO membership(institution_id,account_id,role) SELECT $1,unnest($2::text[]),'student'",[f.institution,keys]);
    await db.query("INSERT INTO roster(institution_id,offering_id,account_id,role) SELECT $1,$2,unnest($3::text[]),'student'",[f.institution,f.offering,keys]);
    await db.query("INSERT INTO campus_resource(institution_id,id,name,kind,location) VALUES ($1,$2,'Electronics Lab 2','room','Fictional campus')",[f.institution,room]);
    await db.query(`INSERT INTO class_session(institution_id,id,series_id,offering_id,section_id,faculty_id,room_id,slot,state,revision,created_by,published_at)
      VALUES ($1,$2,$2,$3,$4,$5,$6,tstzrange(now()-interval '26 hours',now()-interval '25 hours','[)'),'published',1,$5,now())`,
      [f.institution,session,f.offering,f.section,faculty.id,room]);

    await page.setViewportSize({width:390,height:844});
    await page.emulateMedia({reducedMotion:"reduce"});
    await signIn(page,"faculty");
    const queue=page.getByRole("region",{name:"Attendance queue"});
    const reviewQueue=page.getByRole("link",{name:"Review attendance queue"});
    await reviewQueue.press("Enter");
    await expect(queue).toBeFocused();
    await expect(queue.getByRole("figure",{name:"Class attendance records"})).toContainText("1 To record");
    const rollLink=queue.getByRole("link",{name:/Open roll sheet for Introduction to Programming/});
    const route=await rollLink.getAttribute("href");
    if (!route) throw Error("Expected a scoped roll-sheet link");
    const wrong=await browser.newContext({baseURL:new URL(page.url()).origin});
    try {
      const other=await wrong.newPage();
      await signIn(other,"replacement");
      expect((await other.goto(route))?.status()).toBe(404);
    }finally{await wrong.close();}
    await rollLink.press("Enter");
    const roll=page.getByRole("region",{name:"Take class attendance"});
    const save=roll.getByRole("button",{name:"Record attendance"});
    const chart=roll.getByRole("figure",{name:"Roll sheet breakdown"});
    await expect(chart).toContainText("60 Unmarked");
    await expect(save).toBeDisabled();
    await expect(page.getByRole("button",{name:"Copy WhatsApp update"})).toHaveCount(0);
    const search=roll.getByRole("searchbox",{name:"Find a student"});
    await search.fill("lab student 12");
    const row=roll.getByRole("group",{name:"Lab Student 12"});
    await expect(roll.getByText("1 of 60 students shown")).toBeVisible();
    await row.getByRole("button",{name:"Absent"}).press("Enter");
    await expect(row.getByRole("button",{name:"Absent"})).toHaveAttribute("aria-pressed","true");
    await roll.getByRole("button",{name:"Mark remaining present"}).click();
    await expect(chart).toContainText("59 Present");
    await expect(chart).toContainText("1 Absent");
    await roll.getByRole("button",{name:"Undo bulk edit"}).click();
    await expect(chart).toContainText("59 Unmarked");
    await expect(chart).toContainText("1 Absent");
    await expect(save).toBeDisabled();
    // Bulk marking applies to the full roster, not just the active search.
    await roll.getByRole("button",{name:"Mark remaining present"}).click();
    await search.clear();
    await expect(roll.getByText("60 of 60 students shown")).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
    await roll.locator("h3").scrollIntoViewIfNeeded();
    await page.screenshot({path:testInfo.outputPath("attendance-workbench-phone.png")});
    const review=roll.getByRole("link",{name:"Review and save"});
    await review.press("Enter");
    await expect(roll.locator(`#attendance-save-${session}`)).toBeFocused();
    expect((await db.query("SELECT id FROM class_session WHERE id=$1 AND state='published'",[session])).rowCount).toBe(1);
    await save.click();
    await expect(page.getByRole("heading",{name:"Correct recorded attendance"})).toBeVisible();
    await page.context().grantPermissions(["clipboard-read","clipboard-write"]);
    await page.getByRole("button",{name:"Copy WhatsApp update"}).click();
    await expect(page.getByRole("status").filter({hasText:"Nothing has been sent"})).toBeVisible();
    const draft=await page.evaluate(()=>navigator.clipboard.readText());
    expect(draft).toContain("Class: Introduction to Programming · Section A");
    expect(draft).toMatch(/Date: .+\nTime: .+Asia\/Kolkata/);
    expect(draft).toContain("Faculty: Riya Rao");
    expect(draft).toContain("Roster: 60 · Present: 59 · Absent: 1");
    expect(draft).not.toContain("Lab Student 12");
    const evidence=await db.query<{present:number;absent:number}>(`SELECT count(*) FILTER(WHERE status='present')::int AS present,
      count(*) FILTER(WHERE status='absent')::int AS absent FROM class_attendance_mark WHERE session_id=$1`,[session]);
    expect(evidence.rows[0]).toEqual({present:59,absent:1});
    await page.goto("/");
    await expect(queue.getByRole("figure",{name:"Class attendance records"})).toContainText("1 Recorded");
    await expect(queue.getByRole("link",{name:/Open roll sheet/})).toHaveCount(0);
  } finally {
    await db.query("DELETE FROM class_attendance_mark WHERE session_id=$1",[session]);
    await db.query("DELETE FROM class_attendance_revision WHERE session_id=$1",[session]);
    await db.query("DELETE FROM audit_event WHERE entity_id=$1",[session]);
    await db.query("DELETE FROM class_session WHERE id=$1",[session]);
    await db.query("DELETE FROM campus_resource WHERE id=$1",[room]);
    const keys=extra.map(row=>row.id);
    await db.query("DELETE FROM roster WHERE account_id=ANY($1::text[])",[keys]);
    await db.query("DELETE FROM membership WHERE account_id=ANY($1::text[])",[keys]);
    await db.query('DELETE FROM "user" WHERE id=ANY($1::text[])',[keys]);
    await db.end();
  }
});
