// covers: DH-012, DH-013, FC-014, SA-019
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
const at = (role: string, path: string) => `${path}?institution=${f.institution}&role=${role}`;

test("a teacher proposes a mapped course outcome, the HOD approves it, the teacher tags an assessment, and attainment appears", async ({ page }, testInfo) => {
  const assignment = randomUUID(), po = randomUUID(), title = `Outcome quiz ${assignment.slice(0, 6)}`;
  const db = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await db.connect();
  try {
    await db.query(`INSERT INTO programme_outcome (institution_id,id,code,statement,created_by) SELECT $1,$2,'PO88','Fictional engineering knowledge',id FROM "user" WHERE email=$3`,
      [f.institution, po, demoEmail("admin")]);
    await db.query(`INSERT INTO assignment (institution_id,id,offering_id,title,description,deadline,max_marks,published_at)
      VALUES ($1,$2,$3,$4,'Fictional',now()-interval '2 days',10,now()-interval '5 days')`, [f.institution, assignment, f.offering, title]);
    const { rows: [s] } = await db.query(`INSERT INTO submission (institution_id,assignment_id,student_id,body,submitted_at,request_id)
      SELECT $1,$2,id,'Fictional',now()-interval '3 days',gen_random_uuid() FROM "user" WHERE email=$3 RETURNING id`, [f.institution, assignment, demoEmail("student")]);
    await db.query("INSERT INTO grade (institution_id,submission_id,revision,marks,feedback,published_at) VALUES ($1,$2,1,7,'Fictional',now())", [f.institution, s.id]);

    await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.19.207.61" });
    await signIn(page, "faculty");
    await page.goto(at("faculty", "/outcomes"));
    const propose = page.getByRole("region", { name: "Propose a course outcome" });
    await propose.getByLabel("Code").fill("CO88");
    await propose.getByLabel("Statement").fill("Design a fictional filter");
    await propose.getByLabel("PO88 · Fictional engineering knowledge").selectOption("3");
    await propose.getByRole("button", { name: "Send for approval" }).click();
    await expect(propose.getByRole("status")).toHaveText("Sent to the department head.");

    await signIn(page, "hod");
    await page.goto(at("hod", "/outcomes"));
    const proposal = page.getByRole("article").filter({ hasText: "Design a fictional filter" });
    await expect(proposal).toContainText("Maps to PO88 (3)");
    await proposal.getByLabel("Reason").fill("Measurable");
    await proposal.getByRole("button", { name: "Record decision" }).click();
    await expect(proposal.locator(".tag")).toHaveText("Approved");

    await signIn(page, "faculty");
    await page.goto(at("faculty", "/outcomes"));
    const quiz = page.getByRole("article", { name: title });
    await quiz.getByRole("button", { name: "Tag CO88" }).click();
    await expect(quiz.getByRole("button", { name: "Untag CO88" })).toBeVisible();

    await signIn(page, "hod");
    await page.goto(at("hod", "/outcomes") + `&offering=${f.offering}`);
    const table = page.getByRole("table", { name: "Course outcome attainment" });
    await expect(table.getByRole("row", { name: /^CO88 1 1 100 3$/ })).toBeVisible();
    await expect(page.getByText(/PO88 3/)).toBeVisible();

    await signIn(page, "student");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(at("student", "/outcomes"));
    await expect(page.getByText("70% · attained")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await page.screenshot({ path: testInfo.outputPath("outcomes-student-390.png"), fullPage: true });
  } finally {
    await db.query("DELETE FROM assessment_outcome WHERE institution_id=$1 AND assignment_id=$2", [f.institution, assignment]);
    await db.query("DELETE FROM grade WHERE institution_id=$1 AND submission_id IN (SELECT id FROM submission WHERE institution_id=$1 AND assignment_id=$2)", [f.institution, assignment]);
    await db.query("DELETE FROM submission WHERE institution_id=$1 AND assignment_id=$2", [f.institution, assignment]);
    await db.query("DELETE FROM job WHERE institution_id=$1 AND event_id IN (SELECT id FROM audit_event WHERE institution_id=$1 AND entity_id=$2)", [f.institution, assignment]);
    await db.query("DELETE FROM assignment WHERE institution_id=$1 AND id=$2", [f.institution, assignment]);
    await db.query("DELETE FROM outcome_mapping WHERE institution_id=$1 AND programme_outcome_id=$2", [f.institution, po]);
    await db.query("DELETE FROM course_outcome WHERE institution_id=$1 AND code='CO88'", [f.institution]);
    await db.query("DELETE FROM programme_outcome WHERE institution_id=$1 AND id=$2", [f.institution, po]);
    await db.end();
  }
});
