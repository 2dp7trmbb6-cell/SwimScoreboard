const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});try{
 const context=await browser.newContext({viewport:{width:1920,height:1080}}),base=process.env.SCOREBOARD_URL,control=await context.newPage(),errors=[];
 context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
 await control.goto(base);await control.locator('#mode').selectOption('lanes');
 await control.locator('#phase-personalBest').check();await control.locator('#standard-lanes').check();
 await control.waitForFunction(()=>document.querySelector('#saved').textContent.startsWith('Saved'));
 assert.match(await control.locator('.achievement-settings').textContent(),/780 × 260/);
 let finalTime='1:20.50',revision=0;
 const route=async route=>{const d=await(await fetch(base+'/api/state')).json(),now=Date.now()/1000;d.received=d.now=now;d.error=null;
 d.state={active:'test',program:{name:'Achievement test',heats:[{event:81,heat:1,title:'Girls 13 & Over 100 Yard Breaststroke',timeStandards:[{name:'NYS',time:'1:23.00',minAge:13,maxAge:14,gender:'F'},{name:'NYS',time:'1:20.50',minAge:15,maxAge:null,gender:'F'}],swimmers:[{lane:2,name:'Example, Swimmer',team:'TEST',age:16,seedTime:'1:30.00'}]}]},feed:{event:81,heat:1,connected:true,clockLast:now,raceClock:'1:20.5',results:{event:81,heat:1,lanes:{2:{splits:['0:40.00'],finalTime,place:finalTime?1:null,finishRevision:revision}}}}};await route.fulfill({json:d})};
 const output=await context.newPage();await output.route('**/api/state',route);await output.goto(base+'/overlay?format=lanes');
 await output.waitForSelector('.two-awards .standard-badge');
 for(const selector of ['.personal-best img','.standard-badge img']){await output.locator(selector).evaluate(img=>img.decode());assert.equal(await output.locator(selector).evaluate(i=>i.naturalWidth>0),true)}
 assert.equal(await output.locator('.standard-badge img').getAttribute('src'),'/nys-2027.png');
 const geometry=await output.locator('.lane-card').evaluate(card=>{const a=card.querySelector('.personal-best').getBoundingClientRect(),b=card.querySelector('.standard-badge').getBoundingClientRect(),c=card.getBoundingClientRect(),t=card.querySelector('.readable-time').getBoundingClientRect();return {stacked:a.bottom<=b.top,inside:b.right<=c.right&&b.bottom<=c.bottom,timesClear:t.right<=b.left}});
 assert.deepEqual(geometry,{stacked:true,inside:true,timesClear:true});
 await output.screenshot({path:'/tmp/achievement-lanes.png',omitBackground:true});
 // Upload two replacements through the UI, then verify both live image URLs.
 await control.locator('#image-personalBest').setInputFiles('static/nys-2027.png');
 await control.waitForFunction(()=>document.querySelector('#image-preview-personalBest').getAttribute('src').startsWith('/images/'));
 await control.waitForFunction(()=>document.querySelector('#saved').textContent.startsWith('Saved'));
 await output.waitForFunction(()=>document.querySelector('.personal-best img').getAttribute('src').startsWith('/images/'));
 await control.locator('#image-standard').setInputFiles('static/personal-best.png');
 await control.waitForFunction(()=>document.querySelector('#image-preview-standard').getAttribute('src').startsWith('/images/'));
 await control.waitForFunction(()=>document.querySelector('#saved').textContent.startsWith('Saved'));
 await output.waitForFunction(()=>document.querySelector('.standard-badge img').getAttribute('src').startsWith('/images/'));
 const uploaded=await control.locator('#image-preview-standard').getAttribute('src');
 await control.reload();await control.waitForFunction(()=>document.querySelector('#image-preview-standard').getAttribute('src').startsWith('/images/'));assert.equal(await control.locator('#image-preview-standard').getAttribute('src'),uploaded);
 // Invalid content cannot replace a saved image.
 await control.locator('#image-standard').setInputFiles({name:'invalid.png',mimeType:'image/png',buffer:Buffer.from('<svg/>')});
 await control.waitForFunction(()=>document.querySelector('#image-status').textContent.includes('Image not changed'));
 assert.equal(await control.locator('#image-preview-standard').getAttribute('src'),uploaded);
 finalTime='1:20.51';await output.waitForFunction(()=>!document.querySelector('.standard-badge'));assert.equal(await output.locator('.personal-best').count(),1);
 finalTime='1:20.50';await output.waitForSelector('.standard-badge');
 finalTime=null;revision=1;await output.waitForFunction(()=>!document.querySelector('.standard-badge')&&!document.querySelector('.personal-best'));
 finalTime='1:20.00';await output.waitForSelector('.standard-badge');
 await control.locator('#image-reset-standard').click();await control.locator('#image-reset-personalBest').click();
 await output.waitForFunction(()=>document.querySelector('.standard-badge img')?.getAttribute('src')==='/nys-2027.png'&&document.querySelector('.personal-best img')?.getAttribute('src')==='/personal-best.png');
 for(const format of ['board','compact']){
  await control.locator('#mode').selectOption(format);await control.locator('#lanePhase').selectOption('finish');await control.locator('#pb-'+format).check();await control.locator('#standard-'+format).check();
  await control.waitForFunction(()=>document.querySelector('#saved').textContent.startsWith('Saved'));
  const page=await context.newPage();await page.route('**/api/state',route);await page.goto(base+'/overlay?format='+format);await page.waitForSelector('.standard-cell .standard-badge');await page.waitForSelector('.pb-cell .personal-best');
  assert.equal(await page.locator('thead th').last().textContent(),'PB / UNOFFICIAL');assert.equal(await page.locator('thead th').nth((await page.locator('thead th').count())-2).textContent(),'NYS');
  assert.equal(await page.locator('.unused-lane .standard-badge').count(),0);
  assert.equal(await page.locator('.standard-cell img').evaluate(async i=>{await i.decode();return i.naturalWidth>0}),true);
  await page.waitForTimeout(500); // Let the existing PB fly-in finish before measuring.
  assert.equal(await page.locator('table').evaluate(t=>[...t.querySelectorAll('img')].every(i=>{const r=i.getBoundingClientRect(),c=i.closest('td').getBoundingClientRect();return r.left>=c.left&&r.right<=c.right+.1})),true);
  await page.screenshot({path:'/tmp/achievement-'+format+'.png',omitBackground:true});
  await control.locator('#standard-'+format).uncheck();await page.waitForFunction(()=>!document.querySelector('.standard-cell'));assert.equal(await page.locator('.pb-cell .personal-best').count(),1);await page.close();
 }
 assert.deepEqual(errors,[]);console.log('Achievement browser checks passed: default images, both awards, layout, uploads, persistence, invalid PNG, exact standard, corrections, reset and all formats.');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
