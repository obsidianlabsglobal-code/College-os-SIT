// covers: SA-005, SA-021, SA-010, SA-022, FC-028, SA-002, ID-005
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
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);

test("a student requests an attendance correction and the teacher accepts it with a reason", async ({ page }, testInfo) => {
  const db = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await db.connect();
  const [session, room] = [randomUUID(), randomUUID()];
  const cleanup = async () => {
    const entities = [session, ...(await db.query("SELECT id FROM attendance_correction WHERE institution_id=$1 AND session_id=$2", [f.institution, session])).rows.map(r => r.id)];
    await db.query("DELETE FROM notification WHERE institution_id=$1 AND entity_id=ANY($2)", [f.institution, entities]);
    await db.query("DELETE FROM job WHERE institution_id=$1 AND event_id IN (SELECT id FROM audit_event WHERE institution_id=$1 AND entity_id=ANY($2))", [f.institution, entities]);
    await db.query("DELETE FROM audit_event WHERE institution_id=$1 AND entity_id=ANY($2)", [f.institution, entities]);
    await db.query("DELETE FROM attendance_correction WHERE institution_id=$1 AND session_id=$2", [f.institution, session]);
    await db.query("DELETE FROM class_attendance_mark WHERE institution_id=$1 AND session_id=$2", [f.institution, session]);
    await db.query("DELETE FROM class_attendance_revision WHERE institution_id=$1 AND session_id=$2", [f.institution, session]);
    await db.query("DELETE FROM class_session WHERE institution_id=$1 AND id=$2", [f.institution, session]);
    await db.query("DELETE FROM campus_resource WHERE institution_id=$1 AND id=$2", [f.institution, room]);
  };
  try {
    await db.query("INSERT INTO campus_resource (institution_id,id,name,kind,location) VALUES ($1,$2,'Correction room','room','Fictional')", [f.institution, room]);
    const { rows: [start] } = await db.query(`INSERT INTO class_session (institution_id,id,series_id,offering_id,section_id,faculty_id,room_id,slot,state,revision,created_by,published_at)
      SELECT $1,$2,gen_random_uuid(),$3,o.section_id,u.id,$4,tstzrange(now()-interval '26 hours',now()-interval '25 hours'),'conducted',2,u.id,now()
      FROM offering o,"user" u WHERE o.institution_id=$1 AND o.id=$3 AND u.email=$5
      RETURNING to_char(lower(slot) AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD') AS day`, [f.institution, session, f.offering, room, demoEmail("faculty")]);
    await db.query(`INSERT INTO class_attendance_revision (institution_id,session_id,revision,actor_id) SELECT $1,$2,1,id FROM "user" WHERE email=$3`, [f.institution, session, demoEmail("faculty")]);
    await db.query(`INSERT INTO class_attendance_mark (institution_id,session_id,revision,student_id,status)
      SELECT $1,$2,1,r.account_id,CASE WHEN u.email=$4 THEN 'absent' ELSE 'present' END FROM roster r JOIN "user" u ON u.id=r.account_id
      WHERE r.institution_id=$1 AND r.offering_id=$3 AND r.role='student' AND r.ended_at IS NULL`, [f.institution, session, f.offering, demoEmail("student")]);

    await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.19.202.41" });
    await signIn(page, "student");
    await page.goto(`/timetable?institution=${f.institution}&role=student&day=${start.day}&view=day&session=${session}#class-details`);
    const detail = page.locator("#class-details");
    await expect(detail.getByText("Your attendance: absent")).toBeVisible();
    await detail.getByText("Request an attendance correction").click();
    await detail.getByLabel("Why should this mark change?").fill("I was present and signed late");
    await detail.getByRole("button", { name: "Send correction request" }).click();
    const mine = page.getByRole("region", { name: "Attendance corrections", exact: true });
    await expect(mine.getByText("Awaiting decision")).toBeVisible();

    await signIn(page, "faculty");
    await page.goto(`/timetable?institution=${f.institution}&role=faculty#corrections`);
    const queue = page.getByRole("region", { name: "Attendance correction requests" });
    const item = queue.getByRole("listitem").filter({ hasText: "I was present and signed late" });
    await expect(item).toContainText("Asha Sen");
    await item.getByLabel("Decision").selectOption("accept");
    await item.getByLabel("Reason").fill("Register signature verified");
    await item.getByRole("button", { name: "Record decision" }).click();
    await expect(page.getByText("I was present and signed late")).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow(page);

    await signIn(page, "student");
    await page.goto(`/timetable?institution=${f.institution}&role=student&day=${start.day}&view=day&session=${session}#class-details`);
    await expect(page.locator("#class-details").getByText("Your attendance: present")).toBeVisible();
    await expect(page.getByRole("region", { name: "Attendance corrections", exact: true }).getByText("Decision: Register signature verified")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("correction-student-390.png"), fullPage: true });
  } finally {
    await cleanup();
    await db.end();
  }
});

test("calendar, catalog, exports and the page finder work for each role", async ({ page, context }, testInfo) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.19.202.42" });
  await signIn(page, "student");
  await page.goto(`/calendar?institution=${f.institution}&role=student`);
  await expect(page.getByRole("heading", { name: "Academic calendar" })).toBeVisible();
  await page.getByLabel("Type").selectOption("class");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/kind=class/);
  await page.getByRole("link", { name: "Next month" }).click();
  await expect(page).toHaveURL(/kind=class/);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("navigation", { name: "Campus workflows" }).getByRole("link").first()).toHaveText("Today");
  for (const width of [390, 1280]) { await page.setViewportSize({ width, height: 900 }); await noOverflow(page); }
  await page.screenshot({ path: testInfo.outputPath("calendar-1280.png"), fullPage: true });

  const record = await context.request.get(`/records/export?institution=${f.institution}&role=student`);
  expect(record.status()).toBe(200);
  expect(record.headers()["content-type"]).toContain("text/csv");
  expect(record.headers()["cache-control"]).toContain("no-store");
  expect(await record.text()).toMatch(/^record,course,item,date,result,source/);

  await page.goto(`/catalog?institution=${f.institution}&role=student`);
  await page.getByLabel("Course or department").fill("Programming");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("region", { name: /offerings$/ }).first().getByText("Enrolled").first()).toBeVisible();

  await page.keyboard.press("Control+k");
  const finder = page.getByRole("dialog", { name: "Find a page" });
  await expect(finder).toBeVisible();
  await finder.getByLabel("Page name").fill("history");
  await finder.getByLabel("Page name").press("Enter");
  await expect(page.getByRole("heading", { name: "Assessment history" })).toBeVisible();

  await signIn(page, "faculty");
  const report = await context.request.get(`/records/export?institution=${f.institution}&role=faculty`);
  expect(report.status()).toBe(200);
  expect(await report.text()).toContain(`offering:${f.offering}`);
  await signIn(page, "admin");
  expect((await context.request.get(`/records/export?institution=${f.institution}&role=admin`)).status()).toBe(404);
  expect((await context.request.get(`/calendar?institution=${f.institution}&role=admin`)).status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Institution operations" })).toBeVisible();
  await expect(page.getByLabel("Enrollment-letter queue")).toContainText("Without an owner");
  await page.screenshot({ path: testInfo.outputPath("admin-1280.png"), fullPage: true });
});
