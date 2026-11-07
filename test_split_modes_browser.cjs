// SMOKE_SCRIPT=test_split_modes_browser.cjs python browser_smoke.py
const {chromium}=require('playwright'),assert=require('node:assert/strict');

(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  const context=await browser.newContext({viewport:{width:1920,height:1080}});
  const base=process.env.SCOREBOARD_URL,control=await context.newPage(),errors=[];
  control.on('pageerror',e=>errors.push(e.message));
  await control.goto(base);await control.waitForSelector('#splitMode');
  const saved=async()=>{
   try{
    await control.waitForFunction(()=>/^(Saved|Not saved)/.test(document.querySelector('#saved').textContent));
    assert.match(await control.locator('#saved').textContent(),/^Saved/);
   }
   catch(error){throw Error(`Settings save failed: ${await control.locator('#saved').textContent()}`,{cause:error})}
  };
  let splits=['0:28.31','0:58.42'],finalTime=null;
  const outputs={};
  for(const format of ['board','compact','lanes']){
   await control.locator('#mode').selectOption(format);
   assert.equal(await control.locator('#splitMode').inputValue(),'subtractive');
   await control.locator('#lanePhase').selectOption('split');await control.locator('#field-split').check();
   await control.locator('#lanePhase').selectOption('finish');await control.locator('#field-split').check();await control.locator('#field-final').check();
   if(format==='lanes'){
    await control.locator('#phase-splitDuration').fill('60');await control.locator('#phase-splitDuration').blur();
   }
   await saved();
   const page=await context.newPage();outputs[format]=page;
   page.on('pageerror',e=>errors.push(e.message));
   // Keep live server settings; substitute only the timing fixture in this OBS page.
   await page.route('**/api/state',async route=>{
    const d=await(await fetch(base+'/api/state')).json(),now=Date.now()/1000;
    d.received=d.now=now;d.error=null;
    d.state.program.heats=[{event:3,heat:2,title:'Freestyle',swimmers:[{lane:2,name:'Smith, Jamie',team:'WAVES'}]}];
    d.state.feed={event:3,heat:2,connected:true,clockLast:now,raceClock:null,
     results:{event:3,heat:2,lanes:{2:{splits,finalTime,place:finalTime?1:null}}}};
    await route.fulfill({json:d});
   });
   await page.goto(base+'/overlay?format='+format);
   await page.waitForFunction(()=>document.querySelector('#broadcast').textContent.includes('0:30.11'));
  }
  // Changing one format updates an already-open output without affecting the others.
  await control.locator('#mode').selectOption('board');await control.locator('#splitMode').selectOption('cumulative');await saved();
  await outputs.board.waitForFunction(()=>document.querySelector('tbody').textContent.includes('0:58.42'));
  for(const format of ['compact','lanes'])assert.match(await outputs[format].locator('#broadcast').textContent(),/0:30.11/);
  await control.reload();await control.waitForSelector('#splitMode');assert.equal(await control.locator('#splitMode').inputValue(),'cumulative');
  await control.locator('#mode').selectOption('compact');assert.equal(await control.locator('#splitMode').inputValue(),'subtractive');
  // Earlier cumulative corrections update the displayed interval on the next poll.
  splits=['0:28.32','0:58.42'];
  await outputs.compact.waitForFunction(()=>document.querySelector('tbody').textContent.includes('0:30.10'));
  await outputs.lanes.waitForFunction(()=>document.querySelector('.split-card').textContent.includes('0:30.10'));
  // Final totals are independent of the selected split display.
  finalTime='1:00.00';
  for(const format of ['board','compact','lanes']){
   await outputs[format].waitForFunction(()=>document.querySelector('#broadcast').textContent.includes('1:00.00'));
   const text=await outputs[format].locator('#broadcast').textContent();
   assert.match(text,format==='board'?/0:58.42/:/0:30.10/);
  }
  const settings=(await(await fetch(base+'/api/state')).json()).config;
  assert.deepEqual(settings.splitModes,{board:'cumulative',compact:'subtractive',lanes:'subtractive'});
  assert.deepEqual(errors,[]);
  console.log('Split mode browser checks passed: subtractive defaults, independent formats, saved controls, live updates, corrections and cumulative finals.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
