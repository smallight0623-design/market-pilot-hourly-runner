// Bounded controller diagnostic. Ordinary Chrome, no spoofing or retries.
import {spawn,execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {chromium} from './app/cloud-trial/node_modules/playwright/index.mjs';
const comparisonRequire=createRequire(new URL('./comparison-client/package.json',import.meta.url));
const {default:puppeteer}=await import(pathToFileURL(comparisonRequire.resolve('puppeteer-core')).href);

const target=new URL(process.env.TEST_URL);
if(target.protocol!=='https:'||target.username||target.password)throw Error('https_public_target_required');
const executable=execFileSync('which',['google-chrome'],{encoding:'utf8'}).trim();
const commonArgs=['--headless=new','--enable-automation','--no-sandbox','--no-first-run','--no-default-browser-check','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--window-size=1280,900','--lang=zh-TW'];
const report={event:'browser_controller_comparison',startedAt:new Date().toISOString(),targetHost:target.hostname,launchArgs:commonArgs,tools:[],siteNavigationBudget:2,automaticRetries:0,aiCalls:0,discordWrites:0,businessStateWrites:0};
const safeHeaders=(h,keys)=>Object.fromEntries(keys.filter(k=>h[k]).map(k=>[k,String(h[k]).slice(0,400)]));

for(const tool of ['playwright','puppeteer']){
  const row={tool,startedAt:new Date().toISOString()};report.tools.push(row);
  const profile=await fs.mkdtemp(path.join(os.tmpdir(),'controller-check-'));
  let processHandle,browser;
  try{
    processHandle=spawn(executable,[...commonArgs,`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore',env:{...process.env,TZ:'Asia/Taipei'}});
    let active;
    for(let i=0;i<150;i++){
      try{active=(await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).trim().split('\n');break;}catch{}
      if(processHandle.exitCode!==null)throw Error('chrome_exited_before_connection');
      await delay(100);
    }
    if(!active)throw Error('chrome_connection_timeout');
    const endpoint=`ws://127.0.0.1:${active[0]}${active[1]}`;
    browser=tool==='playwright'?await chromium.connectOverCDP(endpoint):await puppeteer.connect({browserWSEndpoint:endpoint,defaultViewport:null});
    row.browserVersion=tool==='playwright'?browser.version():await browser.version();
    const page=tool==='playwright'?await browser.contexts()[0].newPage():await browser.newPage();
    if(tool==='playwright')await page.setViewportSize({width:1280,height:900});else await page.setViewport({width:1280,height:900});
    const control=await page.goto('https://demo.playwright.dev/todomvc/',{waitUntil:'domcontentloaded',timeout:40000});
    row.control={httpStatus:control?.status()??null,title:await page.title()};
    if(row.control.httpStatus!==200||!/TodoMVC/i.test(row.control.title))throw Error('official_control_failed_no_target_navigation');
    const response=await page.goto(target.href,{waitUntil:'domcontentloaded',timeout:40000});
    row.httpStatus=response?.status()??null;
    row.exactUrl=page.url()===target.href;
    row.responseHeaders=safeHeaders(await response.headers(),['server','date','content-type','x-cache','x-amz-cf-pop','x-amz-cf-id']);
    row.requestHeaders=safeHeaders(await response.request().headers(),['user-agent','accept-language','sec-ch-ua','sec-ch-ua-platform']);
    const summary=await page.evaluate(()=>({title:document.title,listingCount:new Set([...document.querySelectorAll('a[href]')].map(a=>a.href).filter(h=>/\/v3\/mall\/detail\/\d+/.test(h))).size,blockedText:/request blocked|access denied|403 ERROR/i.test(document.body?.innerText??'')}));
    Object.assign(row,summary);
    row.outcome=[401,403,429].includes(row.httpStatus)||summary.blockedText?'blocked':row.httpStatus===200&&summary.listingCount>0?'readable':'not_confirmed_readable';
  }catch(error){row.error={name:error.name,code:error.code??null};row.outcome='diagnostic_error';}
  finally{
    await browser?.close().catch(()=>{});
    if(processHandle&&processHandle.exitCode===null)processHandle.kill('SIGTERM');
    row.finishedAt=new Date().toISOString();
  }
}
report.finishedAt=new Date().toISOString();
await fs.writeFile('browser-controller-comparison.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
if(report.tools.some(r=>r.outcome==='diagnostic_error'))process.exitCode=1;
