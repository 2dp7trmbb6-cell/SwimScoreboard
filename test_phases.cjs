const fs=require('node:fs'),vm=require('node:vm'),test=require('node:test'),assert=require('node:assert/strict');
const BASE=1700000000000;
function fixture(format='lanes'){let now=BASE;class Clock extends Date{static now(){return now}}
const nodes={broadcast:{innerHTML:'',replaceChildren(){this.innerHTML=''}},notice:{textContent:''}};
const context=vm.createContext({document:{body:{classList:{contains:()=>false}},getElementById:id=>nodes[id]},location:{search:'?format='+format},URLSearchParams,Date:Clock,setTimeout:()=>{},clearTimeout:()=>{}});
vm.runInContext(fs.readFileSync(__dirname+'/static/app.js','utf8').replace(/poll\(\);\s*$/,''),context);vm.runInContext("updateLaneCards=cards=>document.getElementById('broadcast').innerHTML=cards.join('')",context);
const fields={lane:true,place:true,first:true,last:true,team:true,seed:false,split:false,final:false};
const data={received:BASE/1000,error:null,now:BASE/1000,config:{splitModes:{board:'cumulative',compact:'cumulative',lanes:'cumulative'},visible:true,autoHide:true,finishPopups:true,fields:{lanes:{...fields}},lanePhases:{splitFields:{...fields,split:true},finishFields:{...fields,first:false,team:false,final:true,lane:false},startEnabled:true,splitEnabled:true,startDelay:0,startDuration:0,startHideDelay:.5,splitDelay:0,splitDuration:5,finishDelay:0,finishDuration:0,uprightTimes:true,timeSize:36},lanes:{2:{enabled:true,points:[[10,10],[710,10],[710,100],[10,100]]}}},state:{active:'session',program:{heats:[{event:3,heat:2,title:'Freestyle',swimmers:[{lane:2,name:'Smith, Jamie',team:'WAVES',seedTime:'1:02.00'}]}]},feed:{event:3,heat:2,connected:true,clockLast:BASE/1000,raceClock:'0:00.0'}}};
return {data,nodes,run:s=>vm.runInContext(s,context),at(seconds,clock){now=BASE+seconds*1000;data.now=now/1000;data.received=now/1000;data.state.feed.clockLast=now/1000;if(clock!==undefined)data.state.feed.raceClock=clock},render(){vm.runInContext(`renderOutput(${JSON.stringify(data)})`,context);return nodes.broadcast.innerHTML}}}
test('start delay, finite duration and clock grace are independent',()=>{const f=fixture(),p=f.data.config.lanePhases;p.startDelay=2;p.startDuration=3;assert.equal(f.render(),'');f.at(2);assert.match(f.render(),/data-phase="start"/);f.at(4.9);assert.match(f.render(),/Jamie Smith/);f.at(5);assert.equal(f.render(),'');const g=fixture();g.data.config.lanePhases.startHideDelay=2;g.render();g.at(1,'0:01.0');assert.match(g.render(),/data-phase="start"/);g.at(2,'0:02.0');assert.equal(g.render(),'');g.at(3,null);assert.equal(g.render(),'')});
test('split delay/expiry tracks new values, not repeated poll timestamps',()=>{const f=fixture(),p=f.data.config.lanePhases;p.startEnabled=false;p.splitDelay=1;p.splitDuration=2;f.data.state.feed.results={event:3,heat:2,lanes:{2:{splits:['0:28.31']}}};assert.equal(f.render(),'');f.at(1);assert.match(f.render(),/data-phase="split"/);assert.match(f.render(),/0:28.31/);f.at(2.9);assert.match(f.render(),/0:28.31/);f.at(3);assert.equal(f.render(),'');f.at(5);assert.equal(f.render(),'');f.data.state.feed.results.lanes[2].splits.push('0:58.42');assert.equal(f.render(),'');f.at(6);assert.match(f.render(),/0:58.42/)});
test('subtractive splits use integer hundredths and require valid consecutive cumulative times',()=>{
const f=fixture();
for(const [splits,expected] of [
 [['0:28.31'],'0:28.31'],[['28.31','58.42'],'0:30.11'],
 [['0:59.99','1:00.01'],'0:00.02'],[['1:10.00','2:20.01'],'1:10.01'],
 [['0:00.01','0:00.02'],'0:00.01'],[['100:00.00','101:01.25'],'1:01.25'],
 [[], '—'],[null,'—'],[['NT'],'—'],[['0:00.00'],'—'],
 [['0:28.31','DQ'],'—'],[['NT','0:58.42'],'—'],[[null,'0:58.42'],'—'],
 [['0:58.42','0:58.42'],'—'],[['0:58.42','0:28.31'],'—'],
 [['1:60.00','2:00.00'],'—'],[[28.31,'58.42'],'—']
])assert.equal(f.run(`splitTime(${JSON.stringify(splits)},'subtractive')`),expected,JSON.stringify(splits));
assert.equal(f.run("splitTime(['0:28.31','0:58.42'])"),'0:30.11');
assert.equal(f.run("splitTime(['0:28.31','0:58.42'],'cumulative')"),'0:58.42');
});
for(const format of ['lanes','board','compact'])test(format+' switches split display without resetting windows or changing final times',()=>{
const f=fixture(format),cfg=f.data.config;cfg.autoHide=false;cfg.splitModes={lanes:'cumulative',board:'cumulative',compact:'cumulative'};
cfg.fields[format]={...cfg.fields.lanes,split:true,final:true};
cfg.boardPhases=Object.fromEntries(['board','compact'].map(key=>[key,{splitFields:{...cfg.fields[format]},finishFields:{...cfg.fields[format]},finishHold:5}]));
cfg.compact={showHeader:false,showResults:true,resultsX:0,resultsBottom:0,resultsWidth:320,rowHeight:32,initials:false};
cfg.lanePhases.splitDuration=3;cfg.lanePhases.finishFields.split=true;
const splits=['0:28.31','0:58.42'];f.data.state.feed.results={event:3,heat:2,lanes:{2:{splits}}};
assert.match(f.render(),/0:58.42/);
f.at(1,null);cfg.splitModes[format]='subtractive';assert.match(f.render(),/0:30.11/);
assert.deepEqual(splits,['0:28.31','0:58.42']);
// A correction to an earlier cumulative time updates subtraction without a new window.
f.at(2);splits[0]='0:28.32';assert.match(f.render(),/0:30.10/);
f.at(3);if(format==='lanes')assert.equal(f.render(),'');else assert.match(f.render(),/0:30.10/);
// Retained split history supports a mode change even during a manager outage.
f.at(4);f.data.state.feed.results.lanes[2].finalTime='1:00.00';assert.match(f.render(),/1:00.00/);
f.data.state.feed.results=null;f.data.error='offline';cfg.splitModes[format]='cumulative';
const html=f.render();assert.match(html,/0:58.42/);assert.match(html,/1:00.00/);
for(const other of ['lanes','board','compact'].filter(key=>key!==format))assert.equal(cfg.splitModes[other],'cumulative');
});
for(const autoHide of [true,false])for(const clock of [null,'0:45.0'])test(`expired split never falls back to Start (autoHide=${autoHide}, clock=${clock})`,()=>{
const f=fixture();f.data.config.autoHide=autoHide;f.data.config.lanePhases.splitDuration=2;
assert.match(f.render(),/data-phase="start"/); // Start remains enabled with no duration limit.
f.at(1,clock);f.data.state.feed.results={event:3,heat:2,updated:1,lanes:{2:{splits:['0:28.31']}}};
assert.match(f.render(),/data-phase="split"/);
for(const seconds of [2,2.9,3,4]){
 f.at(seconds);f.data.state.feed.results.updated=seconds; // Same split, new manager poll.
 if(seconds<3)assert.match(f.render(),/0:28.31/);else assert.equal(f.render(),'');
}
f.data.state.feed.results=null;assert.equal(f.render(),''); // A missing result cannot revive Start.
f.at(5);f.data.state.feed.results={event:3,heat:2,lanes:{2:{splits:['0:28.31','0:58.42']}}};
assert.match(f.render(),/0:58.42/);f.at(7);assert.equal(f.render(),'');
// A finish still has its own window, even after the split expired.
f.data.config.lanePhases.finishDuration=3;f.data.state.feed.results.lanes[2].finalTime='1:00.00';
assert.match(f.render(),/data-phase="finish"/);f.at(9);assert.match(f.render(),/1:00.00/);f.at(10);assert.equal(f.render(),'');
});
test('an observed split suppresses Start during its delay and when split cards are disabled',()=>{
const f=fixture(),p=f.data.config.lanePhases;p.splitDelay=1;p.splitDuration=2;f.data.config.autoHide=false;
f.data.state.feed.results={event:3,heat:2,lanes:{2:{splits:['0:28.31']}}};
assert.equal(f.render(),'');f.at(1);assert.match(f.render(),/data-phase="split"/);
p.splitEnabled=false;assert.equal(f.render(),'');p.splitEnabled=true;assert.match(f.render(),/data-phase="split"/);
f.at(3);assert.equal(f.render(),'');
});
for(const reset of ['event','heat','session','replay','serial'])test(`expired split preserves alignment override and resets on ${reset} change`,()=>{
const f=fixture();f.data.config.autoHide=false;f.data.state.feed.results={event:3,heat:2,lanes:{2:{splits:['0:28.31']}}};
f.render();f.at(6,null);assert.equal(f.render(),'');
f.data.config.alignment={active:true};assert.match(f.render(),/alignment-card/);
f.data.config.alignment.active=false;assert.equal(f.render(),'');
f.data.state.feed.results=null;
if(reset==='session')f.data.state.active='another-session';
else if(reset==='replay')f.data.state.feed.replayId='another-replay';
else if(reset==='serial')f.data.state.feed.serialRace='another-race';
else{f.data.state.feed[reset]++;f.data.state.program.heats[0][reset]++}
assert.match(f.render(),/data-phase="start"/);
f.data.state.feed.results={event:f.data.state.feed.event,heat:f.data.state.feed.heat,lanes:{2:{splits:['0:28.31']}}};
assert.match(f.render(),/data-phase="split"/); // Identical values may display in a new heat/source.
});
test('finish has separate fields, priority, delay and expiry without fallback',()=>{const f=fixture(),p=f.data.config.lanePhases;p.finishDelay=1;p.finishDuration=2;f.render();f.at(1,'0:12.3');f.data.state.feed.results={event:3,heat:2,source:'manual',lanes:{2:{splits:['0:28.31'],finalTime:'0:58.42',place:1}}};assert.equal(f.render(),'');f.at(2);const html=f.render();assert.match(html,/data-phase="finish"/);assert.match(html,/Smith/);assert.doesNotMatch(html,/Jamie|class="lane-team"|class="lane-number"/);assert.match(html,/readable-time/);assert.match(html,/0:58.42/);f.at(3.9);assert.match(f.render(),/finish-card/);f.at(4);assert.equal(f.render(),'');f.at(5);f.data.state.feed.results.lanes[2].finalTime='0:58.32';assert.equal(f.render(),'')});
test('zero finish duration holds through stopped clock and resets on new heat',()=>{const f=fixture();f.data.state.feed.results={event:3,heat:2,lanes:{2:{finalTime:'0:58.42',place:1}}};f.render();f.at(100,'0:58.4');assert.match(f.render(),/finish-card/);f.at(200,null);f.data.state.feed.results=null;assert.match(f.render(),/0:58.42/);f.data.state.feed.heat=3;f.data.state.program.heats.push({...f.data.state.program.heats[0],heat:3});assert.match(f.render(),/data-phase="start"/);assert.doesNotMatch(f.render(),/0:58.42/)});
test('windows continue while output hidden; split/finish lanes operate independently',()=>{const f=fixture();f.data.config.visible=false;f.data.config.lanePhases.finishDuration=2;f.data.state.feed.results={event:3,heat:2,lanes:{2:{finalTime:'0:58.42',place:1}}};f.render();f.at(3);f.data.config.visible=true;assert.equal(f.render(),'');const g=fixture();g.data.config.lanes[3]=g.data.config.lanes[2];g.data.state.program.heats[0].swimmers.push({lane:3,name:'Jones, Taylor',team:'SHARKS'});g.data.state.feed.results={event:3,heat:2,lanes:{2:{finalTime:'0:58.42',place:1},3:{splits:['0:28.31']}}};const html=g.render();assert.match(html,/data-lane="2" data-phase="finish"/);assert.match(html,/data-lane="3" data-phase="split"/)});
test('running clock advances between packets, freezes on repeated stopped readings and rejects stale data',()=>{const f=fixture();f.at(0,'0:01.0');assert.equal(f.run(`displayClock(${JSON.stringify(f.data)},${BASE})`),'0:01.0');f.at(.4,'0:01.4');assert.equal(f.run(`displayClock(${JSON.stringify(f.data)},${BASE+400})`),'0:01.4');assert.equal(f.run(`displayClock(${JSON.stringify(f.data)},${BASE+650})`),'0:01.6');f.at(.8,'0:01.4');assert.equal(f.run(`displayClock(${JSON.stringify(f.data)},${BASE+800})`),'0:01.4');assert.equal(f.run(`displayClock(${JSON.stringify(f.data)},${BASE+1000})`),'0:01.4');f.at(1,'0:00.0');assert.equal(f.run(`displayClock(${JSON.stringify(f.data)},${BASE+1000})`),'0:00.0');f.data.error='offline';assert.equal(f.run(`displayClock(${JSON.stringify(f.data)},${BASE+1200})`),'—')});

