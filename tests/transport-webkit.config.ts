import {defineConfig,devices} from "@playwright/test";
export default defineConfig({
  testDir:".",testMatch:"transport-iphone.e2e.ts",timeout:75000,workers:1,
  use:{...devices["iPhone 13"],viewport:{width:390,height:844},browserName:"webkit",baseURL:"http://127.0.0.1:3000",serviceWorkers:"block"},
  webServer:{command:"npm run start -- --hostname 127.0.0.1",url:"http://127.0.0.1:3000/api/health",cwd:process.cwd(),timeout:120000,reuseExistingServer:false},
});
