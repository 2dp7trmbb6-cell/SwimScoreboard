const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});try{
const context=await browser.newContext({viewport:{width:1920,height:1080}}),base=process.env.SCOREBOARD_URL,control=await context.newPage();
await control.goto(base);await control.locator('#mode').selectOption('lanes');await control.locator('#phase-personalBest').check();await control.waitForFunction(()=>document.querySelector('#saved').textContent.startsWith('Saved'));
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));let finalTime='58.42',place=1,heat=2;
await page.route('**/api/state',async route=>{const d=await(await fetch(base+'/api/state')).json(),now=Date.now()/1000;d.received=d.now=now;d.error=null;d.state.program.heats=[{event:3,heat,title:'100 Freestyle',swimmers:[{lane:2,name:'Smith, Jamie',team:'AYST',seedTime:'1:02.00'}]}];d.state.feed={event:3,heat,connected:true,clockLast:now,raceClock:'0:58.4',results:{event:3,heat,lanes:{2:{finalTime,place}}}};await route.fulfill({json:d})});
await page.goto(base+'/overlay?format=lanes');await page.waitForSelector('.personal-best');
assert.equal(await page.locator('.personal-best img').evaluate(i=>i.complete&&i.naturalWidth>0),true);
await page.waitForTimeout(1200);assert.equal(await page.locator('.personal-best').evaluate(e=>e.getAnimations().some(a=>a.playState==='running')),false);
place=2;await page.waitForFunction(()=>document.querySelector('.finish-number').textContent==='2');assert.equal(await page.locator('.personal-best').evaluate(e=>getComputedStyle(e).animationName),'none');
const boxes=await page.locator('.lane-card').evaluate(card=>{const a=card.querySelector('.personal-best').getBoundingClientRect(),b=card.querySelector('.readable-time').getBoundingClientRect();return {clear:b.right<=a.left,inside:a.right<=card.getBoundingClientRect().right,close:a.left-b.right<=24}});assert.deepEqual(boxes,{clear:true,inside:true,close:true});
await page.screenshot({path:'/tmp/personal-best-overlay.png',omitBackground:true});
finalTime='1:02.00';await page.waitForFunction(()=>!document.querySelector('.personal-best'));
finalTime='58.42';await page.waitForSelector('.personal-best');await control.locator('#phase-personalBest').uncheck();await page.waitForFunction(()=>!document.querySelector('.personal-best'));
await control.reload();assert.equal(await control.locator('#phase-personalBest').isChecked(),false);
// Check both independent scoreboard controls with the same final and seed.
for(const format of ['board','compact']){
 await control.locator('#mode').selectOption(format);for(const phase of ['start','split']){await control.locator('#lanePhase').selectOption(phase);assert.equal(await control.locator('#pb-'+format).isVisible(),false)}await control.locator('#lanePhase').selectOption('finish');assert.equal(await control.locator('#pb-'+format).isVisible(),true);await control.locator('#pb-'+format).check();await control.waitForFunction(()=>document.querySelector('#saved').textContent.startsWith('Saved'));
 const board=await context.newPage();await board.route('**/api/state',async route=>{const d=await(await fetch(base+'/api/state')).json(),now=Date.now()/1000;d.received=d.now=now;d.error=null;d.state.program.heats=[{event:3,heat:2,title:'Freestyle',swimmers:[{lane:2,name:'Smith, Jamie',team:'AYST',seedTime:'1:02.00'}]}];d.state.feed={event:3,heat:2,connected:true,clockLast:now,results:{event:3,heat:2,lanes:{2:{finalTime:'58.42',place:1}}}};await route.fulfill({json:d})});
 await board.goto(base+'/overlay?format='+format);await board.waitForSelector('.pb-cell .personal-best');assert.equal(await board.locator('thead th').last().textContent(),'PB / UNOFFICIAL');
 assert.equal(await board.locator('.pb-cell .personal-best img').evaluate(i=>i.complete&&i.naturalWidth>0),true);
 assert.equal(await board.locator('.unused-lane .personal-best').count(),0);
 await board.waitForTimeout(800);assert.equal(await board.locator('.pb-new').count(),0);
 await board.screenshot({path:'/tmp/personal-best-'+format+'.png',omitBackground:true});
 await control.locator('#pb-'+format).uncheck();await board.waitForFunction(()=>!document.querySelector('.pb-cell'));
 await board.close();
}
assert.deepEqual(errors,[]);console.log('PB browser checks passed: saved option, image, fly-in completion, correction without replay, layout, ties, live toggle and persistence.');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