test('personal best is opt-in and compares valid individual finals strictly against seed',()=>{
const f=fixture();f.data.state.feed.results={event:3,heat:2,lanes:{2:{finalTime:'1:01.99',place:1}}};
assert.doesNotMatch(f.render(),/class="personal-best"/);
f.data.config.lanePhases.personalBest=true;assert.match(f.render(),/class="personal-best"/);assert.match(f.render(),/Unofficial/);
for(const finalTime of ['1:02.00','1:02.01','NT','DQ','0:00.00','1:60.00','-1','NaN','58.42 DQ']){f.data.state.feed.results.lanes[2].finalTime=finalTime;assert.doesNotMatch(f.render(),/class="personal-best"/,finalTime)}
f.data.state.feed.results.lanes[2].finalTime='58.42';
for(const seed of ['NT','DQ','—','','0:00.00','1:99.0']){f.data.state.program.heats[0].swimmers[0].seedTime=seed;assert.doesNotMatch(f.render(),/class="personal-best"/,seed)}
f.data.state.program.heats[0].swimmers[0].seedTime='1:02.0';assert.match(f.render(),/class="personal-best"/);
f.data.state.program.heats[0].title='Freestyle Relay';assert.doesNotMatch(f.render(),/class="personal-best"/);
});
test('PB follows finish delay, corrected final, outage hold, and heat reset',()=>{
const f=fixture();f.data.config.lanePhases.personalBest=true;f.data.config.lanePhases.finishDelay=1;
f.data.state.feed.results={event:3,heat:2,lanes:{2:{finalTime:'58.42'}}};assert.doesNotMatch(f.render(),/class="personal-best"/);f.at(1);assert.match(f.render(),/class="personal-best"/);
f.data.state.feed.results.lanes[2].finalTime='1:03.00';assert.doesNotMatch(f.render(),/class="personal-best"/);
f.data.state.feed.results.lanes[2].finalTime='58.42';f.render();f.data.error='offline';f.data.state.feed.results=null;assert.match(f.render(),/class="personal-best"/);
f.data.state.feed.heat=3;assert.doesNotMatch(f.render(),/class="personal-best"/);
});


