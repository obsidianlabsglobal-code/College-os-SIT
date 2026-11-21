import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { demoEmail, demoPassword } from "../scripts/fixtures";

async function signIn(page: Page, persona: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(demoEmail(persona));
  await page.getByLabel("Password").fill(demoPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
}

test("faculty, student and HOD use the persisted assignment workflow", async ({ page }) => {
  const title = `Programming exercise ${randomUUID().slice(0,8)}`;
  await signIn(page,"faculty");
  await page.getByRole("textbox",{ name:"Title", exact:true }).fill(title);
  await page.getByLabel("Instructions").fill("Explain why a loop terminates.");
  const tomorrow = new Date(Date.now() + 86_400_000);
  const deadline = new Intl.DateTimeFormat("sv-SE",{ dateStyle:"short", timeStyle:"short", timeZone:"Asia/Kolkata" }).format(tomorrow).replace(" ","T");
  await page.getByLabel(/Deadline/).fill(deadline);
  await page.getByLabel("Maximum marks").fill("20");
  await page.getByLabel(/Attachment/).setInputFiles({ name: "instructions.txt", mimeType: "text/plain", buffer: Buffer.from("Extra notes") });
  await page.getByRole("button",{ name: "Create draft" }).click();
  await expect(page.getByRole("heading",{ name:title })).toBeVisible();
  const facultyUrl = page.url();
  await page.getByRole("button",{ name: "Publish assignment" }).click();
  await expect(page.getByText("Published",{ exact:true })).toBeVisible();
  await signOut(page);

  await signIn(page,"outsider");
  await expect(page.getByRole("link",{ name:title })).toHaveCount(0);
  const denied = await page.goto(facultyUrl.replace("role=faculty","role=student"));
  expect(denied?.status()).toBe(404);
  await page.goto("/");
  await signOut(page);

  await signIn(page,"student");
  await page.getByRole("link",{ name:title }).click();
  await expect(page.getByRole("heading",{ name:title, exact:true })).toBeVisible();
  const studentUrl = page.url();
  const download = page.waitForEvent("download");
  await page.getByRole("link",{ name:"instructions.txt" }).click();
  expect((await download).suggestedFilename()).toBe("instructions.txt");
  await page.getByLabel("Response").fill("The loop counter reaches the bound.");
  let savedResponse: number | undefined;
  await page.route(studentUrl, async route => {
    const response = await route.fetch();
    await route.abort("connectionreset");
    savedResponse = response.status();
  }, { times: 1 });
  await page.getByRole("button",{ name:"Submit assignment" }).click();
  await expect.poll(() => savedResponse).toBe(200);
  await page.reload();
  await expect(page.getByRole("heading",{ name:"Submitted" })).toBeVisible();
  await signOut(page);

  await signIn(page,"faculty");
  await page.goto(facultyUrl);
  await page.getByLabel("Marks",{ exact:true }).fill("17");
  await page.getByLabel("Feedback").fill("Explain what happens at the boundary.");
  await page.getByRole("button",{ name:"Save grade draft" }).click();
  await expect(page.getByRole("button",{ name:"Publish feedback" })).toBeVisible();
  await signOut(page);

  await signIn(page,"student");
  await page.goto(studentUrl);
  await expect(page.getByText("Feedback has yet to be published.")).toBeVisible();
  await expect(page.getByText("Explain what happens at the boundary.")).toHaveCount(0);
  await signOut(page);

  await signIn(page,"faculty");
  await page.goto(facultyUrl);
  await page.getByRole("button",{ name:"Publish feedback" }).click();
  await expect(page.getByRole("heading",{ name:"Published result · 17/20" })).toBeVisible();
  await page.getByLabel("Marks",{ exact:true }).fill("18");
  await page.getByLabel("Correction reason").fill("Rubric reconciliation");
  await page.getByRole("button",{ name:"Save correction draft" }).click();
  await expect(page.getByRole("button",{ name:"Publish correction" })).toBeVisible();
  await page.getByRole("button",{ name:"Publish correction" }).click();
  await expect(page.getByRole("heading",{ name:"Published result · 18/20" })).toBeVisible();
  await signOut(page);

  await signIn(page,"student");
  await page.goto(studentUrl);
  await expect(page.getByRole("heading",{ name:"Published result · 18/20" })).toBeVisible();
  await signOut(page);

  await signIn(page,"hod");
  const report = page.getByRole("row",{ name:/Electronics and Communication Engineering/ });
  await expect(report).toBeVisible();
  for (let column = 0; column < 3; column++) {
    expect(Number(await report.getByRole("cell").nth(column).innerText())).toBeGreaterThan(0);
  }
  await expect(page.getByRole("row",{ name:/Mechanical Engineering/ })).toHaveCount(0);
});

test("a course notice and enrollment letter request reach the right users", async ({ page }) => {
  const unique = randomUUID().slice(0,8);
  const title = `Course notice ${unique}`;
  const request = `Scholarship application ${unique}`;
  await signIn(page,"faculty");
  await page.getByRole("link",{ name:"Notices", exact:true }).click();
  await expect(page.getByRole("heading",{ name:"Notices", exact:true })).toBeVisible();
  await page.getByRole("textbox",{ name:"Title", exact:true }).fill(title);
  await page.getByLabel("Notice",{ exact:true }).fill("Bring your lab notebook.");
  await expect(page.getByLabel("Title",{ exact:true })).toHaveValue(title);
  await page.getByRole("button",{ name:"Save notice draft" }).click();
  await expect(page.getByRole("status").filter({hasText:"Saved."})).toBeVisible();
  const notice = page.getByRole("article").filter({ hasText:title });
  await notice.getByRole("button",{ name:"Publish notice" }).click();
  await expect(notice.getByRole("button",{ name:"Publish notice" })).toHaveCount(0);
  await signOut(page);

  await signIn(page,"outsider");
  await page.getByRole("link",{ name:"Notices", exact:true }).click();
  await expect(page.getByRole("heading",{ name:title })).toHaveCount(0);
  await signOut(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page,"student");
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link",{ name:"Skip to content" })).toBeFocused();
  await page.getByRole("link",{ name:"Notices", exact:true }).click();
  await expect(page.getByRole("heading",{ name:title })).toBeVisible();
  await page.getByRole("link",{ name:"Workspace" }).click();
  await page.getByRole("link",{ name:"Service requests" }).click();
  await page.getByLabel("Purpose and delivery needs").fill(request);
  await page.getByRole("button",{ name:"Submit request" }).click();
  await expect(page.getByText(request)).toBeVisible();
  await signOut(page);

  await signIn(page,"admin");
  await page.getByRole("link",{ name:"Service requests" }).click();
  const record = page.getByRole("article").filter({ hasText:request });
  await record.getByRole("button",{ name:"Start review" }).click();
  await record.getByLabel("Outcome").fill("Letter is ready at the academic office.");
  await record.getByRole("button",{ name:"Record outcome" }).click();
  await expect(record.getByText("Resolved",{ exact:true })).toBeVisible();
  await signOut(page);

  await signIn(page,"student");
  await page.getByRole("link",{ name:"Service requests" }).click();
  await expect(record.getByText("Letter is ready at the academic office.")).toBeVisible();
  await signOut(page);

  await signIn(page,"principal");
  await expect(page.getByRole("heading",{ name:"Institution activity" })).toBeVisible();
  await expect(page.getByText("Open service requests",{ exact:true })).toBeVisible();
});

test("administrators configure academic records and manage delegated roles", async ({ page }) => {
  const suffix = randomUUID().slice(0,8);
  await signIn(page,"admin");
  await page.getByRole("link",{ name:"Academic setup and roles" }).click();
  await page.getByLabel("Department name").fill(`Engineering ${suffix}`);
  await page.getByRole("button",{ name:"Add department" }).click();
  const department = page.getByRole("combobox",{ name:"Department", exact:true });
  await department.selectOption({ label:`Engineering ${suffix}` });

  await page.getByLabel("Scheme name").fill(`Scheme ${suffix}`);
  await page.getByRole("button",{ name:"Add academic scheme" }).click();
  await page.getByRole("combobox",{ name:"Academic scheme", exact:true }).selectOption({ label:`Scheme ${suffix}` });
  await page.getByLabel("Term name").fill(`Term ${suffix}`);
  await page.getByRole("button",{ name:"Add term" }).click();
  await page.getByRole("combobox",{ name:"Term", exact:true }).selectOption({ label:`Term ${suffix}` });

  await department.selectOption({ label:`Engineering ${suffix}` });
  await page.getByLabel("Course name").fill(`Course ${suffix}`);
  await page.getByRole("button",{ name:"Add course" }).click();
  await page.getByLabel("Section name").fill(`Section ${suffix}`);
  await page.getByRole("button",{ name:"Add section" }).click();
  await page.getByRole("combobox",{ name:"Course", exact:true }).selectOption({ label:`Course ${suffix}` });
  await page.getByRole("combobox",{ name:"Section", exact:true }).selectOption({ label:`Section ${suffix}` });
  await page.getByRole("combobox",{ name:"Term", exact:true }).selectOption({ label:`Term ${suffix}` });
  await page.getByRole("button",{ name:"Add offering" }).click();

  const offering = page.getByRole("combobox",{ name:"Offering", exact:true });
  const label = `Course ${suffix} · Section ${suffix} · Term ${suffix}`;
  const [rosterPerson, rolePerson] = await page.getByRole("combobox",{ name:"Person", exact:true }).all();
  await offering.selectOption({ label });
  await rosterPerson.selectOption({ label:"Asha Sen" });
  await page.getByRole("combobox",{ name:"Roster role", exact:true }).selectOption("student");
  await page.getByRole("button",{ name:"Add to roster" }).click();
  const row = page.getByRole("listitem").filter({ hasText:label });
  await expect(row.getByText("Asha Sen",{ exact:true })).toBeVisible();
  await row.getByRole("button",{ name:"End access" }).click();
  await expect(row.getByText("Ended",{ exact:true })).toBeVisible();

  await rolePerson.selectOption({ label:"Asha Sen" });
  await page.getByRole("combobox",{ name:"Role", exact:true }).selectOption("hod");
  await page.getByRole("combobox",{ name:"Department (HOD only)", exact:true }).selectOption({ label:`Engineering ${suffix}` });
  await page.getByRole("button",{ name:"Assign role" }).click();
  const grant = page.getByRole("listitem").filter({ hasText:`hod · Engineering ${suffix}` });
  await expect(grant.getByText("Asha Sen",{ exact:true })).toBeVisible();
  await grant.getByRole("button",{ name:"End role" }).click();
  await expect(grant.getByText("Ended",{ exact:true })).toBeVisible();
});
