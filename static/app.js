'use strict';
const CLIENT_VERSION='__APP_VERSION__';
const $=id=>document.getElementById(id), output=document.body.classList.contains('output');
const labels={lane:'Lane number',place:'Heat placement',first:'First name',last:'Last name',team:'Team',seed:'Seed time',split:'Latest split',final:'Final time'};
let cfg=null, latest=null, saving=false, dirty=false, timer,cfgRevision=null,cfgEpoch=0,pollFailed=false;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function lastItem(items){return items&&items.length?items[items.length-1]:null}
async function requestJSON(url,options={}){const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),2500);try{const response=await fetch(url,{...options,cache:'no-store',signal:controller.signal});const data=await response.json();if(!response.ok)throw Error(data.error||`HTTP ${response.status}`);return data}finally{clearTimeout(timeout)}}
function nameParts(name){if(name.includes(',')){const [last,...first]=name.split(',');return [first.join(',').trim(),last.trim()]}const p=name.trim().split(/\s+/);return [p.slice(0,-1).join(' '),p[p.length-1]||'']}
function swimmerName(s,fields){const [first,last]=nameParts(s.name||'');return [fields.first?first:'',fields.last?last:''].filter(Boolean).join(' ')}
function compactName(swimmer,fields){const [first,last]=nameParts(swimmer.name||'');return [fields.last?last.toUpperCase():'',fields.first&&first?first.charAt(0).toUpperCase()+'.':''].filter(Boolean).join(fields.first&&fields.last?', ':'')}
function fixedLaneRows(rows,program,config){
const numbered=(program?.heats||[]).flatMap(h=>(h.swimmers||[]).map(s=>String(s.lane))).filter(lane=>/^\d{1,2}$/.test(lane)).map(Number);
const first=numbered.includes(0)?0:1,last=numbered.reduce((maximum,lane)=>Math.max(maximum,lane),config.alignment?.count||8),byLane=new Map(rows.map(row=>[Number(row.slot||row.lane),row]));
return Array.from({length:last-first+1},(_,i)=>{const lane=first+i;return byLane.get(lane)||{empty:true,slot:String(lane),lane:'',name:'',team:'',seed:'',split:'',final:'',place:''}});
}
function clockSeconds(clock){if(!/^\d+:\d{2}(\.\d+)?$/.test(clock||''))return null;const [m,s]=clock.split(':').map(Number);return m*60+s}
function liveData(data){const s=data.state||{},f=s.feed||{};const fresh=!data.error&&Date.now()/1000-data.received<4&&f.connected&&Date.now()/1000-(f.clockLast||0)<4;const heat=(s.program?.heats||[]).find(h=>String(h.event)===String(f.event)&&String(h.heat)===String(f.heat));return {s,f,fresh,heat,clock:fresh?(f.raceClock||'—'):'—'}}
let clockMotion={key:null};
function displayClock(data,now=Date.now()){
const {s,f,fresh,clock}=liveData(data),key=JSON.stringify([s.active,f.event,f.heat,f.replayId,f.serialRace]),seconds=clockSeconds(clock),packet=f.clockLast||0;
if(!fresh||seconds===null){clockMotion={key:null};return clock}
if(clockMotion.key!==key){clockMotion={key,seconds,packet,anchor:now,changed:now,moving:false,shown:seconds};return clock}
const m=clockMotion;
if(seconds!==m.seconds){const delta=seconds-m.seconds;m.moving=delta>0&&delta<10;m.seconds=seconds;m.anchor=now-Math.min(500,Math.max(0,((data.now??now/1000)-packet)*1000));m.changed=now;if(delta<0||delta>=10)m.shown=seconds}
else if(packet>m.packet){m.moving=false;m.shown=seconds;m.anchor=now}
m.packet=packet;
if(m.moving&&now-m.changed<=800)m.shown=Math.max(m.shown,seconds+Math.min(.5,Math.max(0,(now-m.anchor)/1000)));
const tenths=Math.floor((m.moving?m.shown:seconds)*10+1e-5),minutes=Math.floor(tenths/600),rest=tenths%600;
return `${minutes}:${String(Math.floor(rest/10)).padStart(2,'0')}.${rest%10}`;
}
// Homography from the unit square to any convex four-corner lane card.
function transform(p){const [a,b,c,d]=p,dx1=b[0]-c[0],dx2=d[0]-c[0],dy1=b[1]-c[1],dy2=d[1]-c[1],sx=a[0]-b[0]+c[0]-d[0],sy=a[1]-b[1]+c[1]-d[1],det=dx1*dy2-dx2*dy1;if(Math.abs(det)<.00001)return '';const g=(sx*dy2-dx2*sy)/det,h=(dx1*sy-sx*dy1)/det;return `matrix3d(${(b[0]-a[0]+g*b[0])/720},${(b[1]-a[1]+g*b[1])/720},0,${g/720},${(d[0]-a[0]+h*d[0])/90},${(d[1]-a[1]+h*d[1])/90},0,${h/90},0,0,1,0,${a[0]},${a[1]},0,1)`}
function project(points,u,v){const [a,b,c,d]=points,dx1=b[0]-c[0],dx2=d[0]-c[0],dy1=b[1]-c[1],dy2=d[1]-c[1],sx=a[0]-b[0]+c[0]-d[0],sy=a[1]-b[1]+c[1]-d[1],det=dx1*dy2-dx2*dy1,g=(sx*dy2-dx2*sy)/det,h=(dx1*sy-sx*dy1)/det,w=g*u+h*v+1;return [0,1].map(j=>((b[j]-a[j]+g*b[j])*u+(d[j]-a[j]+h*d[j])*v+a[j])/w)}
function lanePoints(config,lane){const a=config.alignment;if(!a?.usePool)return config.lanes[lane].points;const n=a.count,index=a.reverse?n-Number(lane):Number(lane)-1,v=(index+(1-a.height)/2)/n,bottom=v+a.height/n,u=a.position,end=u+a.length;return [[u,v],[end,v],[end,bottom],[u,bottom]].map(([x,y],i)=>project(a.points,x,y).map((value,j)=>value+(config.lanes[lane].offsets?.[i]?.[j]||0)))}
function enabledLanes(config){return Object.keys(config.lanes).filter(k=>config.lanes[k].enabled&&(!config.alignment?.usePool||Number(k)<=config.alignment.count))}
function validQuad(p){return p.length===4&&p.every(v=>v.every(n=>Number.isFinite(n)&&Math.abs(n)<=10000))&&[1,-1].some(sign=>p.every((a,i)=>{const b=p[(i+1)%4],c=p[(i+2)%4];return sign*((b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]))>1}))}
function updateLaneCards(cards){
const host=$('broadcast'),keep=new Set();for(const html of cards){const node=document.createElement('div');node.innerHTML=html;const card=node.firstElementChild,id=card.dataset.lane;keep.add(id);const old=host.querySelector(`[data-lane="${id}"]`);if(old&&old.outerHTML===card.outerHTML)continue;if(old){if(old.dataset.event===card.dataset.event)for(const selector of ['.personal-best','.standard-badge']){if(old.querySelector(selector)){const award=card.querySelector(selector);if(award)award.style.animation='none'}}if(old.dataset.phase===card.dataset.phase&&old.dataset.event===card.dataset.event)for(const animated of card.querySelectorAll('.finish-card,.split-card'))animated.style.animation='none';if(old.outerHTML===card.outerHTML)continue;old.replaceWith(card)}else host.append(card)}for(const card of [...host.children])if(!keep.has(card.dataset.lane))card.remove();
}
function phaseOptions(config){return config.lanePhases||{splitFields:{...config.fields.lanes,split:true,final:false},finishFields:{...config.fields.lanes},startEnabled:true,splitEnabled:true,startDelay:0,startDuration:0,startHideDelay:.5,splitDelay:0,splitDuration:5,finishDelay:0,finishDuration:0,uprightTimes:false,timeSize:36}}
let boardPBSeen=new Set(),tableHistory={key:null,source:null,html:'',pending:null};
let finishKey=null,heldFinishes=new Map(),heldSplits=new Map(),raceStarted=false,raceStartAt=null,heatSeenAt=null;
function overlayPhase(lane,config,now){const o=phaseOptions(config),finish=heldFinishes.get(lane),split=heldSplits.get(lane);
if(finish){const elapsed=(now-finish.seen)/1000-o.finishDelay;return config.finishPopups&&elapsed>=0&&(!o.finishDuration||elapsed<o.finishDuration)?'finish':null}
// An observed split supersedes Start, even while delayed, disabled or expired.
if(split){const elapsed=(now-split.seen)/1000-o.splitDelay;return o.splitEnabled&&elapsed>=0&&elapsed<o.splitDuration?'split':null}
const elapsed=heatSeenAt===null?-1:(now-heatSeenAt)/1000-o.startDelay;
return o.startEnabled&&elapsed>=0&&(!o.startDuration||elapsed<o.startDuration)&&(!config.autoHide||raceStartAt===null||(now-raceStartAt)/1000<o.startHideDelay)?'start':null;
}
function phaseFields(config,phase,format='lanes'){return phase==='start'?config.fields[format]:(format==='lanes'?phaseOptions(config):config.boardPhases[format])[phase+'Fields']}
function phaseName(row,fields){return row.relay?((fields.first||fields.last||fields.team)?row.relayName:''):row.entries.map(s=>swimmerName(s,fields)).filter(Boolean).join(' / ')}
function timeBadge(kind,value,font){return `<div class="readable-time" style="font-size:${font}px"><small>${kind==='final'?'FINAL':kind==='split'?'SPLIT':'SEED'}</small><strong>${esc(value)}</strong></div>`}
// Compare integer hundredths; reject status strings and malformed timing values.
function swimHundredths(value){
if(typeof value!=='string')return null;
const match=/^(?:(\d{1,3}):)?(\d{1,2})(?:\.(\d{1,2}))?$/.exec(value.trim());
if(!match||Number(match[2])>=60)return null;
const time=(Number(match[1]||0)*60+Number(match[2]))*100+Number((match[3]||'').padEnd(2,'0'));
return time>0?time:null;
}
function splitTime(splits,mode='subtractive'){
if(!Array.isArray(splits)||!splits.length)return '—';
const value=lastItem(splits);
if(mode!=='subtractive')return value||'—';
const current=swimHundredths(value),previous=splits.length>1?swimHundredths(splits[splits.length-2]):0;
if(current===null||previous===null||current<=previous)return '—';
if(splits.length===1)return value;
const difference=current-previous,minutes=Math.floor(difference/6000),seconds=Math.floor(difference%6000/100),hundredths=difference%100;
return `${minutes}:${String(seconds).padStart(2,'0')}.${String(hundredths).padStart(2,'0')}`;
}
function isPersonalBest(row,finalTime){const seed=swimHundredths(row.seed),final=swimHundredths(finalTime);return !row.relay&&row.entries.length===1&&seed!==null&&final!==null&&final<seed}
function badgeImage(kind,config=cfg){const value=config?.achievements?.images?.[kind];return typeof value==='string'&&(/^(?:\/personal-best\.png|\/nys-2027\.png|\/images\/[a-f0-9]{64}\.png)$/.test(value))?value:kind==='personalBest'?'/personal-best.png':'/nys-2027.png'}
function personalBestBadge(config=cfg){return `<div class="personal-best" role="img" aria-label="Personal Best — Unofficial. Faster than seed time."><img src="${esc(badgeImage('personalBest',config))}" alt="" width="260" height="86"></div>`}
function matchedStandard(row,finalTime,config=cfg){
 if(row.relay||row.entries?.length!==1)return null;
 const final=swimHundredths(finalTime);if(final===null)return null;
 const swimmer=row.entries[0],label=(config?.achievements?.standardLabel||'NYS').toUpperCase();
 const gender=swimmer.gender==='W'?'F':swimmer.gender||row.eventGender;
 const matches=(row.timeStandards||[]).filter(s=>{
  const age=swimmer.age,cut=swimHundredths(s.time);
  return typeof s.name==='string'&&s.name.toUpperCase()===label&&cut!==null&&final<=cut&&
   (s.gender==null||s.gender===gender)&&
   ((s.minAge==null&&s.maxAge==null)||(Number.isInteger(age)&&(s.minAge==null||age>=s.minAge)&&(s.maxAge==null||age<=s.maxAge)));
 });
 // Conflicting overlapping groups must not select an arbitrary standard.
 return matches.length===1?matches[0]:null;
}
function standardBadge(standard,config=cfg){return `<div class="standard-badge" role="img" aria-label="${esc(standard.name)} posted standard met — ${esc(standard.time)}. Unofficial."><img src="${esc(badgeImage('standard',config))}" alt="" width="260" height="86"></div>`}
function boardStandardCell(row){return !row.empty&&row.standardMet?`<span class="board-standard">${standardBadge(row.standardMet)}</span>`:''}
function renderPhaseCard(row,config,phase){const fields=phaseFields(config,phase),options=phaseOptions(config),finish=heldFinishes.get(row.lane),split=heldSplits.get(row.lane),points=lanePoints(config,row.lane),values={seed:row.seed,split:split?splitTime(split.splits,config.splitModes?.lanes):row.split,final:finish?.finalTime||row.final},place=finish?.place,primary=phase==='finish'&&fields.final?'final':phase==='split'&&fields.split?'split':fields.seed?'seed':null,badge=options.uprightTimes&&primary&&values[primary]!=='—',number=phase==='finish'?(fields.place?`<div class="finish-number" aria-label="${place?`Place ${esc(place)}`:'Placement pending'}">${esc(place||'—')}</div>`:''):(fields.lane?`<div class="lane-number">${esc(row.lane)}</div>`:''),other=['seed','split','final'].filter(k=>fields[k]&&(!badge||k!==primary)),name=phaseName(row,fields),showTeam=fields.team&&!row.relay,timeFont=Math.min(options.timeSize,Math.max(18,76-(name?25:0)-(showTeam?15:0)));
const personalBest=phase==='finish'&&options.personalBest&&isPersonalBest(row,values.final),standard=phase==='finish'&&config.achievements?.standards?.lanes?matchedStandard(row,values.final,config):null;
const awards=[personalBest?personalBestBadge(config):'',standard?standardBadge(standard,config):''].filter(Boolean).join('');
return `<div class="lane-output" data-lane="${esc(row.lane)}" data-phase="${phase}" data-event="${esc(phase==='split'?split?.signature:phase==='finish'?finish?.seen:heatSeenAt)}"><div class="lane-card ${phase==='finish'?'finish-card':phase==='split'?'split-card':''} ${badge?'has-readable-time':''} ${personalBest||standard?'has-personal-best':''}" style="transform:${transform(points)}">${number}<div class="lane-info"><div class="lane-name">${esc(name)}</div>${showTeam?`<div class="lane-team">${esc(row.team)}</div>`:''}${badge?timeBadge(primary,values[primary],timeFont):''}</div><div class="lane-times">${phase==='finish'&&fields.lane?`<div>Lane ${esc(row.lane)}</div>`:''}${phase==='finish'&&!place?'<strong class="finish-place">FINISHED</strong>':''}${other.map(k=>`<div>${esc(labels[k])} ${esc(values[k])}</div>`).join('')}</div>${awards?`<div class="lane-achievements ${personalBest&&standard?'two-awards':''}">${awards}</div>`:''}</div></div>`
}
function boardPBCell(row,format){
if(row.empty||!(row.pbEligible??isPersonalBest(row,row.final)))return '';
const key=format+':'+(row.slot||row.lane),first=!boardPBSeen.has(key);boardPBSeen.add(key);
return `<span class="board-pb ${first?'pb-new':''}">${personalBestBadge()}</span>`;
}
function compactAchievementCell(row,config){
const badges=[config.achievements?.standards?.compact?boardStandardCell(row):'',config.personalBestBoards?.compact?boardPBCell(row,'compact'):''].filter(Boolean);
return badges.length?`<div class="compact-achievements ${badges.length===2?'two-awards':''}">${badges.join('')}</div>`:'';
}
function compactStandardText(heat){
const entries=(heat?.timeStandards||[]).filter(s=>typeof s.name==='string'&&s.name.trim()&&swimHundredths(s.time)!==null&&
 [s.minAge,s.maxAge].every(age=>age==null||(Number.isInteger(age)&&age>=0))&&
 !(s.minAge!=null&&s.maxAge!=null&&s.minAge>s.maxAge)&&[null,undefined,'M','F','W'].includes(s.gender));
return [...new Set(entries.map(s=>{const ages=s.minAge!=null?(s.maxAge!=null?(s.minAge===0?`${s.maxAge} & under`:s.minAge===s.maxAge?String(s.minAge):`${s.minAge}–${s.maxAge}`):`${s.minAge}+`):s.maxAge!=null?`${s.maxAge} & under`:'';return [s.name.trim(),ages,s.gender==='W'?'F':s.gender,s.time].filter(Boolean).join(' ')}))].join(' · ');
}
function compactAchievementHeading(config){return config.personalBestBoards?.compact?(config.achievements?.standards?.compact?`PB / ${config.achievements.standardLabel}`:'PB / UNOFFICIAL'):(config.achievements?.standardLabel||'STANDARD')}
function tableLayout(rows,fields,showName,columns,format,config){
const requested=format==='compact'?config.compact.resultsWidth:(config.boardWidth||1760),font=format==='compact'?Math.min(18,Math.max(12,requested*.026)):Math.min(28,Math.max(18,requested*.016));
const keys=[...(fields.lane?['lane']:[]),...(showName?['name']:[]),...columns];
const widths=keys.map(k=>['seed','split','final'].includes(k)?Math.ceil(Math.max(7,...rows.map(r=>String(r[k]||'').length))*font*.68+18):k==='name'?(format==='compact'?100:150):k==='team'?80:k==='achievements'?(rows.some(r=>!r.empty&&r.standardMet&&(r.pbEligible??isPersonalBest(r,r.final)))&&config.achievements?.standards?.compact&&config.personalBestBoards?.compact?180:120):['pb','standard'].includes(k)?120:k==='place'?60:45);
const minimum=widths.reduce((a,b)=>a+b,0)+8,width=Math.max(requested,minimum),extra=Math.max(0,width-minimum),weights=keys.map(k=>k==='name'?3:k==='team'?2:1),total=weights.reduce((a,b)=>a+b,0)||1;
return {width,font,widths:widths.map((w,i)=>w+extra*weights[i]/total)};
}
function holdPreviousTable(data,format,key,now){
const s=data.state||{},f=s.feed||{},source=JSON.stringify([s.active??null,f.replayId??null,f.serialRace??null]);
if(!data.config.visible){tableHistory.pending=null;return false}
if(tableHistory.key===key){tableHistory.pending=null;return false}
if(!data.config.boardPhases?.[format]||!tableHistory.html||source!==tableHistory.source||!heldFinishes.size||f.event==null||f.heat==null){tableHistory.pending=null;return false}
if(tableHistory.pending?.key!==key)tableHistory.pending={key,since:now};
const seconds=data.config.boardPhases[format].finishHold??5;
if(now-tableHistory.pending.since>=seconds*1000)return false;
const html=tableHistory.html.replace(/board-pb pb-new/g,'board-pb');if($('broadcast').innerHTML!==html)$('broadcast').innerHTML=html;$('notice').textContent=`PREVIOUS HEAT RESULTS · next heat in ${Math.ceil(seconds-(now-tableHistory.pending.since)/1000)}s`;return true;
}
function rememberTable(s,f,key){tableHistory={key,source:JSON.stringify([s.active??null,f.replayId??null,f.serialRace??null]),html:$('broadcast').innerHTML,pending:null}}
function renderOutput(data){cfg=data.config;const {s,f,fresh,heat,clock}=liveData(data),format=new URLSearchParams(location.search).get('format')||cfg.mode;
const fields=cfg.fields[format]||cfg.fields;
const now=Date.now(),key=JSON.stringify([s.active??null,f.event??null,f.heat??null,f.replayId??null,f.serialRace??null]);if(format!=='lanes'&&holdPreviousTable(data,format,key,now))return;if(key!==finishKey){heldFinishes.clear();heldSplits.clear();boardPBSeen.clear();raceStarted=false;raceStartAt=null;heatSeenAt=null;finishKey=key}if(heat&&heatSeenAt===null)heatSeenAt=now;
const notice=[];if(f.replay)notice.push(f.replayEstimated?'REPLAY · ESTIMATED TIMING':'REPLAY');if(f.simulated)notice.push('SIMULATED TIMING');if(f.results?.source==='manual')notice.push('MANUALLY ENTERED RESULTS');if(data.error)notice.push('MANAGER OFFLINE · timing unavailable');else if(!fresh)notice.push('TIMING DISCONNECTED / STALE');if(!s.program)notice.push('NO ACTIVE PROGRAM');else if(!heat)notice.push('WAITING FOR MATCHING EVENT / HEAT');
const aligning=format==='lanes'&&cfg.alignment?.active;
if(aligning){$('notice').textContent=(f.replay?'REPLAY · ':'')+'ALIGNMENT MODE · Exit alignment before going on air';$('broadcast').innerHTML=enabledLanes(cfg).map(lane=>`<div class="lane-card alignment-card" style="transform:${transform(lanePoints(cfg,lane))}"><div class="lane-number">${esc(lane)}</div><div><div class="lane-name">LANE ${esc(lane)} · ALIGNMENT</div><div class="lane-team">Start → Finish</div></div></div>`).join('');return}
if(fresh&&(clockSeconds(clock)??0)>0&&raceStartAt===null)raceStartAt=now-clockSeconds(clock)*1000;
if(raceStartAt!==null)raceStarted=true;
const hidden=!cfg.visible||(format==='lanes'&&cfg.autoHide&&raceStarted);
$('notice').textContent=cfg.visible?notice.join(' · '):'';

// Never retain an old heat when the active program or live event changes.
const swimmers=heat?.swimmers||[], lanes=new Map();for(const s of swimmers){const k=String(s.lane);if(!lanes.has(k))lanes.set(k,[]);lanes.get(k).push(s)}
const results=!data.error&&Date.now()/1000-data.received<4&&(!f.results?.session||f.results.session===s.active)&&String(f.results?.event)===String(heat?.event)&&String(f.results?.heat)===String(heat?.heat)?f.results:null;
if(results&&Object.values(results.lanes||{}).some(r=>r.finalTime||r.splits?.length))raceStarted=true;
if(results)for(const [lane,result] of Object.entries(results.lanes||{})){const held=heldFinishes.get(lane);if(held&&(result.finishRevision??0)>(held.finishRevision??0)){heldFinishes.delete(lane);boardPBSeen.delete('board:'+lane);boardPBSeen.delete('compact:'+lane)}if(result.finalTime)heldFinishes.set(lane,{...result,source:results.source,seen:heldFinishes.get(lane)?.seen??now});const value=lastItem(result.splits);if(value){const signature=JSON.stringify([result.splits.length,value]),previous=heldSplits.get(lane);heldSplits.set(lane,{splits:[...result.splits],signature,seen:previous?.signature===signature?previous.seen:now,source:results.source})}}
if(!cfg.visible){$('broadcast').replaceChildren();return}
if(format==='lanes'&&[...heldFinishes.values()].some(r=>r.source==='manual')&&!notice.includes('MANUALLY ENTERED RESULTS')){$('notice').textContent=cfg.visible?[...notice,'MANUALLY ENTERED RESULTS'].join(' · '):''}
let rows=[...lanes.entries()].sort((a,b)=>Number(a[0])-Number(b[0])).map(([lane,entries])=>{const swimmer=entries[0],result=results?.lanes?.[lane],finish=heldFinishes.get(lane);const relay=entries.some(s=>s.leg!=null||s.relayEntry!=null)||/\brelay\b/i.test(heat?.title||''),relayName=[swimmer.team,swimmer.relayEntry?`'${swimmer.relayEntry}'`:''].filter(Boolean).join(' ')||'Relay team';return {lane,relay,relayName,entries,timeStandards:heat?.timeStandards||[],eventGender:/^Girls\b/i.test(heat?.title||'')?'F':/^Boys\b/i.test(heat?.title||'')?'M':null,name:relay?((fields.first||fields.last||fields.team)?relayName:''):entries.map(s=>format==='compact'&&cfg.compact.initials?compactName(s,fields):swimmerName(s,fields)).filter(Boolean).join(' / '),team:swimmer.team||'—',seed:swimmer.seedTime||'—',split:splitTime(result?.splits,cfg.splitModes?.[format]),final:result?.finalTime||'—',place:result?.place??'—',finish}});
if(format==='lanes'){
const cards=rows.filter(r=>enabledLanes(cfg).includes(r.lane)).map(r=>{const phase=overlayPhase(r.lane,cfg,now);return phase?renderPhaseCard(r,cfg,phase):null}).filter(Boolean);
updateLaneCards(cards);return}
// Tables always remain populated: pre-race, racing, then per-swimmer finishes.
let tableFields=fields;
if(cfg.boardPhases?.[format]){
 rows=rows.map(row=>{const phase=heldFinishes.has(row.lane)?'finish':raceStarted?'split':'start',selected=phaseFields(cfg,phase,format),finish=heldFinishes.get(row.lane),split=heldSplits.get(row.lane),original={...row,final:finish?.finalTime||row.final},result={...row,phase,final:original.final,split:split?splitTime(split.splits,cfg.splitModes?.[format]):row.split,place:finish?.place??row.place};
 result.name=row.relay?((selected.first||selected.last||selected.team)?row.relayName:''):row.entries.map(s=>format==='compact'&&cfg.compact.initials?compactName(s,selected):swimmerName(s,selected)).filter(Boolean).join(' / ');
 for(const k of ['lane','team','seed','split','final','place'])if(!selected[k])result[k]='';
 result.standardMet=phase==='finish'?matchedStandard(original,original.final):null;result.slot=row.lane;result.pbEligible=phase==='finish'&&isPersonalBest(original,original.final);return result;
 });
 const phases=new Set(rows.map(r=>r.phase));if(!phases.size)phases.add(raceStarted?'split':'start');
 const sets=[...phases].map(p=>phaseFields(cfg,p,format));
 tableFields=Object.fromEntries(Object.keys(labels).map(k=>[k,sets.some(f=>f[k])]));
}
rows=fixedLaneRows(rows,s.program,cfg);
const relayHeat=/\brelay\b/i.test(heat?.title||'')||rows.some(r=>r.relay),columns=['team','seed','split','final','place'].filter(k=>tableFields[k]&&!(relayHeat&&k==='team')),showName=tableFields.first||tableFields.last||(relayHeat&&tableFields.team);
if(cfg.achievements?.standards?.[format]&&rows.some(r=>r.phase==='finish'||(!cfg.boardPhases?.[format]&&r.finish))){rows=rows.map(r=>cfg.boardPhases?.[format]?r:{...r,standardMet:r.finish?matchedStandard(r,r.finish.finalTime):null});columns.push('standard')}
if(cfg.personalBestBoards?.[format]&&rows.some(r=>r.phase==='finish'||(!cfg.boardPhases?.[format]&&r.finish)))columns.push('pb');
if(format==='compact'&&(columns.includes('standard')||columns.includes('pb'))){for(let i=columns.length-1;i>=0;i--)if(['standard','pb'].includes(columns[i]))columns.splice(i,1);columns.push('achievements')}
const layout=tableLayout(rows,tableFields,showName,columns,format,cfg),colgroup=layout.widths.map(w=>`<col style="width:${w}px">`).join('');
if(format==='compact'){
const c=cfg.compact,standardText=c.showStandards!==false?compactStandardText(heat):'',labelsShort={team:'TEAM',seed:'SEED',split:'SPLIT',final:'FINAL',place:'PLC',pb:'PB / UNOFFICIAL',standard:cfg.achievements?.standardLabel||'STANDARD',achievements:compactAchievementHeading(cfg)};
$('broadcast').innerHTML=`<div class="compact-output">${c.showHeader?`<section class="compact-header" style="left:${c.headerX}px;top:${c.headerY}px;width:${c.headerWidth}px"><h1 title="${esc(s.program?.name||'')}">${esc(s.program?.name||'No active meet program')}</h1><div class="compact-race"><h2 title="${esc(heat?.title||'')}">${esc(heat?.title||'Waiting for current heat')}</h2><div class="compact-meta"><strong class="compact-event">Event ${esc(f.event||'—')} <span>/</span> Heat ${esc(f.heat||'—')}</strong>${standardText?`<span class="compact-standards" title="${esc(standardText)}">${esc(standardText)}</span>`:''}<b class="compact-clock">${esc(displayClock(data))}</b></div></div></section>`:''}${c.showResults?`<section class="compact-results" style="left:${Math.min(c.resultsX,1920-layout.width)}px;bottom:${c.resultsBottom}px;width:${layout.width}px;--compact-row:${c.rowHeight}px;--table-time-font:${layout.font}px">${rows.length?`<table><colgroup>${colgroup}</colgroup><thead><tr>${tableFields.lane?'<th>LN</th>':''}${showName?`<th>${relayHeat?'RELAY TEAM':'SWIMMER'}</th>`:''}${columns.map(k=>`<th${k==='achievements'?' class="achievement-heading"':''}>${esc(labelsShort[k])}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr data-lane-slot="${esc(r.slot||r.lane)}" data-phase="${esc(r.phase||'')}" class="${r.empty?'unused-lane':''}">${tableFields.lane?`<td class="compact-lane">${esc(r.lane)}</td>`:''}${showName?`<td class="compact-name" title="${esc(r.name)}">${esc(r.name)}</td>`:''}${columns.map(k=>k==='achievements'?`<td class="achievement-cell">${compactAchievementCell(r,cfg)}</td>`:k==='pb'?`<td class="pb-cell">${boardPBCell(r,format)}</td>`:k==='standard'?`<td class="standard-cell">${boardStandardCell(r)}</td>`:`<td class="${['seed','split','final'].includes(k)?'time-cell':''}" title="${esc(r[k])}">${esc(r[k])}</td>`).join('')}</tr>`).join('')}</tbody></table>`:'<p class="compact-empty">Waiting for a matching heat roster</p>'}</section>`:''}</div>`;rememberTable(s,f,key);return}
$('broadcast').innerHTML=`<div class="board" style="width:${layout.width}px;left:${Math.min(80,1920-layout.width)}px;--table-time-font:${layout.font}px"><div class="board-head"><div class="meet-heading"><h1 class="meet-title">${esc(s.program?.name||'No meet program')}</h1><p class="race-meta"><strong>Event ${esc(f.event||'—')} <span style="color:var(--cyan)">/</span> Heat ${esc(f.heat||'—')}</strong><span>${esc(heat?.title||'Waiting for current heat')}</span></p></div><div><small>RACE CLOCK</small><div class="race-clock">${esc(displayClock(data))}</div></div></div>${rows.length?`<table><colgroup>${colgroup}</colgroup><thead><tr>${tableFields.lane?'<th>LANE</th>':''}${showName?`<th>${relayHeat?'RELAY TEAM':'SWIMMER'}</th>`:''}${columns.map(k=>`<th>${k==='pb'?'PB / UNOFFICIAL':k==='standard'?esc(cfg.achievements?.standardLabel||'STANDARD'):labels[k].toUpperCase()}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr data-lane-slot="${esc(r.slot||r.lane)}" data-phase="${esc(r.phase||'')}" class="${r.empty?'unused-lane':''}">${tableFields.lane?`<td>${esc(r.lane)}</td>`:''}${showName?`<td title="${esc(r.name)}">${esc(r.name)}</td>`:''}${columns.map(k=>k==='pb'?`<td class="pb-cell">${boardPBCell(r,format)}</td>`:k==='standard'?`<td class="standard-cell">${boardStandardCell(r)}</td>`:`<td class="${['seed','split','final'].includes(k)?'time-cell':''}" title="${esc(r[k])}">${esc(r[k])}</td>`).join('')}</tr>`).join('')}</tbody></table>`:'<div class="empty">No swimmers available for the current event and heat.</div>'}<footer>SWIM SCOREBOARD ${f.replay?' · REPLAY':''} ${f.simulated?' · SIMULATED TIMING':''}</footer></div>`;rememberTable(s,f,key);
}
function schedule(){updateMockPreview();cfgEpoch++;dirty=true;clearTimeout(timer);$('saved').textContent='Unsaved changes…';timer=setTimeout(save,300)}
async function save(){if(saving)return; saving=true;dirty=false;const body=JSON.stringify(cfg);try{const d=await requestJSON('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body});cfgRevision=d.configRevision;cfgEpoch++;$('saved').textContent='Saved · OBS outputs updated';}catch(e){$('saved').textContent='Not saved: '+e.message;}finally{saving=false;if(dirty)timer=setTimeout(save,300)}}
let drag=null,viewBox=[0,0,1920,1080],background='',repeat=null;
function editingPool(){return $('alignTarget').value==='pool'}
function targetPoints(){return editingPool()?cfg.alignment.points:lanePoints(cfg,$('lane').value)}
function applyPoints(points){const before=JSON.parse(JSON.stringify(cfg));if(editingPool()){cfg.alignment.points=points;cfg.alignment.usePool=true;$('usePool').checked=true}else{const lane=cfg.lanes[$('lane').value];if(cfg.alignment.usePool){const old=lanePoints(cfg,$('lane').value);lane.offsets=lane.offsets.map((p,i)=>p.map((n,j)=>n+points[i][j]-old[i][j]))}else lane.points=points}
if(!validQuad(cfg.alignment.points)||Object.keys(cfg.lanes).some(k=>(!cfg.alignment.usePool||+k<=cfg.alignment.count)&&!validQuad(lanePoints(cfg,k)))){cfg=before;$('usePool').checked=cfg.alignment.usePool;$('alignmentStatus').textContent='Move rejected: keep corners in perimeter order and cards inside coordinate limits.';return false}
$('alignmentStatus').textContent='Alignment updated. Changes appear in OBS after saving.';align();schedule();return true}
function align(){const lane=cfg.lanes[$('lane').value];$('laneEnabled').checked=lane.enabled;const points=targetPoints();$('corners').innerHTML=points.map((p,i)=>`<div class="corner"><span>${(editingPool()?['START / SIDE A','FINISH / SIDE A','FINISH / SIDE B','START / SIDE B']:['TOP LEFT','TOP RIGHT','BOTTOM RIGHT','BOTTOM LEFT'])[i]}</span>${p.map((n,j)=>`<label>${j?'Y':'X'}<input type="number" min="-10000" max="10000" step="1" value="${Math.round(n)}" data-point="${i}" data-axis="${j}"></label>`).join('')}</div>`).join('');$('corners').querySelectorAll('input').forEach(el=>el.onchange=()=>{const points=targetPoints().map(p=>[...p]);points[+el.dataset.point][+el.dataset.axis]=Number(el.value);applyPoints(points)});renderEditor()}
function renderEditor(){const svg=$('alignmentCanvas');svg.setAttribute('viewBox',viewBox.join(' '));const poly=p=>p.map(v=>v.join(',')).join(' '),pool=cfg.alignment.points;svg.innerHTML=`${background?`<image href="${background}" x="0" y="0" width="1920" height="1080"/>`:''}<rect x="0" y="0" width="1920" height="1080" fill="none" stroke="#62869b" stroke-dasharray="12 8"/><polygon points="${poly(pool)}" class="pool-guide"/>`+enabledLanes(cfg).map(k=>{const p=lanePoints(cfg,k),center=project(p,.5,.5);return `<polygon data-lane="${k}" points="${poly(p)}" class="lane-guide ${k===$('lane').value?'selected':''}"/><text x="${center[0]}" y="${center[1]}" class="lane-label">Lane ${k}</text>`}).join('')+targetPoints().map((p,i)=>`<circle data-corner="${i}" cx="${p[0]}" cy="${p[1]}" r="22" class="drag-handle"/><text x="${p[0]+22}" y="${p[1]-18}" class="handle-label">${i+1}</text>`).join('')}
function nudge(dx,dy,mult=1){const amount=Number($('nudgeStep').value)*mult,which=$('cornerTarget').value;applyPoints(targetPoints().map((p,i)=>which==='all'||+which===i?[p[0]+dx*amount,p[1]+dy*amount]:[...p]))}
function setupAlignment(){const a=cfg.alignment;for(const [id,key] of [['alignmentMode','active'],['usePool','usePool'],['reverseLanes','reverse']]){$(id).checked=a[key];$(id).onchange=e=>{const a=cfg.alignment;a[key]=e.target.checked;if(key==='active'&&a.active){cfg.mode='lanes';$('mode').value='lanes';$('preview').src='/overlay?format=lanes'}align();schedule()}}
for(const [id,key] of [['cardPosition','position'],['cardLength','length'],['cardHeight','height']]){$(id).value=key==='count'?a[key]:Math.round(a[key]*100);$(id).onchange=e=>{const a=cfg.alignment;const old=a[key];a[key]=Number(e.target.value)/(key==='count'?1:100);if(a.position+a.length>1||a.length<.02||a.height<.1){a[key]=old;$(id).value=key==='count'?old:old*100;$('alignmentStatus').textContent='Card start plus length must fit inside 100%.';return}if(key==='count')$('boardLaneCount').value=a.count;align();schedule()}}
$('alignTarget').onchange=align;$('fitView').onclick=()=>{const points=[...cfg.alignment.points,...enabledLanes(cfg).flatMap(k=>lanePoints(cfg,k)),[0,0],[1920,1080]],xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),minX=Math.min(...xs)-100,minY=Math.min(...ys)-100;viewBox=[minX,minY,Math.max(...xs)-minX+100,Math.max(...ys)-minY+100];renderEditor()};$('canvasView').onclick=()=>{viewBox=[0,0,1920,1080];renderEditor()};
$('referenceImage').onchange=e=>{const file=e.target.files[0];if(!file)return;if(!file.type.startsWith('image/'))return;if(background)URL.revokeObjectURL(background);background=URL.createObjectURL(file);renderEditor()};$('clearImage').onclick=()=>{if(background)URL.revokeObjectURL(background);background='';$('referenceImage').value='';renderEditor()};
const svg=$('alignmentCanvas'),point=e=>{const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(svg.getScreenCTM().inverse());return [p.x,p.y]};svg.onpointerdown=e=>{if(e.target.dataset.corner!==undefined){e.preventDefault();const i=+e.target.dataset.corner;$('cornerTarget').value=String(i);drag={i};svg.setPointerCapture(e.pointerId)}else if(e.target.dataset.lane){$('lane').value=e.target.dataset.lane;$('alignTarget').value='lane';align()}};svg.onpointermove=e=>{if(!drag)return;const p=targetPoints().map(p=>[...p]);p[drag.i]=point(e).map(Math.round);applyPoints(p)};svg.onpointerup=svg.onpointercancel=()=>{drag=null};svg.onkeydown=e=>{const delta={ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0]}[e.key];if(delta){e.preventDefault();nudge(...delta,e.shiftKey?10:1)}};
document.querySelectorAll('[data-nudge]').forEach(button=>{button.onclick=()=>nudge(...button.dataset.nudge.split(',').map(Number));button.onpointerdown=e=>{button.setPointerCapture(e.pointerId);clearInterval(repeat);repeat=setInterval(()=>nudge(...button.dataset.nudge.split(',').map(Number)),100)};button.onpointerup=button.onpointercancel=button.onlostpointercapture=()=>{clearInterval(repeat);repeat=null}});window.onblur=()=>{clearInterval(repeat);repeat=null};}
function editingFormat(){return $('fieldFormat').value}
function editingOptions(){const format=editingFormat();return format==='lanes'?cfg.lanePhases:cfg.boardPhases[format]}
function showPhaseSummary(){const format=editingFormat(),o=editingOptions();$('phaseSummary').innerHTML=['start','split','finish'].map(phase=>{const fields=phaseFields(cfg,phase,format),names=Object.keys(labels).filter(k=>fields[k]).map(k=>labels[k]),enabled=phase==='finish'&&format==='lanes'?cfg.finishPopups:o[phase+'Enabled'];const behavior=format==='lanes'?`Delay ${o[phase+'Delay']}s · ${o[phase+'Duration']?`Show ${o[phase+'Duration']}s`:'No duration limit'}`:phase==='start'?'Heat appears → race starts':phase==='split'?'Race starts → this swimmer finishes':`Finish → next heat + ${o.finishHold}s hold`;
return `<article><strong>${phase==='start'?'Start / pre-race':phase==='split'?'Racing / split':'Finish / final result'}${format==='lanes'?` <span>${enabled?'On':'Off'}</span>`:''}</strong><p>${esc(names.join(', ')||'No display fields selected')}</p><small>${esc(behavior)}</small></article>`}).join('');updateMockPreview()}
function updateMockPreview(){if(!cfg||typeof window==='undefined')return;const format=editingFormat();if(format==='lanes')return;const frame=$('mockPreview'),src='/overlay?format='+format+'&mock='+$('mockPhase').value;if(frame.dataset.src!==src){frame.dataset.src=src;frame.onload=()=>frame.contentWindow.postMessage({type:'mock-config',config:cfg},location.origin);frame.src=src}else frame.contentWindow.postMessage({type:'mock-config',config:cfg},location.origin)}
function editFields(){const format=editingFormat(),phase=$('lanePhase').value,fields=phaseFields(cfg,phase,format);
$('splitMode').value=cfg.splitModes[format];$('splitMode').onchange=e=>{cfg.splitModes[editingFormat()]=e.target.value;showPhaseSummary();schedule()};
const names={board:'Traditional scoreboard',compact:'Condensed broadcast',lanes:'Pool lane overlays'};
$('formatTitle').textContent=names[format];
$('finishPBControls').hidden=format==='lanes'||phase!=='finish';
$('formatDescription').textContent=format==='lanes'?'Perspective cards over the pool. Each lane has independent start, split and finish windows.':'Always-visible scoreboard. Columns follow pre-race, racing and finished content; racing and finished swimmers can share the same table.';
$('phaseDescription').textContent=`Editing ${names[format]} · ${phase==='start'?'Start / pre-race':phase==='split'?'Split received':'Finish / final result'}. These fields affect only this format and state.`;
document.querySelectorAll('[data-format]').forEach(el=>el.hidden=!el.dataset.format.split(' ').includes(format));
$('fields').innerHTML='';for(const [k,label] of Object.entries(labels)){$('fields').insertAdjacentHTML('beforeend',`<label class="check"><input id="field-${k}" type="checkbox">${label}</label>`);$(`field-${k}`).checked=fields[k];$(`field-${k}`).onchange=e=>{phaseFields(cfg,$('lanePhase').value,editingFormat())[k]=e.target.checked;showPhaseSummary();schedule()}}
setupPhaseControls();showPhaseSummary();}
function setupCompact(){for(const key of Object.keys(cfg.compact)){const element=$('compact-'+key);element[typeof cfg.compact[key]==='boolean'?'checked':'value']=cfg.compact[key];element.onchange=()=>{const before={...cfg.compact};cfg.compact[key]=typeof cfg.compact[key]==='boolean'?element.checked:Number(element.value);const c=cfg.compact;const invalid=['header','results'].some(p=>c[p+'Width']<320||c[p+'Width']>1920||c[p+'X']<0||c[p+'X']+c[p+'Width']>1920)||c.headerY<0||c.headerY>900||c.resultsBottom<0||c.resultsBottom>500||c.rowHeight<24||c.rowHeight>48||Object.values(c).some(v=>typeof v==='number'&&!Number.isInteger(v));if(invalid){cfg.compact=before;element[typeof before[key]==='boolean'?'checked':'value']=before[key];$('saved').textContent='Keep condensed panels within the 1920 × 1080 canvas.';return}schedule()}}}
function setupPhaseControls(){const options=editingOptions();for(const key of Object.keys(options)){if(key.endsWith('Fields'))continue;const element=$('phase-'+key);if(!element)continue;element[typeof options[key]==='boolean'?'checked':'value']=options[key];element.onchange=()=>{const options=editingOptions(),old=options[key],value=typeof old==='boolean'?element.checked:Number(element.value);if(typeof value==='number'&&(!Number.isFinite(value)||value<0||value>600||(key==='splitDuration'&&value===0)||(key==='finishHold'&&value<5)||(key==='timeSize'&&(!Number.isInteger(value)||value<18||value>64)))){element.value=old;$('saved').textContent='Use a finish hold of 5–600 seconds; lane timings are 0–600 (split duration greater than zero), time size 18–64 pixels.';return}options[key]=value;showPhaseSummary();schedule()}}}
function setupAchievements(){
 const a=cfg.achievements;
 for(const format of ['lanes','board','compact']){const input=$('standard-'+format);input.checked=a.standards[format];input.onchange=()=>{a.standards[format]=input.checked;schedule()}}
 $('standardLabel').value=a.standardLabel;$('standardLabel').onchange=e=>{const value=e.target.value.trim();if(!/^[A-Za-z][A-Za-z0-9 _-]{0,31}$/.test(value)){e.target.value=a.standardLabel;$('saved').textContent='Enter a posted standard label, such as NYS (up to 32 characters).';return}a.standardLabel=value;schedule()};
 for(const kind of ['personalBest','standard']){
  const input=$('image-'+kind),preview=$('image-preview-'+kind);preview.src=badgeImage(kind);
  input.onchange=async()=>{const file=input.files[0];if(!file)return;input.disabled=true;
   try{if(file.size>3*1024*1024)throw Error('Choose a PNG image up to 3 MiB');const d=await requestJSON('/api/images',{method:'POST',headers:{'Content-Type':'image/png'},body:file});cfg.achievements.images[kind]=d.url;preview.src=d.url;$('image-status').textContent=`Uploaded ${d.width} × ${d.height} PNG. Image keeps its aspect ratio.`;schedule()}
   catch(e){$('image-status').textContent='Image not changed: '+e.message}finally{input.disabled=false;input.value=''}
  };
  $('image-reset-'+kind).onclick=()=>{a.images[kind]=kind==='personalBest'?'/personal-best.png':'/nys-2027.png';preview.src=a.images[kind];schedule()};
 }
}
function init(){setupAchievements();$('mockPhase').onchange=()=>updateMockPreview();for(const format of ['board','compact']){const input=$('pb-'+format);input.checked=!!cfg.personalBestBoards?.[format];input.onchange=()=>{cfg.personalBestBoards[format]=input.checked;schedule()}}setupCompact();$('lanePhase').onchange=()=>{$('mockPhase').value=$('lanePhase').value;editFields()};$('boardLaneCount').value=cfg.alignment.count;$('boardLaneCount').onchange=e=>{cfg.alignment.count=Number(e.target.value);align();schedule()};$('boardWidth').value=cfg.boardWidth;$('boardWidth').onchange=e=>{const width=Number(e.target.value);if(!Number.isInteger(width)||width<640||width>1760){e.target.value=cfg.boardWidth;$('saved').textContent='Choose a width from 640 to 1760 pixels.';return}cfg.boardWidth=width;schedule()};$('fieldFormat').value=cfg.mode;$('fieldFormat').onchange=editFields;editFields();
for(const id of ['mode','visible','autoHide','finishPopups']){$(id)[id==='mode'?'value':'checked']=cfg[id];$(id).onchange=e=>{cfg[id]=id==='mode'?e.target.value:e.target.checked;if(id==='mode'){$('preview').src='/overlay?format='+cfg.mode;$('fieldFormat').value=cfg.mode;editFields()}else showPhaseSummary();schedule()}}
$('preview').src='/overlay?format='+cfg.mode;
for(const format of ['board','lanes','compact'])$(format+'Url').value=location.origin+'/overlay?format='+format;
document.querySelectorAll('[data-copy]').forEach(b=>b.onclick=async()=>{try{await navigator.clipboard.writeText($(b.dataset.copy).value);$('saved').textContent='Browser source URL copied'}catch{$(b.dataset.copy).select();$('saved').textContent='Select and copy the URL above'}});
$('lane').innerHTML=Object.keys(cfg.lanes).map(i=>`<option>${i}</option>`).join('');$('lane').onchange=align;$('laneEnabled').onchange=e=>{cfg.lanes[$('lane').value].enabled=e.target.checked;align();schedule()};$('resetLane').onclick=()=>{const i=+$('lane').value,y=120+(i-1)*105;if(cfg.alignment.usePool)cfg.lanes[i].offsets=[[0,0],[0,0],[0,0],[0,0]];else cfg.lanes[i].points=[[180,y],[900,y],[900,y+90],[180,y+90]];align();schedule()};setupAlignment();align();}
function seedStatus(s){
const summary=s.sessions?.find(v=>v.id===s.active)?.seedSummary;
if(!s.program)return 'Seeds: no active meet program.';
if(summary?.needsReimport)return 'Seeds missing from an older import. In SwimDataManager, use Update report to re-import this session.';
const entries=(s.program.heats||[]).flatMap(h=>h.swimmers||[]);
if(!entries.length)return 'Seeds: no swimmer entries in the active program.';
if(entries.some(v=>!Object.prototype.hasOwnProperty.call(v,'seedTime')))return 'Some entries have no imported seed field. Update SwimDataManager and re-import the meet program using Update report.';
const seeded=summary?.seeded??entries.filter(v=>v.seedTime&&v.seedTime!=='NT').length,nt=summary?.noTime??entries.filter(v=>v.seedTime==='NT').length,missing=summary?.missing??entries.filter(v=>!v.seedTime).length;
return `Program seeds: ${seeded} timed · ${nt} NT · ${missing} missing. Enable Seed time above to display them.`;
}
function showSync(data){const revision=data.configRevision||'unknown',stamp=new Date().toLocaleTimeString(),message=`Updated ${stamp} · settings ${revision} · ${location.host}`;
if(output){const debug=$('syncDebug');if(debug){debug.hidden=new URLSearchParams(location.search).get('debug')!=='1';debug.textContent=message}}else if($('syncStatus'))$('syncStatus').textContent=message+(data.error?' · '+data.error:'');}
let mockConfig=null;
function mockData(config,phase){const copy=JSON.parse(JSON.stringify(config)),now=Date.now()/1000;copy.visible=true;copy.alignment.active=false;const swimmers=[{lane:1,name:'Rivera, Alex',team:'AYST',seedTime:'1:04.50'},{lane:2,name:'Chen, Taylor',team:'WAVES',seedTime:'1:05.00'},{lane:3,name:'Smith, Jamie',team:'AYST',seedTime:'1:03.80'}],lanes={};
for(const swimmer of swimmers){if(phase==='finish'||(phase==='mixed'&&swimmer.lane===1))lanes[swimmer.lane]={splits:['0:30.12'],finalTime:'1:02.45',place:swimmer.lane};else if(phase!=='start')lanes[swimmer.lane]={splits:['0:31.18']}}
return {config:copy,received:now,now,error:null,state:{active:'mock-'+phase,program:{name:'SAMPLE MEET · NOT ON AIR',heats:[{event:3,heat:2,title:'100 Freestyle · Sample data',timeStandards:[{name:copy.achievements?.standardLabel||'NYS',time:'1:03.00',minAge:null,maxAge:null,gender:null}],swimmers}]},feed:{event:3,heat:2,connected:true,clockLast:now,raceClock:phase==='start'?'0:00.0':'0:40.0',results:{event:3,heat:2,lanes}}}}}
function renderMock(){const phase=new URLSearchParams(location.search).get('mock');if(!phase||!mockConfig)return;renderOutput(mockData(mockConfig,phase));document.body.classList.add('mock-output');const target=document.querySelector('.board,.compact-results');if(target){const width=target.offsetWidth,scale=Math.min(1,innerWidth/width);$('canvas').style.transform=`scale(${scale})`}}
if(typeof window!=='undefined')addEventListener('message',event=>{if(output&&new URLSearchParams(location.search).has('mock')&&event.origin===location.origin&&event.source===parent&&event.data?.type==='mock-config'){mockConfig=event.data.config;renderMock()}});
async function poll(){const epoch=cfgEpoch;let stage='connection';try{latest=await requestJSON('/api/state');pollFailed=false;if(latest.appVersion&&latest.appVersion!==CLIENT_VERSION){location.reload();return}stage='render';if(output){if(new URLSearchParams(location.search).has('mock')){mockConfig=mockConfig||latest.config;renderMock()}else renderOutput(latest)}else{if(!cfg||(!dirty&&!saving&&!drag&&epoch===cfgEpoch&&latest.configRevision!==cfgRevision)){cfg=latest.config;cfgRevision=latest.configRevision;init()}const {s,f,heat,clock,fresh}=liveData(latest);$('connection').textContent=latest.error?'● Manager offline':fresh?'● Receiving timing':'● Waiting for timing';$('event').textContent=`Event ${f.event||'—'} / Heat ${f.heat||'—'}${heat?' · '+heat.title:''}`;$('meet').textContent=s.program?.name||'No active meet program';$('clock').textContent=displayClock(latest);$('standardStatus').textContent=latest.error?'Standards: manager unavailable.':heat?.timeStandards?.length?`Posted standards: ${heat.timeStandards.map(s=>[s.name,s.minAge!=null?s.maxAge!=null?`${s.minAge}–${s.maxAge}`:`${s.minAge}+`:'',s.gender||'',s.time].filter(Boolean).join(' ')).join(' · ')}`:'No posted standards for the current heat. Update older imported reports in the manager.';$('seedStatus').textContent=latest.error?'Seeds: manager unavailable.':seedStatus(s);$('source').textContent=f.replay?(f.replayEstimated?'REPLAY · ESTIMATED TIMING':'REPLAY'):f.simulated?'SIMULATION':fresh?'LIVE CTS':'Timing unavailable'}showSync(latest)}catch(e){pollFailed=true;const reason=e.name==='AbortError'?'Request timed out; retrying':e.message;if(output){$('broadcast').replaceChildren();$('notice').textContent=(stage==='render'?'OUTPUT ERROR · ':'SCOREBOARD CONNECTION · ')+reason}else $('connection').textContent=reason}setTimeout(poll,400)}
function animateOutput(){if(!latest||pollFailed||tableHistory.pending||new URLSearchParams(location.search).has('mock'))return;try{if(output){const format=new URLSearchParams(location.search).get('format')||latest.config.mode;if(format==='lanes')renderOutput(latest);else{const clock=document.querySelector('.race-clock,.compact-clock');if(clock)clock.textContent=displayClock(latest)}}else if($('clock'))$('clock').textContent=displayClock(latest)}catch(e){if(output)$('notice').textContent='OUTPUT ERROR · '+e.message}}
if(typeof window!=='undefined')setInterval(animateOutput,50);
if(output){const resize=()=>{if(new URLSearchParams(location.search).has('mock'))renderMock();else $('canvas').style.transform=`scale(${Math.min(innerWidth/1920,innerHeight/1080)})`};addEventListener('resize',resize);resize()}poll();