for(const format of ['board','compact'])test(format+' stays populated through pre-race, racing, mixed finishes and held heat transitions',()=>{
const f=fixture(format),cfg=f.data.config;cfg.fields[format]={...cfg.fields.lanes};cfg.boardPhases={[format]:{splitFields:{...cfg.fields.lanes,first:false,split:true},finishFields:{...cfg.fields.lanes,first:false,last:false,final:true,lane:false},finishHold:5}};
cfg.compact={showHeader:false,showResults:true,resultsX:0,resultsBottom:0,resultsWidth:320,rowHeight:32,initials:false};
f.data.state.program.heats[0].swimmers.push({lane:3,name:'Jones, Taylor',team:'SHARKS'});
assert.match(f.render(),/Jamie Smith/);assert.doesNotMatch(f.render(),/LATEST SPLIT|<th>SPLIT/);
f.at(1,'0:01.0');let html=f.render();assert.match(html,/data-phase="split"/);assert.doesNotMatch(html,/Jamie/);assert.match(html,/Smith/);assert.match(html,/LATEST SPLIT|<th>SPLIT/);
f.at(20,'0:20.0');assert.match(f.render(),/data-phase="split"/); // racing does not wait for a split or expire
f.data.state.feed.results={event:3,heat:2,lanes:{2:{splits:['28.31'],finalTime:'58.42'}}};html=f.render();assert.match(html,/data-lane-slot="2" data-phase="finish"/);assert.match(html,/data-lane-slot="3" data-phase="split"/);assert.match(html,/58.42/);
f.at(200,null);f.data.error='offline';f.data.state.feed.results=null;assert.match(f.render(),/58.42/); // final survives dropout and time passage
f.data.error=null;f.data.state.feed.heat=3;f.data.state.program.heats.push({...f.data.state.program.heats[0],heat:3,swimmers:[{lane:2,name:'Next, Swimmer'}]});
f.at(201,'0:00.0');assert.match(f.render(),/58.42/);assert.match(f.nodes.notice.textContent,/PREVIOUS HEAT/);
f.at(205.9);assert.match(f.render(),/58.42/);f.at(206);html=f.render();assert.doesNotMatch(html,/58.42/);assert.match(html,/Swimmer Next/);assert.match(html,/data-phase="start"/);
// A configured longer hold and source reset are separate from ordinary heat changes.
f.data.state.feed.results={event:3,heat:3,lanes:{2:{finalTime:'1:00.01'}}};f.render();cfg.boardPhases[format].finishHold=8;f.data.state.feed.heat=4;f.at(210);assert.match(f.render(),/1:00.01/);f.at(216);assert.match(f.render(),/1:00.01/);f.data.state.active='another-session';assert.doesNotMatch(f.render(),/1:00.01/);
});

