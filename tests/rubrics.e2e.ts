// covers: FC-010
import "../scripts/environment";
import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { demoEmail, demoPassword, fixtures as f } from "../scripts/fixtures";

async function signIn(page: Page, person: string) {
  if (await page.getByRole("button", { name: "Sign out", exact: true }).isVisible()) {
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
  }
  await page.goto("/login");
  await page.getByLabel("Email").fill(demoEmail(person));
  await page.getByLabel("Password").fill(demoPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
}

test("a teacher adds rubric criteria, scores a submission by criterion, and the student sees the breakdown", async ({ page }) => {
  const assignment = randomUUID(), submission = randomUUID(), title = `Rubric lab ${assignment.slice(0, 6)}`;
  const db = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await db.connect();
  try {
    await db.query(`INSERT INTO assignment (institution_id,id,offering_id,title,description,deadline,max_marks,published_at)
      VALUES ($1,$2,$3,$4,'Fictional',now()+interval '3 days',10,now())`, [f.institution, assignment, f.offering, title]);
    await db.query(`INSERT INTO submission (institution_id,id,assignment_id,student_id,body,submitted_at,request_id)
      SELECT $1,$2,$3,id,'Fictional answer',now(),gen_random_uuid() FROM "user" WHERE email=$4`, [f.institution, submission, assignment, demoEmail("student")]);
    await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.19.212.41" });
    await signIn(page, "faculty");
    await page.goto(`/assignments/${assignment}?institution=${f.institution}&role=faculty`);
    await page.getByText("Add rubric criteria").click();
    await page.getByLabel("Criteria").fill("Correctness | 6 | All tests pass\nExplanation | 4");
    await page.getByRole("button", { name: "Save criteria" }).click();
    await expect(page.getByRole("table", { name: "Rubric criteria" })).toContainText("Correctness");
    await page.goto(`/assignments/${assignment}?institution=${f.institution}&role=faculty&submission=${submission}`);
    await page.getByLabel("Correctness (out of 6)").fill("5");
    await page.getByLabel("Comment on Correctness (optional)").fill("One test fails");
    await page.getByLabel("Explanation (out of 4)").fill("3");
    await page.getByLabel("Feedback").fill("Good work; explain the edge cases.");
    await page.getByRole("button", { name: "Save grade draft" }).click();
    await page.getByRole("button", { name: "Publish feedback" }).click();
    await expect(page.getByText("Published result · 8/10")).toBeVisible();

    await signIn(page, "student");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/assignments/${assignment}?institution=${f.institution}&role=student`);
    const breakdown = page.getByRole("list", { name: "Score by criterion" });
    await expect(breakdown).toContainText("Correctness · 5/6 · One test fails");
    await expect(breakdown).toContainText("Explanation · 3/4");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  } finally {
    await db.query("DELETE FROM criterion_score WHERE institution_id=$1 AND submission_id=$2", [f.institution, submission]);
    await db.query("DELETE FROM grade WHERE institution_id=$1 AND submission_id=$2", [f.institution, submission]);
    await db.query("DELETE FROM submission WHERE institution_id=$1 AND id=$2", [f.institution, submission]);
    await db.query("DELETE FROM rubric_criterion WHERE institution_id=$1 AND assignment_id=$2", [f.institution, assignment]);
    await db.query("DELETE FROM job WHERE institution_id=$1 AND event_id IN (SELECT id FROM audit_event WHERE institution_id=$1 AND entity_id IN ($2,$3))", [f.institution, assignment, submission]);
    await db.query("DELETE FROM notification WHERE institution_id=$1 AND entity_id IN ($2,$3)", [f.institution, assignment, submission]);
    await db.query("DELETE FROM assignment WHERE institution_id=$1 AND id=$2", [f.institution, assignment]);
    await db.end();
  }
});
