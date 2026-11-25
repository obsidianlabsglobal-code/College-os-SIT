// Run only against a local production build and fictional accounts.
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { demoEmail, demoPassword, fixtures } from "./fixtures";

const [mode, output, origin] = process.argv.slice(2);
if (!output || !["before","after"].includes(mode) || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin ?? "")) {
  throw Error("Supply before or after, an evidence directory, and a loopback origin.");
}
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH});
declare global {
  interface Window { nexusLayoutShift:number; nexusLargestPaint:number | null }
}
const measurements = [];
const errors: string[] = [];
await mkdir(output,{recursive:true});
try {
  for (const role of ["student","faculty","hod","principal","admin"]) {
    const context = await browser.newContext({baseURL:origin,reducedMotion:"reduce",colorScheme:"light"});
    await context.addInitScript(() => {
      window.nexusLayoutShift = 0;
      window.nexusLargestPaint = null;
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & {hadRecentInput:boolean; value:number};
          if (!shift.hadRecentInput) window.nexusLayoutShift += shift.value;
        }
      }).observe({type:"layout-shift",buffered:true});
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) window.nexusLargestPaint = Math.round(entry.startTime);
      }).observe({type:"largest-contentful-paint",buffered:true});
    });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.name + ": " + error.message));
    await page.goto("/login");
    await page.getByLabel("Email").fill(demoEmail(role));
    await page.getByLabel("Password").fill(demoPassword);
    await page.getByRole("button",{name:"Sign in"}).click();
    await expect(page.getByRole("button",{name:"Sign out"})).toBeVisible();
    const routes = mode==="after" && role==="student" ? ["/","/timetable","/aura","/clubverse","/opportunities"] : ["/"];
    for (const path of routes) {
      const name = path === "/" ? role : path.slice(1);
      for (const scheme of mode==="before" ? ["light"] as const : ["light","dark"] as const) {
        await page.emulateMedia({colorScheme:scheme});
        const sizes = scheme==="dark" ? [[390,844],[1440,900]] :
          mode==="before" ? [[390,844],[768,1024],[1024,768],[1440,900]] :
          [[320,720],[390,844],[768,1024],[1024,768],[1440,900],[1920,1080]];
        for (const [width,height] of sizes) {
          await page.setViewportSize({width,height});
          const response = await page.goto(`${path}?institution=${fixtures.institution}&role=${role}`);
          if (response?.status() !== 200) throw Error(`Unavailable ${role} ${path}`);
          await expect(page.locator("main h1")).toHaveCount(1);
          await page.evaluate(()=>document.fonts.ready);
          await page.screenshot({path:join(output,`${name}-${width}-${scheme}.png`),animations:"disabled"});
          const metrics = await page.evaluate(()=>({
            overflow:document.documentElement.scrollWidth-innerWidth,
            layoutShiftThroughCapture:window.nexusLayoutShift,
            largestPaintMs:window.nexusLargestPaint,
            jsTransferBytes:performance.getEntriesByType("resource").filter(r=>r.name.includes(".js")).reduce((sum,r)=>sum+(r as PerformanceResourceTiming).transferSize,0),
            jsDecodedBytes:performance.getEntriesByType("resource").filter(r=>new URL(r.name).pathname.endsWith(".js")).reduce((sum,r)=>sum+(r as PerformanceResourceTiming).decodedBodySize,0),
            domReadyMs:Math.round((performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming).domContentLoadedEventEnd),
          }));
          measurements.push({role,path,width,height,scheme,...metrics});
        }
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
  await writeFile(join(output,"measurements.json"),JSON.stringify({measurements,errors},null,2));
}
if (errors.length || (mode==="after" && measurements.some(sample=>sample.overflow>0))) throw Error("Inspect the visual verification measurements.");
console.log(`Captured ${measurements.length} authenticated views.`);