for(const format of ['board','compact'])test(format+' racing split content outlives lane popup duration without a race clock',()=>{
const f=fixture(format),cfg=f.data.config;cfg.autoHide=false;cfg.fields[format]={...cfg.fields.lanes};
cfg.boardPhases={[format]:{splitFields:{...cfg.fields.lanes,split:true},finishFields:{...cfg.fields.lanes,final:true},finishHold:5}};
cfg.compact={showHeader:false,showResults:true,resultsX:0,resultsBottom:0,resultsWidth:320,rowHeight:32,initials:false};
f.at(0,null);f.data.state.feed.results={event:3,heat:2,lanes:{2:{splits:['0:28.31']}}};
assert.match(f.render(),/data-lane-slot="2" data-phase="split"/);
f.at(100);const html=f.render();assert.match(html,/data-lane-slot="2" data-phase="split"/);assert.match(html,/0:28.31/);
});

for(const format of ['lanes','board','compact'])test(format+' retracts an explicitly corrected finish and allows the real finish',()=>{
 const f=fixture(format),cfg=f.data.config;
 cfg.fields[format]={...cfg.fields.lanes,final:true,split:true};
 cfg.boardPhases=Object.fromEntries(['board','compact'].map(key=>[key,{splitFields:{...cfg.fields[format]},finishFields:{...cfg.fields[format]},finishHold:5}]));
 cfg.compact={showHeader:false,showResults:true,resultsX:0,resultsBottom:0,resultsWidth:624,rowHeight:32,initials:false};
 f.at(40.2,'0:40.2');
 const results={event:3,heat:2,source:'serial',lanes:{2:{splits:['0:08.03'],finalTime:'0:40.15',place:1}}};
 f.data.state.feed.results=results;
 assert.match(f.render(),/data-phase="finish"/);
 // Missing results/outages still hold finishes; absence alone is not correction.
 f.data.state.feed.results=null;assert.match(f.render(),/data-phase="finish"/);
 f.data.error='offline';assert.match(f.render(),/data-phase="finish"/);f.data.error=null;
 f.data.state.feed.results=results;f.at(58.4,'0:58.4');
 results.lanes[2]={splits:['0:08.03','0:40.15'],finalTime:null,place:null,finishRevision:1};
 assert.doesNotMatch(f.render(),/data-phase="finish"/);
 assert.match(f.render(),/data-phase="split"/);
 assert.equal(f.run('heldFinishes.size'),0);
 f.at(86.3,'1:26.3');results.lanes[2].finalTime='1:26.28';results.lanes[2].place=1;
 assert.match(f.render(),/data-phase="finish"/);assert.match(f.render(),/1:26.28/);
 assert.equal(f.run('heldFinishes.get("2").seen'),BASE+86300);
});
test('a missed correction poll still restarts the finish window using its revision',()=>{
 const f=fixture();f.at(40.2,'0:40.2');
 f.data.state.feed.results={event:3,heat:2,source:'replay',lanes:{2:{finalTime:'0:40.15',place:1}}};f.render();
 f.at(86.3,'1:26.3');f.data.state.feed.results.lanes[2]={finalTime:'1:26.28',place:1,finishRevision:1};
 assert.match(f.render(),/1:26.28/);assert.equal(f.run('heldFinishes.get("2").seen'),BASE+86300);
});

