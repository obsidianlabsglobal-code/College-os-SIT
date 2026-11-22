import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { demoEmail, demoPassword } from "../scripts/fixtures";

function testClientHeaders() {
  const bytes = Buffer.from(randomUUID().replaceAll("-", ""), "hex");
  return { "x-forwarded-for": `198.${18 + bytes[0] % 2}.${bytes[1]}.${bytes[2]}` };
}

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders(testClientHeaders());
});

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
  const adminUrl = page.url();
  await signOut(page);
  await signIn(page, "student");
  await page.getByRole("combobox", { name: "Workspace" }).selectOption({ label: "Northfield Institute · Fictional demo · Department head" });
  await page.getByRole("button", { name: "Switch", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Department head", exact: true })).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Department head", exact: true })).toBeVisible();
  await signOut(page);
  await signIn(page, "admin");
  await page.goto(adminUrl);
  await grant.getByRole("button",{ name:"End role" }).click();
  await expect(grant.getByText("Ended",{ exact:true })).toBeVisible();
  await signOut(page);
  await signIn(page, "student");
  await expect(page.getByRole("heading", { name: "Student", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Workspace" })).toHaveCount(0);
});

test("the sign-in form observes PostgreSQL-backed throttling", async ({ page, playwright, baseURL }) => {
  const extraHTTPHeaders = testClientHeaders();
  const api = await playwright.request.newContext({ baseURL, extraHTTPHeaders });
  try {
    for (let attempt = 0; attempt < 20; attempt++) {
      const response = await api.post("/api/auth/sign-in/email", {
        data: { email: demoEmail("student"), password: "wrong-for-test" },
      });
      expect(response.status()).toBe(401);
    }
    await page.setExtraHTTPHeaders(extraHTTPHeaders);
    await page.goto("/login");
    await page.getByLabel("Email").fill(demoEmail("student"));
    await page.getByLabel("Password").fill(demoPassword);
    await page.getByRole("button", { name:"Sign in" }).click();
    await expect(page.getByText("Too many attempts. Try again shortly.")).toBeVisible();
  } finally {
    await api.dispose();
  }
});

test("workspace navigation is scoped, keyboard-operable and responsive", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, "student");
  const navigation = page.getByRole("navigation", { name: "Campus workflows" });
  await expect(navigation.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
  await expect(navigation.getByRole("link", { name: "Academic setup and roles" })).toHaveCount(0);
  const toggle = page.getByRole("button", { name: "Hide navigation" });
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(navigation).toBeHidden();
  await expect(page.getByRole("button", { name: "Show navigation" })).toHaveAttribute("aria-expanded", "false");
  await page.setViewportSize({ width: 390, height: 844 });
  const notices = navigation.getByRole("link", { name: "Notices" });
  await expect(notices).toBeVisible();
  expect(await notices.evaluate(link => getComputedStyle(link).transitionDuration)).toBe("0s");
  await notices.click();
  await expect(navigation.getByRole("link", { name: "Notices" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test("CLUBVERSE recognition, membership, event and leadership journeys persist", async ({ page }) => {
  const name = `Robotics workshop club ${randomUUID().slice(0,8)}`;
  const title = "Planetary rover workshop";
  const visitDirectory = async () => {
    await page.getByRole("navigation",{ name:"Campus workflows" }).getByRole("link",{ name:"CLUBVERSE",exact:true }).click();
    await expect(page.getByRole("heading",{ name:"CLUBVERSE",exact:true })).toBeVisible();
  };
  const openClub = async () => {
    await page.getByRole("link",{ name,exact:true }).click();
    await expect(page.getByRole("heading",{ name,exact:true })).toBeVisible();
  };
  const proposal = page.getByRole("article").filter({ has:page.getByRole("heading",{ name,exact:true }) });
  const event = page.getByRole("article").filter({ has:page.getByRole("heading",{ name:title,exact:true }) });
  const transition = async (value: string) => {
    await event.getByRole("combobox",{ name:"Next event status" }).selectOption(value);
    await event.getByRole("button",{ name:"Update event status" }).click();
    await expect(event.locator(".tag")).toHaveText(value.replaceAll("_"," "));
  };

  await signIn(page,"faculty");
  await visitDirectory();
  await page.getByLabel("Club name").fill(name);
  await page.getByRole("textbox",{ name:"Purpose",exact:true }).fill("Build robotic prototypes collaboratively.");
  await page.getByLabel("Membership rules and planned activities").fill("Workshop members attend a safety briefing.");
  await page.getByRole("button",{ name:"Save club draft" }).click();
  await proposal.getByRole("button",{ name:"Submit proposal" }).click();
  await expect(proposal.locator(".tag")).toHaveText("submitted");
  await signOut(page);

  await signIn(page,"admin");
  await visitDirectory();
  await proposal.getByRole("button",{ name:"Start review" }).click();
  await proposal.getByRole("button",{ name:"Record decision" }).click();
  await expect(page.getByRole("link",{ name,exact:true })).toBeVisible();
  await signOut(page);

  await page.setViewportSize({ width:390,height:844 });
  await signIn(page,"student");
  await visitDirectory();
  await page.getByRole("searchbox",{ name:"Search clubs" }).fill(name);
  await page.getByRole("button",{ name:"Apply filters" }).click();
  await openClub();
  await page.getByRole("button",{ name:"Request membership" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Membership · requested")).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
  await signOut(page);

  await page.setViewportSize({ width:1440,height:900 });
  await signIn(page,"faculty");
  await visitDirectory();
  await openClub();
  const student = page.getByRole("listitem").filter({ hasText:"Asha Sen" });
  await student.getByRole("button",{ name:"Review membership" }).click();
  await expect(student).toContainText("active");
  const stamp = (offset:number) => new Intl.DateTimeFormat("sv-SE",{
    dateStyle:"short",timeStyle:"short",timeZone:"Asia/Kolkata",
  }).format(new Date(Date.now()+offset)).replace(" ","T");
  await page.getByLabel("Event title").fill(title);
  await page.getByLabel("Location").fill("Electronics lab");
  await page.getByLabel(/Starts/).fill(stamp(3600000));
  await page.getByLabel(/Ends/).fill(stamp(7200000));
  await page.getByLabel("Capacity",{ exact:true }).fill("1");
  await page.getByLabel("Requirements and event plan").fill("Bring a laptop.");
  await page.getByRole("button",{ name:"Save event draft" }).click();
  await expect(event.locator(".tag")).toHaveText("draft");
  await transition("pending_approval");
  await signOut(page);

  await signIn(page,"admin");
  await visitDirectory();
  await openClub();
  await transition("approved");
  await signOut(page);

  await signIn(page,"faculty");
  await visitDirectory();
  await openClub();
  await transition("published");
  await transition("registration_open");
  await signOut(page);

  await signIn(page,"student");
  await visitDirectory();
  await openClub();
  await expect(page.getByRole("heading",{ name:"Member area" })).toBeVisible();
  await expect(page.getByRole("heading",{ name:"Organizer console" })).toHaveCount(0);
  await event.getByRole("button",{ name:"Register for event" }).click();
  await expect(event.getByText("Registered · participation unverified")).toBeVisible();
  await signOut(page);

  await signIn(page,"faculty");
  await visitDirectory();
  await openClub();
  await expect(event.getByText("1 registered · 0 verified participants")).toBeVisible();
  await transition("registration_closed");
  // Move only this fictional fixture into its scheduled interval without a wall-clock wait.
  await import("../scripts/environment");
  const migrationUrl = process.env.MIGRATION_DATABASE_URL;
  if (!migrationUrl || !["127.0.0.1","localhost"].includes(new URL(migrationUrl).hostname)) throw new Error("Local test database required.");
  const { Client } = await import("pg");
  const connection = new Client({ connectionString:migrationUrl });
  await connection.connect();
  try {
    const club = new URL(page.url()).pathname.split("/").at(-1);
    await connection.query("UPDATE club_event SET starts_at=now()-interval '1 minute' WHERE club_id=$1 AND title=$2",[club,title]);
  } finally {
    await connection.end();
  }
  await transition("in_progress");
  await event.getByText("Participants and evidence",{ exact:true }).click();
  await event.getByLabel("Attendance evidence").fill("Checked in at the lab.");
  await event.getByRole("button",{ name:"Verify participation" }).click();
  await expect(event.getByText("1 registered · 1 verified participants")).toBeVisible();
  await transition("completed");
  await page.getByRole("combobox",{ name:"Incoming lead" }).selectOption({ label:"Asha Sen" });
  await page.getByLabel("Handover documentation").fill("Keep the approved workshop schedule.");
  await page.getByRole("button",{ name:"Submit handover" }).click();
  await expect(page.getByText("Asha Sen · Awaiting approval")).toBeVisible();
  await signOut(page);

  await signIn(page,"admin");
  await visitDirectory();
  await openClub();
  await page.getByRole("button",{ name:"Approve leadership transfer" }).click();
  await expect(page.getByText("Asha Sen · Approved")).toBeVisible();
  await signOut(page);
  await signIn(page,"student");
  await visitDirectory();
  await openClub();
  await expect(page.getByRole("heading",{ name:"Organizer console" })).toBeVisible();
  await expect(event.getByText("Participation verified")).toBeVisible();
  await expect(page.getByText("Keep the approved workshop schedule.")).toBeVisible();
});
