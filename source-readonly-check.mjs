// Explicitly requested, single-navigation collection diagnostic. No business writes.
import fs from'node:fs/promises';
import{chromium}from'./app/cloud-trial/node_modules/playwright/index.mjs';
import{readPublicPage}from'./app/cloud-trial/stage1.mjs';
import{browserLaunchOptions}from'./app/hourly/browser-runtime.mjs';
import{sources}from'./app/market-sources.mjs';
const source=sources.find(s=>s.id==='8591-aov-501-1000');if(!source)throw Error('fixed_source_missing');
const startedAt=new Date().toISOString(),captures=[];let browser;
try{browser=await chromium.launch(browserLaunchOptions({MARKET_BROWSER_CHANNEL:'chrome'}));const version=browser.version(),context=await browser.newContext({locale:'zh-TW',timezoneId:'Asia/Taipei',viewport:{width:1280,height:900}}),page=await context.newPage();
 const result=await readPublicPage(page,source.url,'list',async c=>captures.push(c),()=>new Date().toISOString(),{maxListScrolls:0,retryTransientList:false,browserVersion:version});
 const report={startedAt,finishedAt:new Date().toISOString(),sourceId:source.id,status:result.status,httpStatus:result.httpStatus,title:result.title,exactUrl:result.actualUrl===source.url,listingCount:result.listings.length,browserVersion:version,navigationBudget:1,detailNavigations:0,aiCalls:0,discordWrites:0,businessStateWrites:0,diagnostic:result.navigationDiagnostic};
 await fs.writeFile('source-check.private.json',JSON.stringify({report,captures}));await page.screenshot({path:'source-check.private.png',timeout:7000}).catch(()=>{});console.log(JSON.stringify({event:'single_source_collection_check',...report}));
}finally{await browser?.close();}
