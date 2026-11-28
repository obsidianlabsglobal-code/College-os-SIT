// Walks docs/DEMO_DEC2.md step by step on the fictional demo data. Run once on a fresh demo database before presenting.
import "../../scripts/environment";
import { expect, test, type Page } from "@playwright/test";
import { demoEmail, demoPassword, fixtures as f } from "../../scripts/fixtures";
import { openWorkflow } from "../workspace-navigation";

const at = (role: string, path: string) => `${path}?institution=${f.institution}&role=${role}`;
async function signIn(page: Page, person: string) {
  if (await page.getByRole("button", { name: "Sign out" }).isVisible()) await page.getByRole("button", { name: "Sign out" }).click();
  await page.goto("/login");
  await page.getByLabel("Email").fill(demoEmail(person));
  await page.getByLabel("Password").fill(demoPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}
const tomorrowEvening = `${new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(Date.now() + 86400000))}T19:00`;

test("the 2 December demo script runs end to end", async ({ page, browser }, testInfo) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.19.240.10" });
  const shot = (name: string) => page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });

  // 1. Student morning
  await signIn(page, "student");
  await page.goto(at("student", "/"));
  await expect(page.getByRole("heading", { name: "Good to see you, Asha." })).toBeVisible();
  await expect(page.getByText("Lab 3 · Signals and sampling").first()).toBeVisible();
  await shot("01-student-today");

  // 2. Submit work
  await page.getByRole("region", { name: "My assignments", exact: true }).getByRole("link", { name: "Lab 3 · Signals and sampling", exact: true }).click();
  await page.getByLabel("Response").fill("Sampling below the Nyquist rate folds high frequencies onto low ones.");
  await page.getByRole("button", { name: "Submit assignment" }).click();
  await expect(page.getByRole("heading", { name: "Submitted" })).toBeVisible();

  // 3. Attendance correction
  await page.goto(at("student", "/"));
  await page.getByRole("region", { name: /Today.s classes/ }).getByRole("link", { name: "Introduction to Programming" }).first().click();
  const detail = page.locator("#class-details");
  await expect(detail.getByText("Your attendance: absent")).toBeVisible();
  await detail.getByText("Request an attendance correction").click();
  await detail.getByLabel("Why should this mark change?").fill("I was present and signed late");
  await detail.getByRole("button", { name: "Send correction request" }).click();
  await expect(page.getByRole("region", { name: "Attendance corrections", exact: true }).getByText("Awaiting decision")).toBeVisible();

  // 4. Campus life
  await page.goto(at("student", "/sports"));
  await page.getByRole("article", { name: "ECE XI", exact: true }).getByRole("button", { name: "Request a trial" }).click();
  await expect(page.getByRole("article", { name: "ECE XI", exact: true })).toContainText("Trial requested");
  await page.goto(at("student", "/opportunities"));
  const drive = page.locator(".listing-card").filter({ hasText: "Graduate engineer · campus drive" });
  await expect(drive).toContainText("Only for students taking a Electronics and Communication Engineering course");
  await drive.getByRole("button", { name: "Track" }).click();
  await expect(drive.getByRole("status")).toHaveText("Saved to My applications.");
  await page.goto(at("student", "/careers"));
  const application = page.getByRole("article", { name: "Graduate engineer · campus drive" });
  await application.getByText("Mark as submitted").click();
  await application.getByLabel("Final statement").fill("I built a fictional line-following robot in the ECE lab.");
  await application.getByRole("button", { name: "Submit application" }).click();
  await expect(application.locator(".tag")).toHaveText("Submitted");
  await page.goto(at("student", "/facilities"));
  const booking = page.getByRole("region", { name: "Request a room or lab" });
  await booking.getByLabel("Room or lab").selectOption({ label: "ECE Lab 2" });
  await booking.getByLabel("Purpose").fill("Robot build");
  await booking.getByLabel("Supervising teacher").selectOption({ label: "Riya Rao" });
  await booking.locator("input[name=start]").fill(tomorrowEvening);
  await booking.getByRole("button", { name: "Request booking" }).click();
  await expect(page.getByRole("article", { name: "ECE Lab 2 · Robot build" }).locator(".tag")).toHaveText("Requested");
  await page.goto(at("student", "/"));
  await openWorkflow(page, "Service requests");
  await page.getByLabel("Purpose and delivery needs").fill("Bonafide letter for a bank account");
  await page.getByRole("button", { name: "Submit request" }).click();
  await expect(page.getByText("Bonafide letter for a bank account")).toBeVisible();

  // 5. Teacher grades and publishes Lab 2
  await signIn(page, "faculty");
  await page.goto(at("faculty", "/"));
  await expect(page.getByText("2 submissions awaiting evaluation").first()).toBeVisible();
  await shot("05-faculty-home");
  await page.goto(at("faculty", "/grading"));
  await page.getByRole("link", { name: "Evaluate submission by Asha Sen for Lab 2 · Sorting algorithms" }).click();
  await page.getByLabel("Marks", { exact: true }).fill("17");
  await page.getByLabel("Feedback").fill("Correct merge step; explain the stability property.");
  await page.getByRole("button", { name: "Save grade draft" }).click();
  await expect(page.getByText("Draft awaiting publication", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Publish feedback" }).click();
  await expect(page.getByText("Published result · 17/20")).toBeVisible();

  // 6. Teacher decides the correction and the trial, and tags Lab 2 with CO1
  await page.goto(at("faculty", "/timetable") + "#corrections");
  const item = page.getByRole("region", { name: "Attendance correction requests" }).getByRole("listitem").filter({ hasText: "I was present and signed late" });
  await item.getByLabel("Decision").selectOption("accept");
  await item.getByLabel("Reason").fill("Register signature verified");
  await item.getByRole("button", { name: "Record decision" }).click();
  await expect(page.getByText("I was present and signed late")).toHaveCount(0);
  await page.goto(at("faculty", "/sports"));
  const team = page.getByRole("article", { name: "ECE XI", exact: true });
  await team.getByText("Decide trial: Asha Sen").click();
  await team.getByLabel("Reason").fill("Quick and composed");
  await team.getByRole("button", { name: "Record decision" }).click();
  await expect(team).toContainText("Squad: Asha Sen");
  await page.goto(at("faculty", "/outcomes"));
  const lab2 = page.getByRole("article", { name: "Lab 2 · Sorting algorithms" });
  await lab2.getByRole("button", { name: "Tag CO1" }).click();
  await expect(lab2.getByRole("button", { name: "Untag CO1" })).toBeVisible();

  // 7. HOD approves CO2 and reads attainment
  await signIn(page, "hod");
  await page.goto(at("hod", "/outcomes"));
  const co2 = page.getByRole("article", { name: "Introduction to Programming CO2" });
  await co2.getByLabel("Reason").fill("Measurable");
  await co2.getByRole("button", { name: "Record decision" }).click();
  await expect(co2.locator(".tag")).toHaveText("Approved");
  await page.goto(at("hod", "/outcomes") + `&offering=${f.offering}`);
  await expect(page.getByRole("table", { name: "Course outcome attainment" }).getByRole("row", { name: /^CO1 1 1 100 3$/ })).toBeVisible();
  await shot("07-hod-outcomes");

  // 8. Student sees the results
  await signIn(page, "student");
  await page.goto(at("student", "/sports"));
  await expect(page.getByRole("article", { name: "ECE XI", exact: true })).toContainText("Selected · Quick and composed");
  await expect(page.getByRole("table", { name: "Standings for Inter-department Football 2026" }).getByRole("row", { name: /^ECE XI 1 1 0 0 2 1 3$/ })).toBeVisible();
  await page.goto(at("student", "/"));
  await page.getByRole("region", { name: /Today.s classes/ }).getByRole("link", { name: "Introduction to Programming" }).first().click();
  await expect(page.locator("#class-details").getByText("Your attendance: present")).toBeVisible();
  await expect(page.getByRole("region", { name: "Attendance corrections", exact: true }).getByText("Decision: Register signature verified")).toBeVisible();
  await page.goto(at("student", "/history"));
  await expect(page.getByText("Lab 2 · Sorting algorithms").first()).toBeVisible();
  await shot("08-student-results");

  // 9. Office queue
  await signIn(page, "admin");
  await page.goto(at("admin", "/"));
  await openWorkflow(page, "Service requests");
  const record = page.getByRole("article").filter({ hasText: "Bonafide letter for a bank account" });
  await record.getByRole("button", { name: "Start review" }).click();
  await record.getByLabel("Outcome").fill("Letter is ready at the academic office.");
  await record.getByRole("button", { name: "Record outcome" }).click();
  await expect(record.getByText("Resolved", { exact: true })).toBeVisible();

  // 10. Certificate and public verification
  await page.goto(at("admin", "/certificates"));
  await page.locator("select[name=student]").selectOption({ label: "Asha Sen" });
  await page.getByRole("button", { name: "Prepare draft" }).click();
  const cert = page.getByRole("article", { name: "Bonafide (enrollment) for Asha Sen" }).first();
  await cert.getByRole("button", { name: "Issue certificate" }).click();
  await page.getByRole("dialog", { name: "Issue certificate" }).getByRole("button", { name: "Issue" }).click();
  const code = (await cert.getByText(/Verification code/).textContent())!.match(/[0-9A-F]{12}/)![0];
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(`/verify?code=${code}`);
  await expect(visitor.getByText("A. S.")).toBeVisible();

  // 11. Placement outcome
  await page.goto(at("admin", "/careers"));
  const applicant = page.getByRole("article", { name: "Asha Sen · Graduate engineer · campus drive" });
  await applicant.getByLabel("Note").fill("Interview on Monday");
  await applicant.getByRole("button", { name: "Record outcome" }).click();
  await expect(applicant.locator(".tag")).toHaveText("Shortlisted");
  await applicant.getByLabel("Outcome").selectOption({ label: "Offer recorded" });
  await applicant.getByLabel("Note").fill("Offer letter issued");
  await applicant.getByRole("button", { name: "Record outcome" }).click();
  await expect(applicant.locator(".tag")).toHaveText("Offer recorded");

  // 12. Lab booking approval
  await page.goto(at("admin", "/facilities"));
  const request = page.getByRole("article", { name: "ECE Lab 2 · Robot build" });
  await request.getByLabel("Reason").fill("Lab assistant on duty");
  await request.getByRole("button", { name: "Record decision" }).click();
  await expect(request.locator(".tag")).toHaveText("Approved");

  // 13. Principal
  await signIn(page, "principal");
  await page.goto(at("principal", "/"));
  await expect(page.getByRole("heading", { name: "Quality indicators" })).toBeVisible();
  await shot("13-principal");
  await page.goto(at("principal", "/decisions"));
  await expect(page.getByRole("heading", { name: "Decision simulation" })).toBeVisible();

  // 14. Isolation
  await signIn(page, "tenant");
  for (const path of ["/sports", "/careers", "/outcomes"]) {
    await page.goto(`${path}?institution=${f.otherInstitution}&role=student`);
    await expect(page.getByText(/ECE XI|Graduate engineer|CO1/)).toHaveCount(0);
  }
});
