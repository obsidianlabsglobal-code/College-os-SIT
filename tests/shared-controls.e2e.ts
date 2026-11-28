import { expect,test } from "@playwright/test";
import {demoEmail,demoPassword} from "../scripts/fixtures";

test("shared controls are readable and keyboard-operable on five fictional role entry points",async ({browser})=>{
  const roles=[
    {name:"student",heading:"Good to see you, Asha."},{name:"faculty",heading:"Faculty"},
    {name:"hod",heading:"Department head"},{name:"admin",heading:"Institution admin"},{name:"principal",heading:"Principal"},
  ];
  for (const [index,{name,heading}] of roles.entries()){
    const context=await browser.newContext({baseURL:"http://127.0.0.1:3000",viewport:{width:320,height:844},
      colorScheme:index%2 ? "dark":"light",reducedMotion:"reduce",extraHTTPHeaders:{"x-forwarded-for":`198.19.211.${index+9}`}});
    try{
      const page=await context.newPage();
      await page.goto("/login");
      const signIn=page.getByRole("button",{name:"Sign in"});
      await expect.poll(async()=>(await signIn.boundingBox())?.height??0).toBeGreaterThanOrEqual(44);
      await page.getByLabel("Email").fill(demoEmail(name));
      await page.getByLabel("Password").fill(demoPassword);
      await signIn.press("Enter");
      await expect(page.getByRole("heading",{name:heading,exact:true})).toBeVisible();
      const signOut=page.getByRole("button",{name:"Sign out"});
      await signOut.focus();
      await expect(signOut).toBeFocused();
      expect(await signOut.evaluate(button=>{
        const css=getComputedStyle(button);return css.outlineStyle==="solid" && parseFloat(css.outlineWidth)>=2;
      })).toBe(true);
      for(const width of [320,1440]){
        await page.setViewportSize({width,height:844});
        expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
      }
    }finally{await context.close();}
  }
});
