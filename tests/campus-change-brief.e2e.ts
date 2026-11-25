import {expect,test,type Page} from "@playwright/test";
import {Client} from "pg";
import {randomUUID} from "node:crypto";
import {demoEmail,demoPassword,fixtures as f} from "../scripts/fixtures";

async function signIn(page:Page,alias:string){
  await page.goto("/login");
  await page.getByLabel("Email").fill(demoEmail(alias));
  await page.getByLabel("Password").fill(demoPassword);
  await page.getByRole("button",{name:"Sign in"}).click();
  await expect(page.getByRole("button",{name:"Sign out"})).toBeVisible();
}

test("Campus Change Brief offers only eligible rooms, confirms one move and shows a private student receipt",async ({page,browser})=>{
  const url=process.env.MIGRATION_DATABASE_URL;
  if(!url||!["localhost","127.0.0.1"].includes(new URL(url).hostname))throw Error("Use the fictional local database.");
  const d=new Client({connectionString:url});
  const session=randomUUID(),source=randomUUID(),target=randomUUID(),busy=randomUUID(),unknown=randomUUID(),wrong=randomUUID(),occupied=randomUUID();
  const stamp=session.slice(0,5), old="Original lab "+stamp, good="Verified lab "+stamp, start=new Date(Date.now()+3600000*23).toISOString();
  const end=new Date(Date.parse(start)+3600000).toISOString();
  const path=(role:string)=>`/timetable?institution=${f.institution}&role=${role}&session=${session}`;
  await d.connect();
  try {
    await d.query(`INSERT INTO campus_resource (institution_id,id,name,kind,location,capacity)
      SELECT $1,x.id,x.name,'room','Fictional floor',x.capacity FROM jsonb_to_recordset($2::jsonb) AS x(id uuid,name text,capacity integer)`,[
      f.institution,JSON.stringify([{id:source,name:old,capacity:25},{id:target,name:good,capacity:15},
        {id:busy,name:"Occupied "+stamp,capacity:30},{id:unknown,name:"Unknown capacity "+stamp,capacity:null},{id:wrong,name:"Unapproved "+stamp,capacity:20}])]);
    await d.query(`INSERT INTO teaching_room_alternative (institution_id,source_room_id,replacement_room_id)
      SELECT $1,$2,unnest($3::uuid[])`,[f.institution,source,[target,busy,unknown]]);
    const people=await d.query<{id:string;email:string}>('SELECT id,email FROM "user" WHERE email IN ($1,$2)',[demoEmail("admin"),demoEmail("faculty")]);
    const admin=people.rows.find(x=>x.email===demoEmail("admin"))!.id, faculty=people.rows.find(x=>x.email===demoEmail("faculty"))!.id;
    await d.query(`INSERT INTO class_session (institution_id,id,series_id,offering_id,section_id,faculty_id,room_id,slot,state,revision,created_by,published_at)
      VALUES($1,$2,$2,$3,$4,$5,$6,tstzrange($7,$8,'[)'),'published',1,$9,now()),
      ($1,$10,$10,$11,$12,$9,$13,tstzrange($7,$8,'[)'),'published',1,$9,now())`,[
      f.institution,session,f.offering,f.section,faculty,source,start,end,admin,occupied,f.otherOffering,f.otherSection,busy]);

    await signIn(page,"admin");
    await page.goto(path("admin"));
    await page.getByText("Campus Change Brief: replace the room",{exact:true}).click();
    const room=page.getByLabel("Replacement room");
    await expect(room.getByRole("option")).toHaveCount(2);
    await expect(room.getByRole("option",{name:new RegExp(good)})).toHaveCount(1);
    const stale=await page.context().newPage();
    await stale.goto(path("admin"));
    await stale.getByText("Campus Change Brief: replace the room",{exact:true}).click();
    await stale.getByLabel("Replacement room").selectOption(target);
    await stale.getByLabel("Public reason for room change").fill("Stale fictional review.");
    await room.selectOption(target);
    await page.getByLabel("Public reason for room change").fill("Fictional maintenance change.");
    await page.getByRole("button",{name:"Review room change"}).click();
    const dialog=page.getByRole("dialog",{name:"Review room change"});
    await expect(dialog.getByText(/active students.*teacher stay the same.*No external message/)).toBeVisible();
    await expect(dialog.getByText(new RegExp(old))).toBeVisible();
    await expect(dialog.getByText(new RegExp(good))).toBeVisible();
    await dialog.getByRole("button",{name:"Publish room change"}).click();
    await expect(page.getByRole("heading",{name:"Verified room change"})).toBeVisible();
    const announcement=page.getByRole("region",{name:"Room-change announcement"});
    await announcement.getByText("Preview message",{exact:true}).click();
    await expect(announcement.getByLabel("Message")).toHaveValue(new RegExp("From: "+old+"\\nGo to: "+good));

    await stale.getByRole("button",{name:"Review room change"}).click();
    await stale.getByRole("dialog").getByRole("button",{name:"Publish room change"}).click();
    await expect(stale.getByText("This class changed. Refresh before saving.")).toBeVisible();
    await stale.close();

    const c=await browser.newContext({baseURL:new URL(page.url()).origin});
    try{
      const student=await c.newPage();await signIn(student,"student");
      const updates=student.getByRole("region",{name:"Confirmed room changes"});
      await expect(updates.getByRole("link",{name:new RegExp(good)})).toBeVisible();
      await student.getByRole("button",{name:"Focus mode"}).press("Enter");
      const update = updates.getByRole("link",{name:new RegExp(good)});
      await expect(update).toBeVisible();
      await update.press("Enter");
      await expect(student.getByRole("region",{name:/Programming class/})).toBeFocused();
      await expect(student).toHaveURL(/day=\d{4}-\d{2}-\d{2}&view=day.*#class-details$/);
      await expect(student.getByRole("heading",{name:"Verified room change"})).toBeVisible();
      await expect(student.getByRole("button",{name:"Copy room-change update"})).toHaveCount(0);
      await expect(student.getByText(/Timetable revision 2.*Fictional maintenance change/)).toBeVisible();
      await student.reload();
      await expect(student.getByText(new RegExp("Moved from "+old+" to "+good))).toBeVisible();
      const outsider=await browser.newContext({baseURL:new URL(page.url()).origin});
      try {
        const viewer=await outsider.newPage();await signIn(viewer,"outsider");
        expect((await viewer.goto(path("student")))?.status()).toBe(404);
      }finally{await outsider.close();}
    }finally{await c.close();}
    const result=await d.query("SELECT count(*)::int AS total FROM class_room_change WHERE institution_id=$1 AND session_id=$2",[f.institution,session]);
    expect(result.rows[0].total).toBe(1);
  }finally{
    await d.query("DELETE FROM class_room_change WHERE institution_id=$1 AND session_id=$2",[f.institution,session]);
    await d.query("DELETE FROM class_session WHERE institution_id=$1 AND id=ANY($2::uuid[])",[f.institution,[session,occupied]]);
    await d.query("DELETE FROM teaching_room_alternative WHERE institution_id=$1 AND source_room_id=$2",[f.institution,source]);
    await d.query("DELETE FROM campus_resource WHERE institution_id=$1 AND id=ANY($2::uuid[])",[f.institution,[source,target,busy,unknown,wrong]]);
    await d.end();
  }
});
