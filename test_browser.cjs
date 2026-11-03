// Run with the scoreboard server at SCOREBOARD_URL (default http://127.0.0.1:8780).
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || (require('node:fs').existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),headless:true,args:['--no-sandbox']});try{
const page=await browser.newPage({viewport:{width:1440,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
const base=process.env.SCOREBOARD_URL||'http://127.0.0.1:8780';await page.goto(base);await page.waitForSelector('#field-first');
await page.locator('#mode').selectOption('lanes');await page.locator('#autoHide').uncheck();await page.waitForFunction(()=>document.querySelector('#saved').textContent.startsWith('Saved'));
const overlay=await browser.newPage({viewport:{width:1920,height:1080}});await overlay.goto(base+'/overlay?format=lanes');await overlay.waitForSelector('.lane-card');
assert.equal(await overlay.locator('.lane-name').first().textContent(),'Jamie Smith');
assert.equal(await overlay.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgba(0, 0, 0, 0)');
await page.locator('#field-first').uncheck();await overlay.waitForFunction(()=>document.querySelector('.lane-name')?.textContent==='Smith');
await page.locator('#visible').uncheck();await overlay.waitForFunction(()=>document.querySelector('#broadcast').children.length===0);
await page.locator('#visible').check();await page.locator('#autoHide').check();await page.waitForFunction(()=>document.querySelector('#saved').textContent.startsWith('Saved'));await overlay.waitForTimeout(600);assert.equal(await overlay.locator('.lane-card').count(),0);
if(process.env.MANAGER_URL){
const manager=process.env.MANAGER_URL;
// Freeze a populated feed while publishing test finishes; physical serial is not needed.
const snapshot=await (await fetch(manager+'/api/v1/state')).json();
await fetch(manager+'/api/manage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'source',mode:'off'})});
// Source reset clears event/heat; use an injected browser snapshot to exercise the exact live rendering lifecycle.
await overlay.route('**/api/state',async route=>{const d=await (await fetch(base+'/api/state')).json();d.state=snapshot;d.error=null;d.received=Date.now()/1000;d.state.feed.clockLast=d.received;d.state.feed.connected=true;d.state.feed.raceClock='0:12.3';d.state.feed.results={session:snapshot.active,event:3,heat:2,source:'manual',lanes:{2:{finalTime:'0:58.12',place:1}}};await route.fulfill({json:d})});
await overlay.waitForSelector('.finish-card');assert.equal(await overlay.locator('.finish-place').textContent(),'PLACE 1');
assert.equal(await overlay.locator('.finish-card .lane-times').textContent(),'PLACE 1');
const firstCard=await overlay.locator('.finish-card').elementHandle();await overlay.waitForTimeout(900);assert.equal(await firstCard.evaluate(el=>el.isConnected),true);
await overlay.unroute('**/api/state');
await fetch(manager+'/api/manage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'source',mode:'demo',interval:600})});
}
await overlay.goto(base+'/overlay?format=board');await overlay.waitForSelector('table');assert.match(await overlay.locator('tbody').textContent(),/Jamie Smith/);assert.doesNotMatch(await overlay.locator('.board').textContent(),/IN THE WATER/);assert.equal(await overlay.locator('.meet-title').textContent(),'Demo Meet - 10/25/2026');assert.ok((await overlay.locator('.board-head').boundingBox()).height<140);if(process.env.BOARD_SCREENSHOT)await overlay.screenshot({path:process.env.BOARD_SCREENSHOT});assert.match(await overlay.locator('#notice').textContent(),/SIMULATED/);
await page.reload();await page.waitForSelector('#field-first');assert.equal(await page.locator('#field-first').isChecked(),false);assert.deepEqual(errors,[]);
await page.locator('#alignmentMode').check();await page.locator('#usePool').check();
await overlay.goto(base+'/overlay?format=lanes');await overlay.waitForFunction(()=>document.querySelectorAll('.alignment-card').length===8);
await page.locator('#poolCount').selectOption('6');await overlay.waitForFunction(()=>document.querySelectorAll('.alignment-card').length===6);
const handle=page.locator('#alignmentCanvas [data-corner="0"]');await handle.scrollIntoViewIfNeeded();const box=await handle.boundingBox();
const before=await page.locator('#corners input[data-point="0"][data-axis="0"]').inputValue();
await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+24,box.y+box.height/2+10,{steps:4});await page.mouse.up();
assert.notEqual(await page.locator('#corners input[data-point="0"][data-axis="0"]').inputValue(),before);
await page.locator('#alignTarget').selectOption('lane');await page.locator('#lane').selectOption('2');await page.locator('#cornerTarget').selectOption('all');
const laneBefore=Number(await page.locator('#corners input[data-point="0"][data-axis="0"]').inputValue());await page.locator('[aria-label="Move right"]').click();
assert.equal(Number(await page.locator('#corners input[data-point="0"][data-axis="0"]').inputValue()),laneBefore+10);
await page.locator('#laneEnabled').uncheck();assert.equal(await page.locator('#alignmentCanvas polygon[data-lane="2"]').count(),0);await overlay.waitForFunction(()=>document.querySelectorAll('.alignment-card').length===5);
if(process.env.ALIGNMENT_SCREENSHOT)await page.locator('#alignment').screenshot({path:process.env.ALIGNMENT_SCREENSHOT});
await page.locator('#alignmentMode').uncheck();await overlay.waitForFunction(()=>!document.querySelector('.alignment-card'));await page.waitForFunction(()=>document.querySelector('#saved').textContent.startsWith('Saved'));
assert.deepEqual(errors,[]);
console.log('Alignment browser checks passed: all-lane mode, pool count, pointer dragging, lane nudge, enabled lanes, exit alignment.');
console.log('Browser checks passed: live roster, shared settings, transparent output, auto-hide, board view, persistence, no page errors.');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
