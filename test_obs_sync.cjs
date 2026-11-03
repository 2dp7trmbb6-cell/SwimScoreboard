const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),headless:true,args:['--no-sandbox']});try{
const context=await browser.newContext();await context.addInitScript(()=>{Array.prototype.at=undefined;Object.hasOwn=undefined});
const base=process.env.SCOREBOARD_URL,manager=process.env.MANAGER_URL;
const board=await context.newPage();await board.goto(base+'/overlay?format=board&debug=1');await board.waitForSelector('.board',{timeout:5000});assert.match(await board.locator('tbody').textContent(),/Jamie Smith/);
const control=await context.newPage();await control.goto(base);await control.waitForSelector('#alignmentMode');await control.locator('#alignmentMode').check();await control.locator('#usePool').check();
const secondControl=await context.newPage();await secondControl.goto(base);await secondControl.waitForSelector('#alignmentMode');
const lanes=await context.newPage();await lanes.goto(base+'/overlay?format=lanes');await lanes.waitForSelector('.alignment-card');const matrix=await lanes.locator('.lane-card').first().evaluate(el=>getComputedStyle(el).transform);
await control.locator('#corners input[data-point="0"][data-axis="1"]').fill('250');await control.locator('#corners input[data-point="0"][data-axis="1"]').dispatchEvent('change');
await secondControl.waitForFunction(()=>document.querySelector('#corners input[data-point="0"][data-axis="1"]')?.value==='250');
await lanes.waitForFunction(previous=>getComputedStyle(document.querySelector('.lane-card')).transform!==previous,matrix);
// Update the real manager's active report; both output windows stay open.
const state=await (await fetch(manager+'/api/v1/state')).json();
const update=await fetch(manager+'/api/manage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'update',id:state.active,html:'Updated Live Meet - 11/3/2026\nEvent 3 Girls 100 Yard Freestyle\nHeat 2 of 2 Starts at 09:00 AM\n  2  Swimmer, Updated  10  NEWTEAM  1:01.23'})});assert.equal(update.status,200);
await board.waitForFunction(()=>document.querySelector('.meet-title')?.textContent==='Updated Live Meet - 11/3/2026');assert.match(await board.locator('tbody').textContent(),/Updated Swimmer/);
await control.locator('#alignmentMode').uncheck();await control.locator('#autoHide').uncheck();await lanes.waitForFunction(()=>document.querySelector('.lane-name')?.textContent==='Updated Swimmer');
await board.bringToFront();
// Simulate a request that never completes; the client must time out and resume polling.
await board.evaluate(()=>{window.sawTimeout=false;new MutationObserver(()=>{if(document.querySelector('#notice').textContent.includes('timed out'))window.sawTimeout=true}).observe(document.querySelector('#notice'),{childList:true,subtree:true,characterData:true});const original=window.fetch;let stalled=false;window.fetch=(url,options)=>{if(String(url)==='/api/state'&&!stalled){stalled=true;return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))))}return original.call(window,url,options)}});
await board.waitForFunction(()=>window.sawTimeout,{},{timeout:15000});await board.waitForSelector('.board',{timeout:15000});
assert.match(await board.locator('#syncDebug').textContent(),/settings/);
// A newly deployed app build causes an existing source to reload itself.
let injected=false;await board.route('**/api/state',async route=>{const d=await(await fetch(base+'/api/state')).json();if(!injected){injected=true;d.appVersion='new-build-test'}await route.fulfill({json:d})});
const reload=board.waitForEvent('framenavigated',frame=>frame===board.mainFrame());await reload;await board.waitForSelector('.board');await board.unroute('**/api/state');
console.log('OBS sync checks passed: older-engine compatibility, open-source meet changes, live angle updates, stalled-request recovery, and app-version reload.');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
