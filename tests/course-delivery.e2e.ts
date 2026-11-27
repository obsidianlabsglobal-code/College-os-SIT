// covers: SA-018, FC-020, FC-006, DH-005, DH-011, DH-022, FC-016, LE-019
import "../scripts/environment";
import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { demoEmail, demoPassword, fixtures as f } from "../scripts/fixtures";

async function signIn(page: Page, person: string) {
  if (await page.getByRole("button", { name: "Sign out" }).isVisible()) await page.getByRole("button", { name: "Sign out" }).click();
  await page.goto("/login");
  await page.getByLabel("Email").fill(demoEmail(person));
  await page.getByLabel("Password").fill(demoPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}
const course = (role: string) => `/courses/${f.offering}?institution=${f.institution}&role=${role}`;

test("teacher publishes material and a plan, the department head approves it, and the student sees both", async ({ page, context }, testInfo) => {
  const db = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await db.connect();
  const [title, room, session] = [`Lab sheet ${randomUUID().slice(0, 6)}`, randomUUID(), randomUUID()];
  const cleanup = async () => {
    await db.query("DELETE FROM class_delivery WHERE institution_id=$1 AND session_id IN (SELECT id FROM class_session WHERE institution_id=$1 AND offering_id=$2)", [f.institution, f.offering]);
    await db.query("DELETE FROM course_plan_item WHERE institution_id=$1 AND offering_id=$2", [f.institution, f.offering]);
    await db.query("DELETE FROM course_plan WHERE institution_id=$1 AND offering_id=$2", [f.institution, f.offering]);
    await db.query("DELETE FROM class_session WHERE institution_id=$1 AND id=$2", [f.institution, session]);
    await db.query("DELETE FROM course_resource_version WHERE institution_id=$1 AND resource_id IN (SELECT id FROM course_resource WHERE institution_id=$1 AND title LIKE 'Lab sheet %')", [f.institution]);
    await db.query("DELETE FROM course_resource WHERE institution_id=$1 AND title LIKE 'Lab sheet %'", [f.institution]);
    await db.query("DELETE FROM campus_resource WHERE institution_id=$1 AND id=$2", [f.institution, room]);
  };
  try {
    await cleanup();
    await db.query("INSERT INTO campus_resource (institution_id,id,name,kind,location) VALUES ($1,$2,'Plan room','room','Fictional')", [f.institution, room]);
    await db.query(`INSERT INTO class_session (institution_id,id,series_id,offering_id,section_id,faculty_id,room_id,slot,state,created_by,published_at)
      SELECT $1,$2,gen_random_uuid(),$3,o.section_id,u.id,$4,tstzrange(now()-interval '3 hours',now()-interval '2 hours'),'conducted',u.id,now()
      FROM offering o,"user" u WHERE o.institution_id=$1 AND o.id=$3 AND u.email=$5`, [f.institution, session, f.offering, room, demoEmail("faculty")]);
    await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.19.202.51" });
    await signIn(page, "faculty");
    await page.goto(course("faculty"));
    const materials = page.getByRole("region", { name: "Course materials" });
    const add = materials.locator("details").filter({ hasText: "Add course material" });
    await add.getByText("Add course material").click();
    await add.getByLabel("Title").fill(title);
    await add.getByLabel("File (PDF or TXT, 4 MiB)").setInputFiles({ name: "lab.txt", mimeType: "text/plain", buffer: Buffer.from("Fictional lab sheet") });
    await add.getByRole("button", { name: "Publish material" }).click();
    await expect(materials.getByRole("link", { name: title })).toBeVisible();

    const plan = page.getByRole("region", { name: "Course plan" });
    await plan.getByLabel("Topics, one per line, in teaching order").fill("Variables\nLoops\nFunctions");
    await plan.getByRole("button", { name: "Save plan draft" }).click();
    await expect(plan.getByRole("listitem").filter({ hasText: "Loops" })).toBeVisible();
    await plan.getByRole("button", { name: "Send for department approval" }).click();
    await expect(plan.getByText("Awaiting department approval")).toBeVisible();

    await signIn(page, "hod");
    const board = page.getByRole("region", { name: "Course plans and delivery" });
    await board.getByLabel("Decision").selectOption("approve");
    await board.getByLabel("Reason").fill("Matches the scheme");
    await board.getByRole("button", { name: "Record plan decision" }).click();
    await expect(board.getByRole("region", { name: "Course delivery" })).toContainText("0 of 3");
    await page.screenshot({ path: testInfo.outputPath("hod-plans-1280.png"), fullPage: true });

    await signIn(page, "faculty");
    await page.goto(course("faculty"));
    const log = page.getByRole("region", { name: "Class delivery log" });
    await log.getByText("Record delivery").first().click();
    await log.getByLabel("Plan topic").first().selectOption({ label: "2. Loops" });
    await log.getByLabel("What was covered").first().fill("While and for loops with examples");
    await log.getByRole("button", { name: "Save delivery record" }).first().click();
    await expect(log.getByText("2. Loops").first()).toBeVisible();

    await signIn(page, "student");
    await page.goto(course("student"));
    await expect(page.getByRole("region", { name: "Course plan" })).toContainText("delivered in 1 class");
    const download = await context.request.get(await page.getByRole("link", { name: title }).getAttribute("href") ?? "");
    expect([download.status(), await download.text()]).toEqual([200, "Fictional lab sheet"]);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.screenshot({ path: testInfo.outputPath("course-student-390.png"), fullPage: true });
  } finally {
    await cleanup();
    await db.end();
  }
});

test("an administrator assigns a mentor; the mentor sets a goal and the student agrees", async ({ page, context }) => {
  const db = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await db.connect();
  const cleanup = async () => {
    await db.query(`DELETE FROM mentoring_record WHERE institution_id=$1 AND assignment_id IN (SELECT a.id FROM mentor_assignment a JOIN "user" u ON u.id=a.student_id WHERE a.institution_id=$1 AND u.email=$2)`, [f.institution, demoEmail("student")]);
    await db.query(`DELETE FROM mentor_assignment a USING "user" u WHERE u.id=a.student_id AND a.institution_id=$1 AND u.email=$2`, [f.institution, demoEmail("student")]);
  };
  try {
    await cleanup();
    await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.19.202.52" });
    await signIn(page, "admin");
    await page.goto(`/mentoring?institution=${f.institution}&role=admin`);
    await page.locator("select[name=student]").selectOption({ label: "Asha Sen" });
    await page.getByLabel("Faculty mentor").selectOption({ label: "Riya Rao" });
    await page.getByRole("button", { name: "Assign mentor" }).click();
    await expect(page.getByText("Asha Sen · mentored by Riya Rao")).toBeVisible();

    await signIn(page, "faculty");
    await page.goto(`/mentoring?institution=${f.institution}&role=faculty`);
    const mentee = page.getByRole("region", { name: "Asha Sen" });
    await mentee.getByLabel("Note").fill("Finish every lab before the deadline");
    await mentee.getByRole("button", { name: "Save note" }).click();
    await expect(mentee.getByText("Not yet agreed")).toBeVisible();

    await signIn(page, "student");
    await page.goto(`/mentoring?institution=${f.institution}&role=student`);
    const mine = page.getByRole("region", { name: "Your mentor" });
    await mine.getByRole("button", { name: "Mark goal agreed" }).click();
    await expect(mine.getByText(/^Agreed /)).toBeVisible();

    await signIn(page, "principal");
    const report = await context.request.get(`/records/export?institution=${f.institution}&role=principal`);
    expect(report.status()).toBe(200);
    expect(await report.text()).toMatch(/^section,subject,measure,value,window,definition,source/);
    expect((await context.request.get(`/mentoring?institution=${f.institution}&role=principal`)).status()).toBe(404);
  } finally {
    await cleanup();
    await db.end();
  }
});
