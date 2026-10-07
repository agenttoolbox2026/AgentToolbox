// External paths select the already-installed local browser tooling, not a user profile.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.AGI_PLAYWRIGHT_MODULE??'playwright');
const origin=process.argv[2]??'http://127.0.0.1:8791',destination=process.argv[3]??'/tmp/agenttoolbox-agi-browser';
await mkdir(destination,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.AGI_BROWSER_EXECUTABLE?{executablePath:process.env.AGI_BROWSER_EXECUTABLE}:{})});
const results=[];
try{
 for(const [name,viewport]of Object.entries({desktop:{width:1440,height:1050},mobile:{width:390,height:844}})){
  const context=await browser.newContext({viewport,javaScriptEnabled:false});
  const page=await context.newPage();
  for(const route of ['/','/sell','/buy','/tools/docs-pack','/tools/quote-proof','/tools/contract-cases','/tools/mcp-wirecheck','/humans']){
   const response=await page.goto(origin+route);assert.equal(response.status(),200);assert.equal(await page.title(),'AgentToolbox');
   await page.getByRole('navigation',{name:'Main navigation',exact:true}).getByRole('link',{name:'For Humans'}).waitFor();
   assert.equal(await page.locator('script').count(),0);
   const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,header:getComputedStyle(document.querySelector('header')).backgroundColor,bg:getComputedStyle(document.documentElement).backgroundColor}));
   assert(layout.scroll<=layout.width+1,`${name}${route} overflow ${JSON.stringify(layout)}`);assert.equal(layout.header,route==='/humans'?'rgb(0, 0, 0)':'rgb(255, 255, 255)');
   if(route==='/'){
    assert.equal(await page.locator('details,.tool-card').count(),0);
    assert.equal(await page.locator('#buy-tools').count(),1);
    assert.equal(await page.locator('#sell-tools').count(),1);
   }
   // Native details clicks may scroll the viewport. Reset before a full-page
   // capture so fixed accessibility controls are not composited mid-document.
   await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
   await page.screenshot({path:destination+'/'+name+(route==='/'?'-home':route.replaceAll('/','-'))+'.png',fullPage:true});
   if(route==='/'||route==='/humans')await page.screenshot({path:destination+'/'+name+(route==='/'?'-home':'-humans')+'-viewport.png'});
   const invalidLinks=await page.locator('a[href]').evaluateAll(links=>links.filter(a=>/^javascript:/i.test(a.getAttribute('href'))).length);assert.equal(invalidLinks,0);
   results.push({viewport:name,route,status:response.status(),javascript:false,no_horizontal_overflow:true});
  }
  await page.goto(origin+'/');await page.getByRole('navigation',{name:'Main navigation',exact:true}).getByRole('link',{name:'For Humans'}).click();assert.equal(page.url(),origin+'/humans');
  await page.goto(origin+'/');await page.getByRole('link',{name:'Sell tools',exact:true}).click();assert.equal(new URL(page.url()).hash,'#sell-tools');
  await context.close();
 }
 await writeFile(destination+'/checks.json',JSON.stringify({origin,checked_at:new Date().toISOString(),results,positive_live_mutations:0},null,2)+'\n');
 console.log(JSON.stringify({origin,checks:results.length,javascript:false,screenshot_directory:destination}));
}finally{await browser.close();}
