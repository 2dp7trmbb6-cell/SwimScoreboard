// Run with SMOKE_SCRIPT=test_split_expiry_browser.cjs python browser_smoke.py.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');

(async()=>{
 const browser=await chromium.launch({
  executablePath:process.env.CHROMIUM_PATH||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),
  headless:true,args:['--no-sandbox']
 });
 try{
  const base=process.env.SCOREBOARD_URL;
  const original=await(await fetch(base+'/api/state')).json();
  const errors=[];
  for(const autoHide of [true,false])for(const clock of [null,'0:45.0']){
   const page=await browser.newPage({viewport:{width:1920,height:1080}});
   page.on('pageerror',e=>errors.push(e.message));
   let results=null,polls=0;
   await page.route('**/api/state',async route=>{
    const d=structuredClone(original),now=Date.now()/1000;
    d.received=d.now=now;d.error=null;
    d.config.visible=true;d.config.autoHide=autoHide;d.config.finishPopups=true;
    d.config.alignment.active=false;
    Object.assign(d.config.lanePhases,{
     startEnabled:true,startDelay:0,startDuration:0,
     splitEnabled:true,splitDelay:0,splitDuration:1.2,
     finishDelay:0,finishDuration:2
    });
    d.state.program.heats=[{event:3,heat:2,title:'Freestyle',swimmers:[
     {lane:2,name:'Smith, Jamie',team:'WAVES'},
     {lane:3,name:'Jones, Taylor',team:'SHARKS'}
    ]}];
    d.state.feed={event:3,heat:2,connected:true,clockLast:now,
     raceClock:results?clock:'0:00.0',results:results?{event:3,heat:2,updated:now,lanes:{2:results}}:null};
    polls++;
    await route.fulfill({json:d});
   });
   await page.goto(base+'/overlay?format=lanes');
   const lane=page.locator('.lane-output[data-lane="2"]');
   await page.waitForFunction(()=>document.querySelector('.lane-output[data-lane="2"]')?.dataset.phase==='start');
   results={splits:['0:28.31']};
   await page.waitForFunction(()=>document.querySelector('.lane-output[data-lane="2"]')?.dataset.phase==='split');
   const signature=await lane.getAttribute('data-event'),firstPoll=polls;
   await page.waitForTimeout(850);
   assert.ok(polls>=firstPoll+2,'the same split was polled again');
   assert.equal(await lane.getAttribute('data-event'),signature);
   await page.waitForFunction(()=>!document.querySelector('.lane-output[data-lane="2"]'),{},{timeout:2500});
   await page.waitForTimeout(900);
   assert.equal(await lane.count(),0,`no Start fallback: autoHide=${autoHide}, clock=${clock}`);
   if(!autoHide||clock===null){
    assert.equal(await page.locator('.lane-output[data-lane="3"]').getAttribute('data-phase'),'start',
     'a split in lane 2 must not suppress lane 3 pre-race cards');
   }
   // A missing result between identical polls must not reset the observation.
   results=null;await page.waitForTimeout(450);
   results={splits:['0:28.31']};await page.waitForTimeout(450);
   assert.equal(await lane.count(),0);
   results.splits.push('0:58.42');
   await page.waitForFunction(()=>document.querySelector('.lane-output[data-lane="2"]')?.dataset.phase==='split');
   assert.notEqual(await lane.getAttribute('data-event'),signature);
   assert.match(await lane.textContent(),/0:30.11/);
   await page.waitForFunction(()=>!document.querySelector('.lane-output[data-lane="2"]'),{},{timeout:2500});
   results.finalTime='1:00.00';results.place=1;
   await page.waitForFunction(()=>document.querySelector('.lane-output[data-lane="2"]')?.dataset.phase==='finish');
   await page.waitForTimeout(1400); // Longer than the split window, shorter than the finish window.
   assert.equal(await lane.getAttribute('data-phase'),'finish');
   await page.waitForFunction(()=>!document.querySelector('.lane-output[data-lane="2"]'),{},{timeout:2500});
   await page.close();
   console.log(`Split expiry browser regression passed: autoHide=${autoHide}, clock=${clock}`);
  }
  assert.deepEqual(errors,[]);
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