for(const format of ['lanes','board','compact'])test(format+' displays configured achievement images only for matching posted final standards',()=>{
 const f=fixture(format),cfg=f.data.config,h=f.data.state.program.heats[0];
 cfg.achievements={images:{personalBest:'/images/'+'a'.repeat(64)+'.png',standard:'/images/'+'b'.repeat(64)+'.png'},standardLabel:'NYS',standards:{lanes:true,board:true,compact:true}};
 cfg.lanePhases.personalBest=true;cfg.personalBestBoards={board:true,compact:true};
 cfg.fields[format]={...cfg.fields.lanes,final:true,split:true};
 cfg.boardPhases=Object.fromEntries(['board','compact'].map(k=>[k,{splitFields:{...cfg.fields[format]},finishFields:{...cfg.fields[format]},finishHold:5}]));
 cfg.compact={showHeader:false,showResults:true,resultsX:0,resultsBottom:0,resultsWidth:624,rowHeight:32,initials:false};
 h.title='Girls 13 & Over 100 Yard Breaststroke';h.swimmers[0].age=16;h.swimmers[0].seedTime='1:30.00';
 h.timeStandards=[{name:'NYS',time:'1:23.00',minAge:13,maxAge:14,gender:'F'},{name:'NYS',time:'1:20.50',minAge:15,maxAge:null,gender:'F'}];
 assert.doesNotMatch(f.render(),/class="standard-badge"/);
 f.at(80.5,'1:20.5');f.data.state.feed.results={event:3,heat:2,lanes:{2:{finalTime:'1:20.50',place:1}}};
 let html=f.render();assert.match(html,/class="standard-badge"/);assert.match(html,/NYS posted standard met/);assert.match(html,/\/images\/b{64}\.png/);assert.match(html,/\/images\/a{64}\.png/);
 if(format==='lanes')assert.match(html,/two-awards/);else assert.ok(html.indexOf('standard-cell')<html.indexOf('pb-cell'));
 f.data.state.feed.results.lanes[2].finalTime='1:20.51';assert.doesNotMatch(f.render(),/class="standard-badge"/);
 h.swimmers[0].age=14;assert.match(f.render(),/class="standard-badge"/);
 h.swimmers[0].gender='M';assert.doesNotMatch(f.render(),/class="standard-badge"/);h.swimmers[0].gender=null;
 h.swimmers[0].age=null;assert.doesNotMatch(f.render(),/class="standard-badge"/);h.swimmers[0].age=14;
 h.timeStandards.push({...h.timeStandards[0]});assert.doesNotMatch(f.render(),/class="standard-badge"/);h.timeStandards.pop();
 cfg.achievements.standardLabel='OTHER';assert.doesNotMatch(f.render(),/class="standard-badge"/);cfg.achievements.standardLabel='NYS';
 cfg.achievements.standards[format]=false;assert.doesNotMatch(f.render(),/class="standard-badge"/);cfg.achievements.standards[format]=true;
 f.data.state.feed.results.lanes[2]={splits:['0:40.00'],finalTime:null,place:null,finishRevision:1};assert.doesNotMatch(f.render(),/class="standard-badge"/);
 f.data.state.feed.results.lanes[2].finalTime='1:20.00';assert.match(f.render(),/class="standard-badge"/);
 f.data.state.feed.results=null;f.data.error='offline';assert.match(f.render(),/class="standard-badge"/);
 f.data.error=null;f.data.state.feed.heat=99;f.render();if(format!=='lanes')f.at(86.5,'1:26.5');assert.doesNotMatch(f.render(),/class="standard-badge"/);
});
test('mixed event standards require explicit swimmer gender and relays never claim individual awards',()=>{
 const f=fixture();f.data.config.achievements={standardLabel:'NYS'};
 const row={entries:[{age:10,gender:'F'}],relay:false,timeStandards:[{name:'NYS',time:'2:50.00',minAge:9,maxAge:10,gender:'F'},{name:'NYS',time:'2:55.00',minAge:9,maxAge:10,gender:'M'}]};
 const check=()=>f.run(`matchedStandard(${JSON.stringify(row)},'2:52.00')`);
 assert.equal(check(),null);row.entries[0].gender='M';assert.equal(check().time,'2:55.00');row.entries[0].gender=null;assert.equal(check(),null);
 row.entries[0].gender='M';row.relay=true;assert.equal(check(),null);
});
