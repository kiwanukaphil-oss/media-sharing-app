import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { chooseWorkspaceOption } from './browser-controls.mjs';

const origin=process.env.RELAY_TEST_ORIGIN || 'http://127.0.0.1:8787';
if (!['localhost','127.0.0.1'].includes(new URL(origin).hostname)) throw new Error('Use isolated local fixtures only.');
const browser=await chromium.launch(process.env.CI ? {} : {channel:'chrome'});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
let releaseCompletion;
try {
  await page.goto(origin);
  await page.getByLabel('Space name').fill('Private presentation fixture');
  await page.getByRole('button',{name:'Create shared space'}).click();
  await expect(page.getByRole('button',{name:'New album',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'New album',exact:true}).click();
  await page.getByLabel('Album name',{exact:true}).fill('Recent album fixture');
  await page.getByRole('button',{name:'Create album',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Recent album fixture.'})).toBeVisible();
  const completionGate=new Promise(resolve=>{releaseCompletion=resolve;});
  let observeCompletion;
  const completionStarted=new Promise(resolve=>{observeCompletion=resolve;});
  await page.route('**/api/uploads/*/complete**',async route=>{
    observeCompletion(); await completionGate; await route.continue();
  });
  await page.getByLabel('Choose original files',{exact:true}).setInputFiles({name:'concealed-source.txt',mimeType:'text/plain',buffer:Buffer.from('An original that continues sending behind the presentation cover.')});
  let completionTimeout;
  try { await Promise.race([completionStarted, new Promise((_,reject)=>{completionTimeout=setTimeout(()=>reject(new Error('Upload did not reach completion.')),30000);})]); }
  catch (error) { console.error(await page.locator('body').innerText()); throw error; }
  finally { clearTimeout(completionTimeout); }
  const hide=page.getByRole('button',{name:'Hide library for screen sharing'});
  await hide.click();
  await expect(page.getByRole('button',{name:'Show library'})).toBeFocused();
  await expect(page.locator('.app-shell')).toBeHidden();
  releaseCompletion();
  await expect.poll(async()=> (await (await page.request.get(`${origin}/api/feed`)).json()).total).toBe(1);
  await expect(page.getByRole('heading',{name:'Library hidden'})).toBeVisible();
  await page.getByRole('button',{name:'Show library'}).click();
  await expect(hide).toBeFocused();
  await expect(page.locator('article')).toHaveCount(1);
  await page.getByRole('button',{name:'Filters',exact:true}).click();
  await chooseWorkspaceOption(page,'File type','photo');
  await expect(page.locator('article')).toHaveCount(0);
  await chooseWorkspaceOption(page,'File type','other');
  await chooseWorkspaceOption(page,'Added by','me');
  await expect(page.locator('article')).toHaveCount(1);
  await expect(page).toHaveURL(/uploader=me/);
  await page.reload();
  await page.getByRole('button',{name:/^Filters/}).click();
  await expect(page.getByRole('combobox',{name:'File type',exact:true})).toHaveAttribute('data-value','other');
  await expect(page.getByRole('combobox',{name:'Added by',exact:true})).toHaveAttribute('data-value','me');
  await page.getByRole('button',{name:'Clear all filters',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'File type',exact:true})).toHaveAttribute('data-value','');
  await page.getByRole('button',{name:/^All files/}).click();
  await page.getByRole('button',{name:'Open recent album Recent album fixture'}).click();
  await expect(page.getByRole('heading',{name:'Recent album fixture.'})).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile filters must not overflow.');
  await hide.click();
  await page.reload();
  await expect(page.getByRole('heading',{name:'Library hidden'})).toBeVisible();
  await expect(page.locator('.app-shell')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('.app-shell')).toBeHidden();
  await mkdir('outputs/retrieval',{recursive:true});
  await page.screenshot({path:'outputs/retrieval/presentation-mobile.png'});
  await page.getByRole('button',{name:'Show library'}).click();
  await expect(page.locator('article')).toHaveCount(1);
  await page.getByRole('button',{name:'Filters',exact:true}).click();
  await page.screenshot({path:'outputs/retrieval/filters-mobile.png',fullPage:true});
  console.log('PASS: scoped filter URL restoration, mobile layout, presentation focus and reload persistence, upload completion while concealed.');
} finally { releaseCompletion?.(); await browser.close(); }
