const fs=require('node:fs'),vm=require('node:vm'),test=require('node:test'),assert=require('node:assert/strict');
const BASE=1700000000000;
function fixture(format='lanes'){let now=BASE;class Clock extends Date{static now(){return now}}
const nodes={broadcast:{innerHTML:'',replaceChildren(){this.innerHTML=''}},notice:{textContent:''}};
const context=vm.createContext({document:{body:{classList:{contains:()=>false}},getElementById:id=>nodes[id]},location:{search:'?format='+format},URLSearchParams,Date:Clock,setTimeout:()=>{},clearTimeout:()=>{}});
vm.runInContext(fs.readFileSync(__dirname+'/static/app.js','utf8').replace(/poll\(\);\s*$/,''),context);vm.runInContext("updateLaneCards=cards=>document.getElementById('broadcast').innerHTML=cards.join('')",context);
const fields={lane:true,place:true,first:true,last:true,team:true,seed:false,split:false,final:false};
const data={received:BASE/1000,error:null,now:BASE/1000,config:{visible:true,autoHide:true,finishPopups:true,fields:{lanes:{...fields}},lanePhases:{splitFields:{...fields,split:true},finishFields:{...fields,first:false,team:false,final:true,lane:false},startEnabled:true,splitEnabled:true,startDelay:0,startDuration:0,startHideDelay:.5,splitDelay:0,splitDuration:5,finishDelay:0,finishDuration:0,uprightTimes:true,timeSize:36},lanes:{2:{enabled:true,points:[[10,10],[710,10],[710,100],[10,100]]}}},state:{active:'session',program:{heats:[{event:3,heat:2,title:'Freestyle',swimmers:[{lane:2,name:'Smith, Jamie',team:'WAVES',seedTime:'1:02.00'}]}]},feed:{event:3,heat:2,connected:true,clockLast:BASE/1000,raceClock:'0:00.0'}}};
return {data,nodes,run:s=>vm.runInContext(s,context),at(seconds,clock){now=BASE+seconds*1000;data.now=now/1000;data.received=now/1000;data.state.feed.clockLast=now/1000;if(clock!==undefined)data.state.feed.raceClock=clock},render(){vm.runInContext(`renderOutput(${JSON.stringify(data)})`,context);return nodes.broadcast.innerHTML}}}
test('start delay, finite duration and clock grace are independent',()=>{const f=fixture(),p=f.data.config.lanePhases;p.startDelay=2;p.startDuration=3;assert.equal(f.render(),'');f.at(2);assert.match(f.render(),/data-phase="start"/);f.at(4.9);assert.match(f.render(),/Jamie Smith/);f.at(5);assert.equal(f.render(),'');const g=fixture();g.data.config.lanePhases.startHideDelay=2;g.render();g.at(1,'0:01.0');assert.match(g.render(),/data-phase="start"/);g.at(2,'0:02.0');assert.equal(g.render(),'');g.at(3,null);assert.equal(g.render(),'')});
test('split delay/expiry tracks new values, not repeated poll timestamps',()=>{const f=fixture(),p=f.data.config.lanePhases;p.startEnabled=false;p.splitDelay=1;p.splitDuration=2;f.data.state.feed.results={event:3,heat:2,lanes:{2:{splits:['0:28.31']}}};assert.equal(f.render(),'');f.at(1);assert.match(f.render(),/data-phase="split"/);assert.match(f.render(),/0:28.31/);f.at(2.9);assert.match(f.render(),/0:28.31/);f.at(3);assert.equal(f.render(),'');f.at(5);assert.equal(f.render(),'');f.data.state.feed.results.lanes[2].splits.push('0:58.42');assert.equal(f.render(),'');f.at(6);assert.match(f.render(),/0:58.42/)});
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
