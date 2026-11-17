// Official public demo only. No market collection, AI, or business writes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium} from './app/cloud-trial/node_modules/playwright/index.mjs';
import {browserLaunchOptions} from './app/hourly/browser-runtime.mjs';

const report={event:'official_browser_control_check',startedAt:new Date().toISOString(),target:'https://demo.playwright.dev/todomvc/',steps:[],marketRequests:0,aiCalls:0,discordWrites:0,businessStateWrites:0};
let browser,page;
try {
  const launch=browserLaunchOptions({MARKET_BROWSER_CHANNEL:'chrome'});
  report.launch=launch;
  browser=await chromium.launch(launch);
  report.browserVersion=browser.version();
  const context=await browser.newContext({locale:'zh-TW',timezoneId:'Asia/Taipei',viewport:{width:1280,height:900}});
  page=await context.newPage();
  page.setDefaultTimeout(15000);
  const response=await page.goto(report.target,{waitUntil:'domcontentloaded',timeout:40000});
  report.httpStatus=response?.status()??null;
  report.finalUrl=page.url();
  assert.equal(report.httpStatus,200);
  assert.equal(new URL(report.finalUrl).hostname,'demo.playwright.dev');
  report.steps.push('navigation_200');
  report.title=await page.title();
  assert.match(report.title,/TodoMVC/i);
  const input=page.getByPlaceholder('What needs to be done?');
  await input.waitFor({state:'visible'});
  report.steps.push('read_title_and_find_input');
  const label='Isolated browser diagnostic';
  await input.fill(label);
  assert.equal(await input.inputValue(),label);
  report.steps.push('fill_input');
  await input.press('Enter');
  const item=page.locator('.todo-list li').filter({hasText:label});
  await item.waitFor({state:'visible'});
  assert.equal(await item.count(),1);
  assert.equal((await item.locator('label').innerText()).trim(),label);
  report.steps.push('submit_and_read_dynamic_dom');
  const checkbox=item.locator('input.toggle');
  await checkbox.check();
  assert.equal(await checkbox.isChecked(),true);
  await page.screenshot({path:'browser-control-check.png'});
  report.steps.push('click_and_verify_completed');
  await item.hover();
  await item.locator('button.destroy').click();
  await item.waitFor({state:'detached'});
  assert.equal(await page.locator('.todo-list li').count(),0);
  report.steps.push('delete_and_verify_empty');
  report.passed=true;
} catch(error) {
  report.passed=false;
  report.error={name:error.name,code:error.code??null,message:String(error.message).slice(0,1200)};
  process.exitCode=1;
} finally {
  await browser?.close();
  report.finishedAt=new Date().toISOString();
  report.elapsedMs=Date.parse(report.finishedAt)-Date.parse(report.startedAt);
  await fs.writeFile('browser-control-check.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}
