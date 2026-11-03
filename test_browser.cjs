// Run with the scoreboard server at SCOREBOARD_URL (default http://127.0.0.1:8780).
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({headless:true,args:['--no-sandbox']});try{
const page=await browser.newPage({viewport:{width:1440,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
const base=process.env.SCOREBOARD_URL||'http://127.0.0.1:8780';await page.goto(base);await page.waitForSelector('#field-first');
await page.locator('#mode').selectOption('lanes');await page.locator('#autoHide').uncheck();await page.waitForFunction(()=>document.querySelector('#saved').textContent.startsWith('Saved'));
const overlay=await browser.newPage({viewport:{width:1920,height:1080}});await overlay.goto(base+'/overlay?format=lanes');await overlay.waitForSelector('.lane-card');
assert.equal(await overlay.locator('.lane-name').first().textContent(),'Jamie Smith');
assert.equal(await overlay.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgba(0, 0, 0, 0)');
await page.locator('#field-first').uncheck();await overlay.waitForFunction(()=>document.querySelector('.lane-name')?.textContent==='Smith');
await page.locator('#visible').uncheck();await overlay.waitForFunction(()=>document.querySelector('#broadcast').children.length===0);
await page.locator('#visible').check();await page.locator('#autoHide').check();await page.waitForFunction(()=>document.querySelector('#saved').textContent.startsWith('Saved'));await overlay.waitForTimeout(600);assert.equal(await overlay.locator('.lane-card').count(),0);
await overlay.goto(base+'/overlay?format=board');await overlay.waitForSelector('table');assert.match(await overlay.locator('tbody').textContent(),/Smith/);assert.match(await overlay.locator('#notice').textContent(),/SIMULATED/);
await page.reload();await page.waitForSelector('#field-first');assert.equal(await page.locator('#field-first').isChecked(),false);assert.deepEqual(errors,[]);
console.log('Browser checks passed: live roster, shared settings, transparent output, auto-hide, board view, persistence, no page errors.');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
