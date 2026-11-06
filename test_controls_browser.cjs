const {chromium}=require('playwright'),assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});try{
const context=await browser.newContext({viewport:{width:1440,height:1080}}),base=process.env.SCOREBOARD_URL,control=await context.newPage(),errors=[];
control.on('pageerror',e=>errors.push(e.message));await control.goto(base);await control.waitForSelector('#mode');
const saved=()=>control.waitForFunction(()=>document.querySelector('#saved').textContent.startsWith('Saved'));
await control.locator('#boardLaneCount').selectOption('6');await saved();assert.equal(await control.locator('#poolCount').count(),0);
for(const format of ['board','compact']){
 await control.locator('#mode').selectOption(format);await control.locator('#lanePhase').selectOption('start');
 assert.equal(await control.locator('#alignment').isVisible(),false);assert.equal(await control.locator('#boardWidth').isVisible(),format==='board');assert.equal(await control.locator('#compact-showHeader').isVisible(),format==='compact');
 await control.locator('#field-first').check();await control.locator('#lanePhase').selectOption('split');await control.locator('#field-first').uncheck();await control.locator('#field-split').check();
 await control.locator('#lanePhase').selectOption('finish');await control.locator('#field-first').uncheck();await control.locator('#field-final').check();
 await control.locator('#phase-finishDuration').fill('2');await control.locator('#phase-finishDuration').dispatchEvent('change');await saved();
 let stage='start',heat=2;
 const output=await context.newPage();output.on('pageerror',e=>errors.push(e.message));await output.route('**/api/state',async route=>{const d=await(await fetch(base+'/api/state')).json(),now=Date.now()/1000;d.received=d.now=now;d.error=null;d.state.program.heats=[{event:3,heat,title:'Freestyle',swimmers:[{lane:2,name:'Smith, Jamie',team:'AYST',seedTime:'1:02.00'},{lane:3,name:'Jones, Taylor',team:'OTHER'}]}];d.state.feed={event:3,heat,connected:true,clockLast:now,raceClock:'0:00.0'};if(stage!=='start')d.state.feed.results={event:3,heat,lanes:{2:stage==='split'?{splits:['28.31']}:{finalTime:'58.42'}}};await route.fulfill({json:d})});
 await output.goto(base+'/overlay?format='+format);const row=output.locator('[data-lane-slot="2"]');await output.waitForFunction(()=>document.querySelector('[data-lane-slot="2"]')?.dataset.phase==='start');assert.match(await row.textContent(),/Jamie|J\./);
 stage='split';await output.waitForFunction(()=>document.querySelector('[data-lane-slot="2"]')?.dataset.phase==='split');assert.doesNotMatch(await row.textContent(),/Jamie|J\./);assert.match(await row.textContent(),/28.31/);
 stage='finish';await output.waitForFunction(()=>document.querySelector('[data-lane-slot="2"]')?.dataset.phase==='finish');assert.match(await row.textContent(),/58.42/);assert.equal(await output.locator('[data-lane-slot="3"]').getAttribute('data-phase'),'start');
 await output.waitForFunction(()=>document.querySelector('[data-lane-slot="2"]')?.classList.contains('unused-lane'));assert.equal((await row.textContent()).trim(),'');assert.equal(await output.locator('tbody tr').count(),6);
 await control.locator('#phase-finishDuration').fill('0');await control.locator('#phase-finishDuration').dispatchEvent('change');await saved();await output.waitForFunction(()=>document.querySelector('[data-lane-slot="2"]')?.dataset.phase==='finish');
 heat=3;stage='start';await output.waitForFunction(()=>document.querySelector('[data-lane-slot="2"]')?.dataset.phase==='start');assert.doesNotMatch(await row.textContent(),/58.42/);await output.close();
}
await control.locator('#mode').selectOption('lanes');assert.equal(await control.locator('#alignment').isVisible(),true);await control.locator('#lanePhase').selectOption('start');assert.equal(await control.locator('#field-first').isChecked(),true);
await control.locator('#mode').selectOption('board');await saved();await control.reload();await control.waitForSelector('#field-first');assert.equal(await control.locator('#boardLaneCount').inputValue(),'6');await control.locator('#lanePhase').selectOption('finish');assert.equal(await control.locator('#field-first').isChecked(),false);
await control.screenshot({path:'/tmp/scoreboard-controls.png',fullPage:true});assert.deepEqual(errors,[]);console.log('Control browser checks passed: format scoping, shared lane count, phase fields, mixed states, finish expiry, heat reset and persistence.');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
