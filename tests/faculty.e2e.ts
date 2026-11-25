import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { demoEmail, demoPassword, fixtures } from "../scripts/fixtures";

// Fictional personas from the seed. Assertions target this run's assignment, because the
// shared local database accumulates records from earlier runs.

test.beforeEach(async ({ page }) => {
  const bytes = Buffer.from(randomUUID().replaceAll("-", ""), "hex");
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `198.${18 + bytes[0] % 2}.${bytes[1]}.${bytes[2]}` });
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

const workspace = (role: string) => `institution=${fixtures.institution}&role=${role}`;

test("faculty mission control leads from pending work through the evaluation queue to publication", async ({ page }) => {
  const title = `Queue journey ${randomUUID().slice(0, 8)}`;
  await signIn(page, "faculty");
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole("heading", { name: "What needs your attention" })).toBeVisible();
  const create = page.getByRole("link", { name: "Create assignment", exact:true });
  await expect(create).toBeInViewport();
  await create.press("Enter");
  await expect(page.getByRole("heading", {name:"Create assignment",exact:true})).toBeFocused();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill(title);
  await page.getByLabel("Instructions").fill("Trace the loop invariant.");
  const deadline = new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Kolkata" })
    .format(new Date(Date.now() + 86_400_000)).replace(" ", "T");
  await page.getByLabel(/Deadline/).fill(deadline);
  await page.getByLabel("Maximum marks").fill("10");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await page.goto(`/?${workspace("faculty")}`);
  const unpublished = page.getByRole("region", { name: "What needs your attention" }).getByRole("listitem").filter({ hasText: title }).last();
  await expect(unpublished.getByText("Not published")).toBeVisible();
  await unpublished.getByRole("link", { name: title }).click();
  await page.getByRole("button", { name: "Publish assignment" }).click();
  await expect(page.getByText("Published", { exact: true })).toBeVisible();
  await signOut(page);

  await signIn(page, "student");
  const denied = await page.goto(`/grading?${workspace("student")}`);
  expect(denied?.status()).toBe(404);
  const forged = await page.goto(`/grading?${workspace("faculty")}`);
  expect(forged?.status()).toBe(404);
  await page.goto(`/?${workspace("student")}`);
  await page.getByRole("region", {name:"My assignments",exact:true}).getByRole("link", { name: title,exact:true }).click();
  await page.getByLabel("Response").fill("The invariant holds before and after each iteration.");
  await page.getByRole("button", { name: "Submit assignment" }).click();
  await expect(page.getByRole("heading", { name: "Submitted" })).toBeVisible();
  await signOut(page);

  await signIn(page, "faculty");
  const cards = page.getByRole("navigation", { name: "Teaching overview" });
  await expect(cards.getByRole("link")).toHaveCount(4);
  await expect(cards.getByRole("link",{name:/Pending evaluations/})).toHaveAttribute("href",/\/grading\?.*role=faculty.*status=pending/);
  await expect(cards.getByRole("link",{name:/Private feedback drafts/})).toHaveAttribute("href",/\/grading\?.*role=faculty.*status=awaiting/);
  if (process.env.NEXUS_ACADEMIC_SCREENSHOTS) {
    for (const width of [390,1440]) {
      await page.setViewportSize({width,height:900});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
      await page.screenshot({path:`${process.env.NEXUS_ACADEMIC_SCREENSHOTS}/faculty-${width}.png`,fullPage:true});
    }
  }
  const progress = page.getByRole("region", { name: "Assignment progress" }).getByRole("listitem").filter({ hasText: title });
  await expect(progress.getByText(/1 of \d+ enrolled students? submitted/)).toBeVisible();
  await progress.getByRole("link", { name: "1 awaiting evaluation" }).click();
  await expect(page.getByRole("heading", { name: "Evaluation queue" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Campus workflows" }).getByRole("link", { name: "Evaluation queue" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("navigation", { name: "Queue status" }).getByRole("link", { name: /Awaiting evaluation/ })).toHaveAttribute("aria-current", "page");
  const row = page.getByRole("listitem").filter({ hasText: "Asha Sen" });
  await expect(row).toHaveCount(1);
  const evaluate = row.getByRole("link", { name: `Evaluate submission by Asha Sen for ${title}` });
  await evaluate.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/submission=/);
  const focusedUrl = page.url();
  await expect(page.getByRole("heading", { name: "Asha Sen" })).toBeVisible();
  await expect(page.getByText("Awaiting evaluation", { exact: true })).toBeVisible();
  await page.getByLabel("Marks", { exact: true }).fill("8");
  await page.getByLabel("Feedback").fill("Clear invariant. State the termination argument.");
  await page.getByRole("button", { name: "Save grade draft" }).click();
  await expect(page.getByText("Draft awaiting publication", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByText("Draft awaiting publication", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Open in evaluation queue" }).click();
  const awaiting = page.getByRole("navigation", { name: "Queue status" }).getByRole("link", { name: /Awaiting publication/ });
  await awaiting.click();
  const drafted = page.getByRole("listitem").filter({ hasText: "Asha Sen" });
  await expect(drafted.getByText("Draft 8/10")).toBeVisible();
  await expect(drafted.getByText("Published", { exact: false })).toHaveCount(0);
  await drafted.getByRole("link", { name: /Review draft/ }).click();
  await page.getByRole("button", { name: "Publish feedback" }).click();
  await expect(page.getByText("Published result · 8/10")).toBeVisible();
  await page.getByRole("link", { name: "Open in evaluation queue" }).click();
  await page.getByRole("navigation", { name: "Queue status" }).getByRole("link", { name: /^Has a published result/ }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Asha Sen" }).getByText("Published 8/10")).toBeVisible();
  expect(page.url()).toContain("assignment=");
  await page.goto(`${page.url()}&offering=${fixtures.otherOffering}`);
  await expect(page).toHaveURL(/assignment=/);
  await expect(page.getByText("The selected assignment belongs to a different course.")).toBeVisible();
  await page.getByRole("link", { name: "Clear assignment filter" }).click();
  await expect(page).not.toHaveURL(/assignment=/);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await signOut(page);

  await signIn(page, "replacement");
  const unrostered = await page.goto(focusedUrl);
  expect(unrostered?.status()).toBe(404);
  await page.goto(`/grading?${workspace("faculty")}&status=all`);
  await expect(page.getByText(title)).toHaveCount(0);
  await expect(page.getByText("You have no active teaching assignments in this workspace.")).toBeVisible();
});

test("the evaluation queue rejects malformed filters without failing", async ({ page }) => {
  await signIn(page, "faculty");
  const response = await page.goto(`/grading?${workspace("faculty")}&status=%27OR1&sort=drop&page=-3&assignment=nope`);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("navigation", { name: "Queue status" }).getByRole("link", { name: /Awaiting evaluation/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByLabel("Sort")).toHaveValue("oldest");
  await expect(page.getByText("That page number is invalid.")).toBeVisible();
  await page.goto(`/grading?${workspace("faculty")}&status=all&page=1001`);
  await expect(page).toHaveURL(/page=1001/);
  await expect(page.getByText("This page is past the end of the results.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to the last page" })).toHaveAttribute("href", /status=all.*page=/);
  const outsideTenant = await page.goto(`/grading?institution=${fixtures.otherInstitution}&role=faculty`);
  expect(outsideTenant?.status()).toBe(404);
});

test("compact assignment and searchable choices work on mobile with the keyboard", async ({ page }) => {
  await import("../scripts/environment");
  const migrationUrl = process.env.MIGRATION_DATABASE_URL;
  if (!migrationUrl || !["127.0.0.1","localhost"].includes(new URL(migrationUrl).hostname)) {
    throw new Error("Local test database required.");
  }
  const { Client } = await import("pg");
  const connect = async () => {
    const client = new Client({ connectionString: migrationUrl });
    await client.connect();
    return client;
  };
  const owner = await connect();
  const token = randomUUID().slice(0,8);
  const title = `Compact workshop ${token}`;
  let assignment = "";
  // Remove this test's fictional rows so repeated local runs do not fill the demo faculty queue.
  const cleanup = async () => {
    const client = await connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM attachment WHERE institution_id=$1 AND submission_id IN
        (SELECT id FROM submission WHERE institution_id=$1 AND assignment_id=$2)`, [fixtures.institution, assignment]);
      await client.query("DELETE FROM submission WHERE institution_id=$1 AND assignment_id=$2", [fixtures.institution, assignment]);
      await client.query("DELETE FROM assignment WHERE institution_id=$1 AND id=$2", [fixtures.institution, assignment]);
      await client.query(`DELETE FROM "user" WHERE id LIKE $1 AND email LIKE '%@nexus.example.invalid'`, [`${token}-%`]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      await client.end();
    }
  };
  try {
    const {rows:[record]} = await owner.query<{id:string}>(`INSERT INTO assignment
      (institution_id,offering_id,title,description,deadline,max_marks,published_at)
      VALUES ($1,$2,$3,'Fictional instructions',now()+interval '1 day',20,now()) RETURNING id`,
    [fixtures.institution,fixtures.offering,title]);
    assignment = record.id;
    await owner.query(`INSERT INTO "user" (id,name,email,"emailVerified")
      SELECT $1||'-'||n,'Fictional learner '||n,$1||'-'||n||'@nexus.example.invalid',false FROM generate_series(1,23) n`,[token]);
    await owner.query(`INSERT INTO submission (institution_id,assignment_id,student_id,body,submitted_at,request_id)
      SELECT $1,$2,$3||'-'||n,'Private response '||n,now()+n*interval '1 second',gen_random_uuid()
      FROM generate_series(1,23) n`,[fixtures.institution,assignment,token]);
    await owner.query(`INSERT INTO attachment (institution_id,submission_id,filename,mime,bytes)
      SELECT institution_id,id,student_id||'.txt','text/plain','fixture' FROM submission
      WHERE (institution_id,assignment_id)=($1,$2)`,[fixtures.institution,assignment]);
  } finally {
    await owner.end();
  }

  try {
    await page.setViewportSize({width:390,height:844});
    await signIn(page,"faculty");
    await page.goto(`/assignments/${assignment}?${workspace("faculty")}`);
    await expect(page.getByText("Showing the first 20 submissions. Open the evaluation queue for all 23 submissions.")).toBeVisible();
    await expect(page.getByRole("link", {name:/Evaluate submission by Fictional learner/})).toHaveCount(20);
    await expect(page.getByText(/Private response/)).toHaveCount(0);
    await expect(page.getByRole("link",{name:/\.txt$/})).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);

    const first = page.getByRole("link",{name:"Evaluate submission by Fictional learner 1",exact:true});
    await first.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Private response 1",{exact:true})).toBeVisible();
    await expect(page.getByRole("link",{name:`${token}-1.txt`})).toBeVisible();
    await expect(page.getByRole("link",{name:`${token}-2.txt`})).toHaveCount(0);

    await page.getByRole("link",{name:"Open in evaluation queue"}).click();
    const search = page.getByRole("searchbox",{name:"Find assignments by title"});
    await search.focus();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("combobox",{name:"Assignment",exact:true})).toBeFocused();
    await search.fill(token);
    await search.press("Enter");
    await expect(page.getByRole("combobox",{name:"Assignment",exact:true})).toHaveValue(assignment);
    await expect(page.getByRole("option",{name:new RegExp(title)})).toHaveCount(1);
    await expect(page.getByRole("heading",{name:"Evaluation queue"})).toBeVisible();
    for (const width of [360,390,768,1024,1440]) {
      await page.setViewportSize({width,height:844});
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    }
    if (process.env.NEXUS_FACULTY_SCREENSHOTS) {
      await page.screenshot({path:`${process.env.NEXUS_FACULTY_SCREENSHOTS}/queue-desktop.png`});
      await page.setViewportSize({width:390,height:844});
      await page.screenshot({path:`${process.env.NEXUS_FACULTY_SCREENSHOTS}/queue-mobile.png`});
    }
  } finally {
    if (assignment) await cleanup();
  }
});
