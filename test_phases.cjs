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

for(const format of ['board','compact'])test(format+' rows have independent phase fields, delays, expiry and blank reserved slots',()=>{
const f=fixture(format),cfg=f.data.config;
cfg.fields[format]={...cfg.fields.lanes};
cfg.boardPhases={[format]:{...cfg.lanePhases,finishEnabled:true,autoHide:false,splitDelay:1,splitDuration:2,finishDelay:1,finishDuration:2}};
const o=cfg.boardPhases[format];o.splitFields={...cfg.fields[format],first:false,split:true};o.finishFields={...cfg.fields[format],first:false,last:false,final:true,lane:false};
cfg.compact={showHeader:false,showResults:true,resultsX:0,resultsBottom:0,resultsWidth:624,rowHeight:32,initials:false};
cfg.lanes[3]=cfg.lanes[2];f.data.state.program.heats[0].swimmers.push({lane:3,name:'Jones, Taylor',team:'SHARKS'});
assert.match(f.render(),/Jamie Smith/);
f.data.state.feed.results={event:3,heat:2,lanes:{2:{splits:['28.31']}}};
assert.match(f.render(),/Jamie Smith/);assert.match(f.render(),/Taylor Jones/);
f.at(1);assert.match(f.render(),/data-phase="split"/);assert.match(f.render(),/28.31/);assert.doesNotMatch(f.render(),/Jamie/);
f.at(3);assert.match(f.render(),/Jamie Smith/); // split expired: configured start state resumes
f.data.state.feed.results.lanes[2].finalTime='58.42';assert.doesNotMatch(f.render(),/58.42/);
f.at(4);const html=f.render();assert.match(html,/data-lane-slot="2" data-phase="finish"/);assert.match(html,/58.42/);assert.doesNotMatch(html,/Jamie Smith/);assert.match(html,/Taylor Jones/);
f.at(6);assert.doesNotMatch(f.render(),/58.42/);assert.match(f.render(),/data-lane-slot="2" data-phase="" class="unused-lane"/);
o.finishDuration=0;assert.match(f.render(),/58.42/);o.finishEnabled=false;assert.doesNotMatch(f.render(),/58.42/);
f.data.state.feed.heat=3;assert.doesNotMatch(f.render(),/58.42/);
});
