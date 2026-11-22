/** Operator-run against a dedicated fictional staging alias. Uses only public UI and scoped downloads. */
import { chromium, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { demoEmail, demoPassword, fixtures } from "./fixtures";

const url = new URL(process.env.RELEASE_URL ?? "");
const local = ["localhost","127.0.0.1"].includes(url.hostname);
if (url.href !== url.origin + "/" || (!local && url.protocol !== "https:") ||
    process.env.NEXUS_ACCEPTANCE_HOST !== url.host) throw Error("Confirm the exact fictional staging host.");
const password = local ? demoPassword : process.env.NEXUS_DEMO_PASSWORD;
if (!password || (!local && (password.length < 24 || password === demoPassword))) throw Error("Set the fictional staging password.");
const run = process.env.NEXUS_ACCEPTANCE_RUN ?? randomUUID();
if (!/^[a-zA-Z0-9-]{8,64}$/.test(run)) throw Error("Invalid run identifier.");
const mode = process.argv[2];
if (!["exercise","verify"].includes(mode) || (mode === "verify" && !process.env.NEXUS_ACCEPTANCE_RUN)) throw Error("Use exercise, or verify with an existing run identifier.");
const title = `Release acceptance ${run}`;
const fileBytes = `Fictional attachment for ${run}`;
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH});
try {
  const context = await browser.newContext({baseURL:url.origin,serviceWorkers:"block"});
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass) {
    const handshake = await context.request.get(new URL("/api/health",url).href,{
      maxRedirects:0, headers:{"x-vercel-protection-bypass":bypass,"x-vercel-set-bypass-cookie":"true"},
    });
    if (handshake.status() >= 400 || !(await context.cookies()).length) throw Error("Staging protection handshake failed.");
  }
  await context.route("**/*", async route => {
    if (new URL(route.request().url()).origin !== url.origin) return route.abort();
    return route.continue();
  });
  const page = await context.newPage();
  async function login(persona:string) {
    const logout = page.getByRole("button",{name:"Sign out"});
    if (await logout.isVisible()) {
      await logout.click();
      await expect(page.getByRole("heading",{name:"Sign in"})).toBeVisible();
    }
    await page.goto("/login");
    await page.getByLabel("Email").fill(demoEmail(persona));
    await page.getByLabel("Password").fill(password!);
    await page.getByRole("button",{name:"Sign in"}).click();
    await expect(page.getByRole("button",{name:"Sign out"})).toBeVisible();
  }
  const button = (name:string) => page.getByRole("button",{name,exact:true});
  const link = (name:string) => page.getByRole("link",{name,exact:true});
  const request = page.getByRole("article").filter({hasText:title});
  const result = "Ready for fictional pickup";
  console.log(`Acceptance run ${run} (${mode})`);
  await login("faculty");
  if (mode === "exercise") {
    await expect(link(title)).toHaveCount(0);
    await page.getByLabel("Title",{exact:true}).fill(title);
    await page.getByLabel("Instructions").fill("Explain the loop boundary.");
    const due = new Date(Date.now()+2*86400000);
    await page.getByLabel(/Deadline/).fill(new Intl.DateTimeFormat("sv-SE",{dateStyle:"short",timeStyle:"short",timeZone:"Asia/Kolkata"}).format(due).replace(" ","T"));
    await page.getByLabel("Maximum marks").fill("20");
    await page.getByLabel(/Attachment/).setInputFiles({name:"evidence.txt",mimeType:"text/plain",buffer:Buffer.from(fileBytes)});
    await button("Create draft").click();
    await button("Publish assignment").click();
    await expect(page.getByText("Published",{exact:true})).toBeVisible();
  }
  await login("student");
  const studentURL = await link(title).getAttribute("href");
  if (!studentURL?.startsWith("/assignments/")) throw Error("Missing assignment reference.");
  await link(title).click();
  const fileURL = new URL((await link("evidence.txt").getAttribute("href"))!,url.origin);
  if (fileURL.origin !== url.origin) throw Error("Unexpected file origin.");
  const fileRequest = () => context.request.get(fileURL.href,{maxRedirects:0});
  const download = await fileRequest();
  expect(download.status()).toBe(200);
  expect(await download.text()).toBe(fileBytes);
  expect(download.headers()["cache-control"]).toContain("private");
  if (mode === "exercise") {
    await page.getByLabel("Response").fill("The loop ends at the upper bound.");
    await button("Submit assignment").click();
    await expect(page.getByRole("heading",{name:"Submitted"})).toBeVisible();
    await login("faculty");
    await link(title).click();
    await page.getByLabel("Marks",{exact:true}).fill("17");
    await page.getByLabel("Feedback").fill("The boundary is correct.");
    await button("Save grade draft").click();
    await expect(button("Publish feedback")).toBeVisible();
    await login("student");
    await page.goto(studentURL);
    await expect(page.getByText("Feedback has yet to be published.")).toBeVisible();
    await login("faculty");
    await link(title).click();
    await button("Publish feedback").click();
    await expect(page.getByRole("heading",{name:"Published result · 17/20"})).toBeVisible();
  }
  await login("student");
  await page.goto(studentURL);
  await expect(page.getByRole("heading",{name:"Published result · 17/20"})).toBeVisible();
  await page.goto("/");
  await link("Service requests").click();
  if (mode === "exercise") {
    await page.getByLabel("Purpose and delivery needs").fill(title);
    await button("Submit request").click();
    await expect(request).toBeVisible();
  }
  await login("admin");
  await link("Service requests").click();
  if (mode === "exercise") {
    await request.getByRole("button",{name:"Start review"}).click();
    await request.getByLabel("Outcome").fill(result);
    await request.getByRole("button",{name:"Record outcome"}).click();
  }
  await expect(request.getByText("Resolved",{exact:true})).toBeVisible();
  await login("student");
  await link("Service requests").click();
  await expect(request.getByText(result)).toBeVisible();
  for (const persona of ["outsider","tenant"]) {
    await login(persona);
    await expect(link(title)).toHaveCount(0);
    if (persona === "tenant") fileURL.searchParams.set("institution",fixtures.otherInstitution);
    expect((await fileRequest()).status()).toBe(404);
  }
  await login("hod");
  const department = page.getByRole("row",{name:/Electronics and Communication Engineering/});
  expect(Number(await department.getByRole("cell").nth(2).innerText())).toBeGreaterThan(0);
  await expect(page.getByRole("row",{name:/Mechanical Engineering/})).toHaveCount(0);
  await login("principal");
  await expect(page.getByRole("heading",{name:"Institution activity"})).toBeVisible();
  expect(Number(await page.locator("dt").filter({hasText:"Published results"}).locator("xpath=following-sibling::dd[1]").innerText())).toBeGreaterThan(0);
  console.log(`Verified five roles, section and tenant denials, exact private file, published grade and resolved request for ${run}.`);
} finally {
  await browser.close();
}
