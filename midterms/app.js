'use strict';
(() => {
const $=id=>document.getElementById(id), number=new Intl.NumberFormat('en-US'), money=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});
const palette={dem:'#2054b3',rep:'#c84037',other:'#80733b',untagged:'#99a3b2'}, labels={dem:'Democratic aligned',rep:'Republican aligned',other:'Other campaigners',untagged:'Unclassified'};
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const compact=value=>{if(value>=1e6)return '$'+(value/1e6).toLocaleString('en-US',{maximumFractionDigits:2})+'m';if(value>=1000)return '$'+(value/1000).toLocaleString('en-US',{maximumFractionDigits:1})+'k';return money.format(value);};
const accountMoney=p=>{if(!p)return 'No data';if(!p.currency||p.currency==='USD')return compact(p.spend||0);return number.format(p.spend||0)+' '+p.currency;};
const reduceMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const params=new URLSearchParams(location.search);
const state={place:params.get('state')||'US',period:params.get('period')==='7'?'7':'30',view:params.get('view')==='spend'?'spend':'balance',geography:['zip','district','upper','lower','state'].includes(params.get('geo'))?params.get('geo'):'district',tab:['ads','races','insights','targeting'].includes(params.get('tab'))?params.get('tab'):(params.has('advertiser')||params.has('campaign')?'ads':'targeting'),basis:params.get('basis')==='zip'?'zip':'local',party:['dem','rep','other'].includes(params.get('party'))?params.get('party'):'all',untagged:params.get('untagged')==='1',nationwide:params.get('nationwide')==='1',pageID:params.get('advertiser')||null,campaignRace:null,campaignTitle:null,campaignPages:null,area:null};
state.includeNonPolitical=params.get('include-non-political')==='1';
const areaParam=params.get('area');if(areaParam&&/^(zip:\d{5}|district:\d{4}|(?:upper|lower):[0-9A-Z]{5})$/.test(areaParam)){const [type,id]=areaParam.split(':');state.area={type,id};}
Object.assign(state,{platform:['meta','google','snapchat','reddit','x'].includes(params.get('platform'))?params.get('platform'):(params.has('advertiser')||params.has('campaign')?'meta':'overall'),platformMetric:['footprint','spend','estimate'].includes(params.get('platform-metric'))?params.get('platform-metric'):'estimate',platformWindow:params.get('platform-window')==='recent'?'recent':'year',platformAccount:params.get('platform-account')||null,platformRace:params.get('platform-race')||null,platformAccounts:null});
Object.assign(state,{units:params.get('units')==='capita'?'capita':'total',date:params.get('date')||null,overallSources:params.has('sources')?params.get('sources').split(',').filter(v=>['meta','google','snapchat'].includes(v)):['meta','google','snapchat']});
Object.assign(state,{targetFamily:['interests','demographics','behaviours','age','gender','custom','lookalike','location','language','all'].includes(params.get('target-family'))?params.get('target-family'):'interests',targetScale:params.get('target-scale')==='share'?'share':'spend',targetSort:['spend','difference','accounts'].includes(params.get('target-sort'))?params.get('target-sort'):'spend',targetMode:params.get('target-mode')==='exclusions'?'exclusions':'included',targetQuery:(params.get('target-query')||'').slice(0,180),targetCriterion:/^[a-f0-9]{16}$/.test(params.get('criterion')||'')?params.get('criterion'):null,targetMap:params.get('target-map')==='1',targetMapPages:null,targetMapLabel:null});
Object.assign(state,{audienceFocus:params.get('graph-focus')==='1',audienceView:['map','network','landscape','flows'].includes(params.get('audience-view'))?params.get('audience-view'):(state.targetMap?'map':'network'),audienceExtras:params.get('audience-extra')==='1',audiencePreset:['overview','distinctive','shared'].includes(params.get('audience-preset'))?params.get('audience-preset'):'overview',audienceAccount:/^\d{4,25}$/.test(params.get('audience-account')||'')?params.get('audience-account'):null});
if(!state.targetCriterion||state.platform!=='meta')state.targetMap=false;
if(state.platform==='overall'&&!params.has('nationwide'))state.nationwide=true;
if(state.platform!=='meta'){state.pageID=null;if(!params.has('untagged'))state.untagged=true;if(!params.has('view'))state.view='spend';if(state.platform==='google'&&state.platformMetric==='spend')state.geography='state';if(state.platform==='reddit'&&!params.has('nationwide'))state.nationwide=true;}
let manifest,geometryIndex,tileLoader,catalog=[],pageIndex=new Map(),data=null,map=null,worker=null,current=null,detailRows=[],rankLimit=8,searchItems=[],searchIndex=-1,zipIndex=null,mapReady=false,revision=0,workerRequest=0,hover=null,cityMarkers=[],districtMarkers=[],toastTimer,renderFrame,tileState=null,busy=true,rendererError=null;
const pending=new Map(),jsonCache=new Map(),legData={};let pendingFit=false;
let attributionControl,attributionPlatform;
function syncAttribution(){
  if(!map||attributionPlatform===state.platform)return;
  if(attributionControl)map.removeControl(attributionControl);
  const sources={overall:'Spending: Meta, Google, Snapchat · model estimates',meta:'Meta targeting: metatargetr',google:'Ad data: Google political ads',snapchat:'Ad data: Snapchat political ads',reddit:'Ad data: Reddit staff disclosure',x:'X spending: unavailable'};
  attributionControl=new maplibregl.AttributionControl({compact:true,customAttribution:sources[state.platform]+' · Boundaries: US Census'});
  map.addControl(attributionControl);attributionPlatform=state.platform;
}
const geometryPositions={},paintedSources=new Map();let visiblePaintFrame;
const allocationKey=()=>[state.date,state.units,state.overallSources.join(','),state.platform,state.platformMetric,state.platformWindow,state.platformAccount,state.platformAccounts?.join(',')??'all',state.period,state.party,state.untagged,state.includeNonPolitical,state.pageID,state.campaignPages?.join(',')??'all',state.targetMap?state.targetMapPages?.join(','):'all',state.basis,state.nationwide].join('|');
const sourceForView=()=>({zip:'zips',district:'districts',state:'states',upper:'upper',lower:'lower'}[state.geography]);
function emitSelection(){window.AtlasSelection?.sync();document.dispatchEvent(new CustomEvent('atlas:selection'));}
async function ensureLegislative(kind){
 if(!['upper','lower'].includes(kind))return;
 if(!legData[kind]){legData[kind]=await json('data/state-'+kind+'.json.gz');geometryPositions[kind]=new Map(legData[kind].districts.map((d,i)=>[d.id,i]));worker.postMessage({type:'legislative',kind,data:legData[kind]});}
 addLegislativeLayer(kind);
}
function addLegislativeLayer(kind){
 if(!mapReady||map.getSource(kind))return;
 map.addSource(kind,{type:'vector',url:tileLoader.url('state-'+kind),promoteId:'id'});
 map.addLayer({id:kind+'-fill',type:'fill',source:kind,'source-layer':kind,layout:{visibility:'none'},paint:{'fill-color':'#e6eaf0','fill-opacity':.92}},'states-outline');
 map.addLayer({id:kind+'-lines',type:'line',source:kind,'source-layer':kind,layout:{visibility:'none'},paint:{'line-color':'#fdfdfe','line-width':.7,'line-opacity':.85}},'states-outline');
 map.addLayer({id:kind+'-selected',type:'line',source:kind,'source-layer':kind,filter:['==',['get','id'],''],paint:{'line-color':'#17243d','line-width':2.8}});
}

const metrics={started:performance.now(),model:[],painting:[]};window.atlasPerformance=metrics;
async function json(url){
  if(jsonCache.has(url)){const value=jsonCache.get(url);jsonCache.delete(url);jsonCache.set(url,value);return value;}
  const promise=fetch(url,{cache:/\/(?:manifest|catalog)\.json$/.test(url)?'no-cache':'default'}).then(r=>{if(!r.ok)throw Error(`Could not load ${url} (${r.status})`);return window.AtlasJSON.read(r,url);}).catch(error=>{jsonCache.delete(url);throw error;});
  jsonCache.set(url,promise);if(jsonCache.size>12){const key=Array.from(jsonCache.keys()).find(k=>!['data/manifest.json','data/catalog.json'].includes(k));if(key)jsonCache.delete(key);}return promise;
}
function toast(text){clearTimeout(toastTimer);$('toast').textContent=text;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,4500);}
function options(){const scoped=state.targetMap?(state.campaignPages?state.targetMapPages?.filter(id=>state.campaignPages.includes(id)):state.targetMapPages):state.campaignPages;return {party:state.party,untagged:state.untagged,includeNonPolitical:state.includeNonPolitical,stateID:manifest?.states.find(s=>s.abbr===state.place)?.id||null,page:state.pageID?(pageIndex.get(state.pageID)??-1):null,pages:scoped?.map(id=>pageIndex.get(id)).filter(i=>i!==undefined)??null,basis:state.basis,nationwide:state.nationwide};}
function accepts(index){const a=catalog[index];return a&&(!a.exclude_from_political||state.includeNonPolitical)&&(state.party==='all'||a.party===state.party)&&(a.tagged||state.untagged)&&(!state.pageID||a.id===state.pageID);}
function activePage(){return state.pageID?catalog[pageIndex.get(state.pageID)]:null;}
function workerCall(type,extra={}){return new Promise((resolve,reject)=>{const id=++workerRequest;const timer=setTimeout(()=>{pending.delete(id);reject(Error('The map calculation timed out. Select the place again to retry.'));},15000);pending.set(id,{resolve,reject,timer});worker.postMessage({type,id,options:options(),area:state.area,...extra});});}
function syncURL(){
  const p=new URLSearchParams();p.set('state',state.place);p.set('period',state.period);p.set('view',state.view);p.set('geo',state.geography);p.set('basis',state.basis);
  p.set('tab',state.tab);if(window.AtlasElections?.selectedRace)p.set('race',window.AtlasElections.selectedRace);if(window.AtlasElections?.selectedCandidate)p.set('candidate',window.AtlasElections.selectedCandidate);if(state.party!=='all')p.set('party',state.party);if(state.untagged)p.set('untagged','1');if(state.nationwide)p.set('nationwide','1');if(state.pageID)p.set('advertiser',state.pageID);if(state.area)p.set('area',state.area.type+':'+state.area.id);
  if(state.campaignRace)p.set('campaign',state.campaignRace);if(state.platform!=='meta')p.set('untagged',state.untagged?'1':'0');
  if(state.includeNonPolitical)p.set('include-non-political','1');
  p.set('units',state.units);if(state.date)p.set('date',state.date);p.set('sources',state.overallSources.join(','));
  if(state.tab==='targeting'||state.targetMap){p.set('target-family',state.targetFamily);p.set('target-scale',state.targetScale);p.set('target-sort',state.targetSort);p.set('target-mode',state.targetMode);if(state.targetQuery)p.set('target-query',state.targetQuery);if(state.targetCriterion)p.set('criterion',state.targetCriterion);if(state.targetMap)p.set('target-map','1');}
  if(state.tab==='targeting'){p.set('audience-view',state.audienceView);if(state.audienceFocus)p.set('graph-focus','1');if(state.audienceExtras)p.set('audience-extra','1');if(state.audiencePreset!=='overview')p.set('audience-preset',state.audiencePreset);if(state.audienceAccount)p.set('audience-account',state.audienceAccount);}
  p.set('platform',state.platform);if(state.platform!=='meta'){p.set('platform',state.platform);p.set('platform-metric',state.platformMetric);p.set('platform-window',state.platformWindow);if(state.platformAccount)p.set('platform-account',state.platformAccount);if(state.platformRace)p.set('platform-race',state.platformRace);}
  history.replaceState(null,'',location.pathname+'?'+p.toString());window.AtlasSelection?.sync();
}
function syncControls(){
  if(window.AtlasTargeting)window.AtlasTargeting.syncControls?.();
  window.AtlasAudience?.sync();
  document.querySelectorAll('[data-period]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.period===state.period)));
  document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===state.view)));
  document.querySelectorAll('[data-party]').forEach(b=>{const selected=b.dataset.party===state.party;b.setAttribute('aria-pressed',String(selected));b.classList.toggle('active',selected);});
  $('state-select').value=state.place;$('geography').value=state.geography;$('geography').disabled=false;$('basis').value=state.basis;$('untagged').checked=state.untagged;$('include-non-political').checked=state.includeNonPolitical;$('nationwide').checked=state.nationwide;
  $('island-places').hidden=state.place!=='US';
  $('reset').hidden=state.party==='all'&&!state.pageID&&!state.campaignRace&&!state.untagged&&!state.nationwide&&!state.area;
  $('unclassified-count').textContent=number.format(catalog.filter(a=>a.periods[state.period]&&!a.tagged).length);
  const date=new Date(manifest.snapshot+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
  $('snapshot-note').textContent=`${state.period}-day snapshot · ${date}`;
  const place=manifest.states.find(s=>s.abbr===state.place);$('map-place').textContent=state.area?areaInfo().title:place?.name||'United States';
  $('map-overline').textContent=state.place==='US'?'THE NATIONAL PICTURE':'A CLOSER LOOK AT';
  $('map-subtitle').textContent=state.pageID?activePage()?.name||'Selected advertiser':'Every state stays on the map.';document.body.dataset.tab=state.tab;document.querySelectorAll('[data-tab]').forEach(b=>{b.setAttribute('aria-selected',String(b.dataset.tab===state.tab));b.tabIndex=b.dataset.tab===state.tab?0:-1;});
  const caption=['upper','lower'].includes(state.geography)?'State legislature · ZIP representative-point estimates':state.basis==='zip'?'Explicit ZIP criteria · bounded allocation model':'Population model for broader local targets';
  $('map-caption').textContent=caption+(state.nationwide?' · includes modelled nationwide targets':' · nationwide targets excluded');
  $('clear-area').hidden=!state.area;
  $('advertiser-focus').hidden=!state.pageID;
  if(state.pageID){const a=activePage();$('advertiser-focus').innerHTML=`<div class="focus-top"><span class="focus-label">ADVERTISER FOOTPRINT</span><button id="clear-advertiser" class="focus-close" aria-label="Clear advertiser">×</button></div><div class="focus-name">${escape(a?.name)}</div><div class="focus-sub"><span class="party-dot ${escape(a?.party)}"></span> ${escape(labels[a?.party])}<br>${window.AtlasIdentities.badge(a.id)}<br>${escape(a?.category)} · ${escape(accountMoney(a?.periods[state.period]))} reported account spend</div><div id="advertiser-connections"></div>`;$('clear-advertiser').onclick=()=>window.AtlasSelection.clear('account');window.AtlasConnections?.renderAdvertiser(a.id);}
  const scope=$('campaign-scope');if(scope){scope.hidden=!state.campaignRace;if(state.campaignRace){scope.innerHTML=`<div><span class="section-label">MATCHED CAMPAIGNS</span><strong>${escape(state.campaignTitle)}</strong><small>${state.campaignPages?.length||0} linked Meta accounts · source matches shown in the race profile</small><button id="return-campaign" class="text-button">Open race profile ↗</button></div><button id="clear-campaign" class="icon-button" aria-label="Clear campaign filter">×</button>`;$('return-campaign').onclick=()=>window.AtlasElections?.openRace(state.campaignRace);$('clear-campaign').onclick=()=>window.AtlasSelection.clear('race');}}
  window.AtlasPlatforms?.controls();window.AtlasOverall?.controls();syncAttribution();syncURL();renderCoverage();
}
function beginBusy(){ busy=true;$('map-loading').hidden=false;$('map-error').hidden=!rendererError;if(rendererError)$('map-error').textContent=rendererError;$('export').disabled=true;$('summary').innerHTML='<span class="loading-line">Updating this view…</span>'; }
function syncMapLoading(){
  const ready=!busy&&mapReady&&map?.loaded();
  $('map-loading').hidden=!map||!!rendererError||ready;
  if(ready&&!metrics.mapPaintReady)metrics.mapPaintReady=performance.now()-metrics.started;
}
async function refresh({load=false,fit=false}={}){
  if(state.platform==='google'&&state.platformMetric==='spend'&&state.geography!=='state')state.platformMetric='footprint';
  const version=++revision;pendingFit=pendingFit||fit;rankLimit=8;beginBusy();syncControls();
  try{
    // Every source can open a combined race profile. Keep its Meta model and
    // catalog on the same dated indices, including a direct native-source visit.
    {
      const snapshot=await window.AtlasOverall.snapshot({...state});if(version!==revision)return;state.date=snapshot.date;
      if(!data||data.snapshot!==snapshot.date||String(data.window)!==state.period||catalog!==snapshot.catalog){
        const geography=await json('data/national-geography.json.gz');if(version!==revision)return;
        catalog=snapshot.catalog;pageIndex=new Map(catalog.map((a,i)=>[a.id,i]));worker.postMessage({type:'catalog',catalog:catalog.map(a=>({party:a.party,tagged:a.tagged,exclude_from_political:a.exclude_from_political}))});
        manifest={...manifest,snapshot:snapshot.date,audit:snapshot.audit};data={...snapshot.meta,...geography};
        geometryPositions.zip=new Map(data.zips.map((z,i)=>[z.id,i]));geometryPositions.district=new Map(data.districts.map((d,i)=>[d.id,i]));worker.postMessage({type:'data',data});
      }
    }
    await ensureLegislative(state.geography);if(version!==revision)return;
    if(state.targetMap){await window.AtlasTargeting.prepareMap();if(version!==revision)return;}
    if(state.area){const list=state.area.type==='zip'?data.zips:state.area.type==='district'?data.districts:legData[state.area.type]?.districts;if(!list?.some(d=>d.id===state.area.id))state.area=null;}
    window.AtlasPopulation.prepare(data,legData);syncControls();
    const result=state.platform==='meta'?await workerCall('compute'):window.AtlasOverall.supports(state)?await window.AtlasOverall.compute({...state},data,legData):await window.AtlasPlatforms.compute(state,data,legData);if(version!==revision)return;
    current=result;detailRows=state.platform==='meta'?result.rows:[];metrics.model.push(result.elapsed);if(metrics.model.length>100)metrics.model.shift();
    if(mapReady)await paintMap(version);else renderLegend();if(version!==revision)return;
    window.AtlasOverall.controls();renderResults();if(pendingFit){fitPlace();pendingFit=false;}updateMarkers();busy=false;syncMapLoading();$('export').disabled=!(window.AtlasOverall.supports(state)?current.rows.length:detailRows.length);
    if(!metrics.firstReady){metrics.firstReady=performance.now()-metrics.started;performance.mark('atlas-data-ready');}
    if(state.platform==='meta'&&state.pageID)renderAccountDetail(state.pageID,version);else if(!window.AtlasOverall.supports(state))$('account-detail').hidden=true;
  }catch(error){if(version!==revision)return;busy=false;$('map-loading').hidden=true;$('map-error').textContent='The atlas couldn’t load this view. '+error.message+' Use the place selector to retry.';$('map-error').hidden=false;$('summary').innerHTML='<span class="summary-caption">This view is unavailable. Your selection is preserved.</span>';console.error(error);}
}
function geoValues(kind,id){
  if(!current)return [0,0,0,0];
  if(kind==='state')return current.national.find(s=>s.id===id)?.values||[0,0,0,0];
  if(kind==='zip'){const i=geometryPositions.zip?.get(id)??-1;return i>=0?Array.from(current.values.subarray(i*4,i*4+4)):[0,0,0,0];}
  const list=kind==='district'?{ids:current.districtIDs,values:current.districtValues}:current.legislative[kind];
  const i=geometryPositions[kind]?.get(id)??-1;return i>=0?Array.from(list.values.subarray(i*4,i*4+4)):[0,0,0,0];
}
function featureStats(values,kind,id){const [d,r,o,u]=values,population=window.AtlasPopulation.get(kind,id),raw=d+r+o+u;return {raw,population,v:window.AtlasPopulation.active()?(population>0?raw/population:0):raw,d,r,o,u,balance:d+r>0?(d-r)/(d+r):0,partisan:d+r};}
function thresholds(){
  let vals=[];const kind=state.geography;
  if(kind==='state')vals=current.national.map(s=>featureStats(s.values,'state',s.id).v);
  else{const a=kind==='zip'?current.values:kind==='district'?current.districtValues:current.legislative[kind]?.values||[],ids=kind==='zip'?data.zips.map(z=>z.id):kind==='district'?current.districtIDs:current.legislative[kind]?.ids||[];for(let i=0;i<a.length;i+=4)vals.push(featureStats(Array.from(a.subarray(i,i+4)),kind,ids[i/4]).v);}
  vals=vals.filter(v=>v>0).sort((a,b)=>a-b);if(!vals.length)return [1,10,100,1000];const q=p=>vals[Math.min(vals.length-1,Math.floor(p*(vals.length-1)))];const t=[q(.25),q(.5),q(.75),q(.95)];for(let i=0;i<t.length;i++)t[i]=Math.max(t[i],i?t[i-1]+Math.max(.000001,t[i-1]*1e-8):.000001);return t;
}
const spendPalettes={all:['#e8effa','#c6d6f0','#8dacdd','#4e79c1','#2054b3'],dem:['#e8effa','#c6d6f0','#8dacdd','#4e79c1','#2054b3'],rep:['#f9e9e4','#ecc5ba','#dd9a88','#cf6c59','#b83930'],other:['#f0eedf','#ddd6ad','#bdb177','#97894b','#6e632b']};
const balanceColours=['#c84037','#e8917e','#f3d2c8','#e9ecf0','#bdcfea','#729ce0','#1d56b8'];
function colourExpression(){
  const v=['coalesce',['feature-state','v'],0];
  if(state.view==='balance')return ['case',['<=',v,0],'#e6eaf0',['<=',['coalesce',['feature-state','partisan'],0],.0001],'#d9dfe7',['interpolate',['linear'],['coalesce',['feature-state','balance'],0],-1,balanceColours[0],-.65,balanceColours[1],-.3,balanceColours[2],0,balanceColours[3],.3,balanceColours[4],.65,balanceColours[5],1,balanceColours[6]]];
  const colours=spendPalettes[state.party]||spendPalettes.all,t=thresholds();return ['case',['<=',v,0],'#e6eaf0',['step',v,colours[0],t[0],colours[1],t[1],colours[2],t[2],colours[3],t[3],colours[4]]];
}
async function paintMap(version=revision){
  if(!mapReady||!current)return;const start=performance.now();hideTooltip();
  const source=sourceForView();
  for(const name of ['zips','districts','upper','lower']){
    if(!map.getLayer(name+'-fill'))continue;
    map.setLayoutProperty(name+'-fill','visibility',source===name?'visible':'none');
    map.setLayoutProperty(name+'-lines','visibility',source===name?'visible':'none');
  }
  map.setLayoutProperty('states-fill','visibility','visible');map.setPaintProperty('states-fill','fill-opacity',source==='states'?.9:.28);
  const key=allocationKey();if(paintedSources.get('states')!==key){for(const s of current.national)map.setFeatureState({source:'states',id:s.id},featureStats(s.values,'state',s.id));paintedSources.set('states',key);}
  await paintVisibleAreas(source,version);
  if(version!==revision)return;
  map.setPaintProperty('states-fill','fill-color',colourExpression());if(source!=='states')map.setPaintProperty(source+'-fill','fill-color',colourExpression());
  map.setFilter('selected-state',['==',['get','abbr'],state.place]);
  applySelectionOutline();renderLegend();metrics.painting.push(performance.now()-start);if(metrics.painting.length>100)metrics.painting.shift();
  window.AtlasElections?.updateNavigator(window.AtlasPopulation.active()?current.national.map(r=>({...r,values:r.values.map(v=>v/(window.AtlasPopulation.get('state',r.id)||Infinity))})):current.national,state.view,state.party);
}
async function paintVisibleAreas(source=sourceForView(),version=revision){
  if(!mapReady||!current||source==='states'||!map.getSource(source))return;
  const key=allocationKey();let memo=paintedSources.get(source);if(memo?.key!==key){memo={key,ids:new Set()};paintedSources.set(source,memo);}
  const kind=source==='zips'?'zip':source==='districts'?'district':source;
  const ids=[...new Set(map.querySourceFeatures(source,{sourceLayer:source}).map(f=>String(f.properties.id)))].filter(id=>!memo.ids.has(id));
  let i=0;while(i<ids.length){if(version!==revision||key!==allocationKey())return;const start=performance.now();do{const id=ids[i++];map.setFeatureState({source,sourceLayer:source,id},featureStats(geoValues(kind,id),kind,id));memo.ids.add(id);}while(i<ids.length&&(i%32!==0||performance.now()-start<6));if(i<ids.length)await new Promise(requestAnimationFrame);}
}
function scheduleVisiblePaint(){
  if(visiblePaintFrame||busy||!current||!mapReady)return;visiblePaintFrame=requestAnimationFrame(()=>{visiblePaintFrame=null;if(busy)return;paintVisibleAreas().then(syncMapLoading).catch(error=>console.warn('Visible map colouring:',error.message));});
}
function renderLegend(){
  if(state.view==='balance'){$('legend-title').textContent='DEMOCRATIC / REPUBLICAN BALANCE';$('legend-colours').innerHTML=balanceColours.map(c=>`<span style="background:${c}"></span>`).join('');$('legend-labels').innerHTML='<span>Republican aligned</span><span>Democratic aligned</span>';$('legend-note').textContent='Share of modelled advertising allocation. Grey: no aligned estimate.';}
  else{const c=spendPalettes[state.party]||spendPalettes.all,t=thresholds();$('legend-title').textContent='ESTIMATED SPEND · USD';$('legend-colours').innerHTML=c.map(c=>`<span style="background:${c}"></span>`).join('');$('legend-labels').innerHTML=`<span>Lower</span><span>${window.AtlasPopulation.active()?window.AtlasPopulation.formatRate(t[1]):compact(t[1])}</span><span>${window.AtlasPopulation.active()?window.AtlasPopulation.formatRate(t[3]):compact(t[3])}+</span>`;$('legend-note').textContent='Colour bands follow this view’s distribution. Pale grey: no mapped estimate.';}
  if(window.AtlasOverall.supports(state))window.AtlasOverall.legend();else if(state.platform!=='meta')window.AtlasPlatforms?.legend();else if(window.AtlasPopulation.active())$('legend-title').textContent='ESTIMATED SPEND · USD PER RESIDENT';
}
function areaInfo(){
  const s=manifest.states.find(s=>s.abbr===state.place);
  if(state.area?.type==='zip'){const z=data?.zips.find(z=>z.id===state.area.id);return {title:'ZIP '+state.area.id,kicker:'ZIP-AREA ALLOCATION',extra:z?`${number.format(z.population)} residents in the 2020 ACS · ${z.districts.map(([id])=>manifest.districts.find(d=>d.id===id)?.label).filter(Boolean).join(' / ')}`:''};}
  if(['upper','lower'].includes(state.area?.type)){const d=legData[state.area.type]?.districts.find(d=>d.id===state.area.id);return {title:d?.name||state.area.id,kicker:state.area.type==='upper'?'STATE SENATE DISTRICT':'STATE HOUSE DISTRICT',extra:'2026 Census boundaries · ZIP representative-point estimate'};}
  if(state.area?.type==='district'){const d=data?.districts.find(d=>d.id===state.area.id);return {title:d?.label||state.area.id,kicker:'HOUSE DISTRICT ALLOCATION',extra:'120th Congress boundaries · January 1, 2026 vintage'};}
  return {title:s?.name||'United States',kicker:state.basis==='zip'?'REPORTED ZIP TARGETS · ESTIMATE':'LOCAL TARGETING ESTIMATE',extra:state.nationwide?'Includes a population model of nationwide targets':'Nationwide targeting excluded'};
}
function renderResults(){
  if(window.AtlasOverall.supports(state)){window.AtlasOverall.renderResults();emitSelection();return;}
  $('overall-breakdown').hidden=true;
  if(state.platform!=='meta'){window.AtlasPlatforms.renderResults();emitSelection();return;}
  const area=areaInfo(),totals=current.partyTotals||current.summary||[0,0,0,0],value=totals.reduce((a,b)=>a+b,0),count=detailRows.length;
  $('area-title').textContent=area.title;$('area-kicker').textContent=area.kicker;$('clear-area').hidden=!state.area;
  $('summary').innerHTML=`<div class="amount"><span class="estimate-mark">≈</span>${escape(window.AtlasPopulation.active()?window.AtlasPopulation.format(value,window.AtlasPopulation.selection(state,manifest)):compact(value))}</div><span class="summary-caption"><strong>${number.format(count)} ${count===1?'advertiser':'advertisers'}</strong> linked to this view<br>${escape(area.extra)}${window.AtlasPopulation.active()?'<br>USD per resident · 2020 ACS population':''}</span>`;
  $('party-summary').innerHTML=value>0?`<div class="party-track" aria-hidden="true">${totals.map((v,i)=>`<span style="width:${v/value*100}%;background:${Object.values(palette)[i]}"></span>`).join('')}</div><div class="party-breakdown">${totals.map((v,i)=>v>0?`<span title="${escape(Object.values(labels)[i])}"><i class="party-dot ${Object.keys(palette)[i]}"></i>${['Dem','Rep','Other','Uncl.'][i]} <b>${Math.round(v/value*100)}%</b></span>`:'').join('')}</div>`:'';
  $('rank-title').textContent=state.pageID?'Selected advertiser':'Advertisers in this view';renderRanks();emitSelection();
  $('view-note').textContent=(state.basis==='zip'?'Only explicit positive ZIP criteria are shown. ':'Broader local criteria use a population model. ')+(state.nationwide?'Nationwide targeting is also modelled. ':'')+'Amounts are estimates of geographic allocation, not measured ad delivery.';
}
function renderRanks(){
  if(window.AtlasOverall.supports(state)){window.AtlasOverall.renderRanks();return;}
  if(state.platform!=='meta'){window.AtlasPlatforms?.renderRanks();return;}
  const rows=detailRows.slice(0,rankLimit);
  if(!rows.length){const a=activePage(),p=a?.periods[state.period];$('advertisers').innerHTML=`<div class="empty-state">${a&&!p?'No targeting data is available for this advertiser in the selected period.':a&&p.currency&&p.currency!=='USD'?'This account reports spending in '+escape(p.currency)+'. It is excluded from the USD allocation model.':a&&p?.national_budget>0&&!state.nationwide?'This advertiser has reported nationwide targeting. Turn on “Model nationwide targets” to explore its population-based allocation.':'No mapped allocation matches these filters. Try another place, include unclassified advertisers, or broaden the targeting view.'}</div>`;}
  else $('advertisers').innerHTML=rows.map(([index,budget],i)=>{const a=catalog[index],candidate=window.AtlasConnections?.labelFor(a.id);return `<button class="advertiser-row" data-index="${index}" title="Explore ${escape(a.name)}"><span class="advertiser-rank">${String(i+1).padStart(2,'0')}</span><span><span class="advertiser-name">${escape(a.name)}</span>${window.AtlasIdentities.badge(a.id,true)}<span class="advertiser-category"><i class="party-dot ${a.party}"></i>${escape(labels[a.party])}</span>${candidate?`<span class="advertiser-candidate">${escape(candidate)}</span>`:''}</span><span class="advertiser-value">${escape(window.AtlasPopulation.active()?window.AtlasPopulation.format(budget,window.AtlasPopulation.selection(state,manifest)):compact(budget))}</span></button>`;}).join('');
  $('advertisers').querySelectorAll('[data-index]').forEach(button=>button.onclick=()=>chooseAdvertiser(Number(button.dataset.index)));
  $('show-more').hidden=detailRows.length<=rankLimit;
}
async function getAccountDetail(id){if(state.date){const index=pageIndex.get(id),criteria=[];for(const g of data.groups){const row=g.accounts.find(r=>r[0]===index);if(row)criteria.push([g.type,g.name,null,false,row[1]]);}const n=data.national.find(r=>r[0]===index);if(n)criteria.push(['countries','United States',null,false,n[1]]);return {dated_model:true,periods:{[state.period]:{criteria,interests:[],custom_audience_reported:null}}};}const shard=await json(`data/advertisers/${id.slice(-2)}.json`);return shard[id];}
async function renderAccountDetail(id,version){
  const box=$('account-detail');box.hidden=false;box.innerHTML='<p>Loading reported targeting criteria…</p>';
  try{
    const detail=await getAccountDetail(id);if(version!==revision||id!==state.pageID)return;
    const a=activePage(),p=detail?.periods?.[state.period];if(!p){box.innerHTML='<p>This reporting period has no available targeting detail for this advertiser.</p>';return;}
    const criteria=(p.criteria||[]).filter(c=>!c[3]).sort((a,b)=>(b[4]||0)-(a[4]||0));const excluded=(p.criteria||[]).filter(c=>c[3]);
    function criterionRow(c){return `<div class="criterion-row"><span>${escape(c[1])}<small>${escape(c[0])}${c[3]?' · excluded':' · reported weight '+(Number.isFinite(c[2])?(c[2]*100).toLocaleString('en-US',{maximumFractionDigits:2})+'%':'unavailable')}</small></span><b>${c[3]?'Excluded':c[4]>0?compact(c[4]):'Unallocated'}</b></div>`;}
    box.innerHTML=`<h3>Reported targeting choices</h3><p>These account-level criteria can overlap. The amounts below are bounded criterion allocations before any population or district division.</p>${criteria.slice(0,6).map(criterionRow).join('')}${criteria.length>6?`<details><summary>${number.format(criteria.length-6)} more included criteria</summary>${criteria.slice(6,56).map(criterionRow).join('')}${criteria.length>56?'<p>Download source criteria below for the complete list.</p>':''}</details>`:''}${detail.dated_model?'<p>This dated model retains positive geographic allocations. Read the original snapshot for exclusions and other audience parameters.</p>':''}${excluded.length?`<details><summary>${number.format(excluded.length)} reported geographic exclusions</summary>${excluded.slice(0,40).map(criterionRow).join('')}${excluded.length>40?'<p>The complete list is in the source criteria download.</p>':''}</details>`:detail.dated_model?'<p>Geographic exclusions are available in the original dated source.</p>':'<p>No geographic exclusions are reported in this snapshot.</p>'}<p>${p.custom_audience_reported===null?'Audience parameters are available in the original dated source.':p.custom_audience_reported?'The source reports custom audience use.':'Custom audience use is not reported in this snapshot; this does not prove none was used.'}</p>${p.interests?.length?`<details><summary>Reported audience interests</summary>${p.interests.map(c=>`<div class="criterion-row"><span>${escape(c[0])}</span><b>${Number.isFinite(c[1])?(c[1]*100).toFixed(1)+'%':'—'}</b></div>`).join('')}</details>`:''}<details><summary>Additional source annotations</summary><div class="annotations">${(Array.isArray(a.annotations)?a.annotations:typeof a.annotations==='string'?[a.annotations]:[]).map(escape).join('<br>')||'No additional annotations.'}</div></details><a class="meta-link" href="https://www.facebook.com/ads/library/?active_status=all&ad_type=political_and_issue_ads&country=US&view_all_page_id=${a.id}" target="_blank" rel="noopener">View in Meta Ad Library ↗</a><br><button id="export-criteria" class="text-button">Download ${detail.dated_model?'modelled':'source'} criteria ↓</button>`;
    $('export-criteria').onclick=()=>exportCriteria(a,p);
    window.AtlasTargeting?.accountSummary(id,box);
  }catch(error){if(version===revision)box.innerHTML='<p>Targeting details couldn’t load. Select the advertiser again to retry.</p>';}
}
function chooseAdvertiser(index,{national=false}={}){
  Object.assign(state,{targetMap:false,targetMapPages:null,targetMapLabel:null,targetCriterion:null,audienceAccount:null,platformAccount:null,platformRace:null,platformAccounts:null});
  if(state.platform!=='meta'){window.AtlasPlatforms.setSource('meta').then(()=>chooseAdvertiser(index,{national}));return;}
  const a=catalog[index];if(national||state.campaignPages&&!state.campaignPages.includes(a.id)){state.campaignRace=null;state.campaignTitle=null;state.campaignPages=null;}if(national){state.place='US';state.area=null;state.geography='state';}state.pageID=a.id;state.party='all';state.tab='ads';state.view='spend';if(!a.tagged)state.untagged=true;refresh({fit:national});hideSearch();
  if(window.innerWidth<=800)$('advertiser-focus').scrollIntoView({behavior:reduceMotion?'instant':'smooth',block:'start'});
}
function renderCoverage(){
  const a=manifest.audit[state.period];$('coverage').innerHTML=[['Snapshot date',manifest.snapshot],['Reporting window',state.period+' days'],['Accounts with targeting data',number.format(a.accounts)],['Accounts with primary campaigner tags',`${number.format(a.tagged_accounts)} (${(100*a.tagged_accounts/a.accounts).toFixed(1)}%)`],['Reported account spend (USD)',compact(a.reported_spend)],['Mapped local allocation, all accounts',compact(a.mapped_local_budget)],['Nationwide allocation, all accounts',compact(a.nationwide_budget)],['Unmapped geographic allocation',compact(a.unmapped_budget)],['Budget without positive weighted geography',compact(a.unallocated_budget||0)],['Non-USD accounts excluded from model',number.format(a.non_usd_accounts)],['Excluded geographic source rows',number.format(a.excluded_location_rows)],['Rows reporting unavailable targeting',number.format(a.missing_data_rows)],['Source collected',String(a.collected_from).slice(0,10)]].map(([label,value])=>`<div class="coverage-row"><span>${escape(label)}</span><b>${escape(value)}</b></div>`).join('');
  $('source-links').innerHTML=`<a href="${escape(a.source)}" target="_blank" rel="noopener">Original ${state.period}-day metatargetr snapshot (Parquet) ↗</a><a href="data/campaigner-classification.csv.gz" download>Imported campaigner classifications (CSV.gz) ↓</a><a href="data/zip-district-crosswalk.csv.gz" download>ZIP–district overlap weights (CSV.gz) ↓</a><a href="data/geography-source.json" target="_blank" rel="noopener">Geography provenance ↗</a><a href="https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0" target="_blank" rel="noopener">Census 120th Congress boundary source ↗</a><a href="https://www.census.gov/programs-surveys/geography/guidance/geo-areas/zctas.html" target="_blank" rel="noopener">Census ZIP areas explained ↗</a><a href="https://github.com/favstats/metatargetr" target="_blank" rel="noopener">metatargetr collection software ↗</a>`;
}
function csvCell(value){const text=String(value??'');const safe=/^[=+@\-\t\r]/.test(text)?"'"+text:text;return '"'+safe.replace(/"/g,'""')+'"';}
function downloadCSV(header,rows,name){const text='\uFEFF'+[header,...rows].map(r=>r.map(csvCell).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);toast('CSV downloaded with source dates and model settings.');}
function exportView(){
  if(window.AtlasOverall.supports(state))return window.AtlasOverall.exportView();
  const header=['page_id','advertiser','affiliation','source_category','area','snapshot_date','window_days','basis','nationwide_model','include_unclassified','estimated_area_allocation_usd','reported_account_spend_usd','method_version','source_url','campaign_race_filter','linked_candidate_records','linked_races','identity_match','population_2020_acs','estimated_area_usd_per_resident','identity_status','identity_evidence_score_percent','political_status','activity_tags','include_non_political_accounts'];
  const area=state.area?state.area.type+':'+state.area.id:state.place;
  const rows=detailRows.map(([i,value])=>{const a=catalog[i];return [a.id,a.name,labels[a.party],a.category,area,manifest.snapshot,state.period,state.basis,state.nationwide,state.untagged,value.toFixed(6),a.periods[state.period]?.spend||0,'1.0',manifest.audit[state.period].source,state.campaignRace||'',...(window.AtlasConnections?.connectionFields(a.id)||['','','']),window.AtlasPopulation.selection(state,manifest),window.AtlasPopulation.rate(value,window.AtlasPopulation.selection(state,manifest)),a.identity_inference?.status||'source-tag',a.identity_inference?.score??'',a.political_status||'unreviewed',a.activity_tags?.join('; ')||'',state.includeNonPolitical];});
  downloadCSV(header,rows,`midterms-${area.replace(':','-')}-${state.period}d-${manifest.snapshot}.csv`);
}
function exportCriteria(a,p){downloadCSV(['page_id','advertiser','snapshot_date','window_days','criterion_type','criterion_value','reported_spending_weight','excluded','normalised_criterion_allocation_usd','method_version'],p.criteria.map(c=>[a.id,a.name,manifest.snapshot,state.period,...c,'1.0']),`targeting-${a.id}-${state.period}d-${manifest.snapshot}.csv`);}
function fitPlace(){
  if(!mapReady)return;let bounds;
  if(state.area?.type==='zip')bounds=data?.zips.find(z=>z.id===state.area.id)?.bounds;
  else if(state.area?.type==='district')bounds=data?.districts.find(d=>d.id===state.area.id)?.bounds;else if(['upper','lower'].includes(state.area?.type))bounds=legData[state.area.type]?.districts.find(d=>d.id===state.area.id)?.bounds;
  if(!bounds)bounds=manifest.states.find(s=>s.abbr===state.place)?.bounds||[-125,24.5,-66,50];
  const mobile=window.innerWidth<=800,drawer=$('election-drawer'),mapRect=map.getContainer().getBoundingClientRect(),drawerWidth=!mobile&&!drawer.hidden?Math.max(0,mapRect.right-drawer.getBoundingClientRect().left):0,right=drawerWidth?Math.min(drawerWidth+20,map.getContainer().clientWidth-170):mobile?45:70;
  map.fitBounds([[bounds[0],bounds[1]],[bounds[2],bounds[3]]],{padding:state.area?{top:90,right,bottom:170,left:45}:{top:mobile?163:145,right,bottom:mobile?178:180,left:mobile?50:70},duration:reduceMotion?0:550,maxZoom:state.area?10.4:7.5});
}
function applySelectionOutline(){
  if(!mapReady)return;for(const source of ['zips','districts','upper','lower'])if(map.getLayer(source+'-selected'))map.setFilter(source+'-selected',['==',['get','id'],state.area?.type===(source==='zips'?'zip':source==='districts'?'district':source)?state.area.id:'']);
}
function hideTooltip(){ $('map-tooltip').hidden=true;if(map)map.getCanvas().style.cursor='';hover=null; }
function showTooltip(event){
  if(!current||!mapReady||renderFrame||busy)return;renderFrame=requestAnimationFrame(()=>{renderFrame=null;
    const source=sourceForView();const hit=map.queryRenderedFeatures(event.point,{layers:[source+'-fill']})[0];if(!hit){hideTooltip();return;}
    const id=String(hit.properties.id),kind=source==='states'?'state':source==='zips'?'zip':source==='districts'?'district':source,v=geoValues(kind,id),total=v.reduce((a,b)=>a+b,0),partisan=v[0]+v[1];
    const name=kind==='state'?manifest.states.find(s=>s.id===id)?.name:kind==='zip'?'ZIP '+id:kind==='district'?data.districts.find(d=>d.id===id)?.label:legData[kind]?.districts.find(d=>d.id===id)?.name;
    const tip=$('map-tooltip');tip.innerHTML=`<div class="tooltip-kicker">${kind==='state'?'STATE':kind==='zip'?'ZIP AREA':kind==='district'?'US HOUSE DISTRICT':kind==='upper'?'STATE SENATE':'STATE HOUSE'}</div><div class="tooltip-name">${escape(name||id)}</div><div class="tooltip-amount">${total>0?(window.AtlasPopulation.active()?'≈ '+window.AtlasPopulation.format(total,window.AtlasPopulation.get(kind,id))+' / resident':window.AtlasOverall.supports(state)?'≈ '+compact(total)+' combined allocation':state.platform==='meta'?'≈ '+compact(total)+' estimated allocation':window.AtlasPlatforms.tooltip(total)):(state.platform==='meta'?'No mapped estimate':window.AtlasPlatforms.tooltip(total))}</div>${window.AtlasPopulation.active()?'<div class="tooltip-population">'+compact(total)+' allocation · '+number.format(Math.round(window.AtlasPopulation.get(kind,id)))+' residents · 2020 ACS</div>':''}${window.AtlasElections?.tooltipFor(kind,id)||''}<div class="tooltip-foot">${partisan>0?`${Math.round(v[0]/partisan*100)}% Dem / ${Math.round(v[1]/partisan*100)}% Rep aligned · `:''}Click to explore</div>`;
    tip.hidden=false;const rect=$('map').getBoundingClientRect();tip.style.left=Math.max(8,Math.min(event.point.x+16,rect.width-tip.offsetWidth-12))+'px';tip.style.top=Math.max(75,Math.min(event.point.y+16,rect.height-tip.offsetHeight-70))+'px';map.getCanvas().style.cursor='pointer';hover={source,id,kind};
  });
}
async function selectArea(type,id,{fit=false}={}){
  if(!data)return;const place=type==='zip'?data.zips.find(z=>z.id===id)?.state:type==='district'?data.districts.find(d=>d.id===id)?.state:legData[type]?.districts.find(d=>d.id===id)?.state;if(place){window.AtlasSelection?.preparePlace(place);state.place=place;}state.area={type,id};rankLimit=8;syncControls();applySelectionOutline();
  if(state.platform!=='meta'){await refresh({fit});return;}
  const version=++revision;try{const r=await workerCall('detail');if(version!==revision)return;current.partyTotals=r.partyTotals;detailRows=r.rows;renderResults();if(fit)fitPlace();$('export').disabled=!(window.AtlasOverall.supports(state)?current.rows.length:detailRows.length);}catch(error){toast(error.message);}
}
async function choosePlace(abbr,area=null){
  window.AtlasSelection?.preparePlace(abbr);state.place=abbr;state.area=area;hideSearch();hideTooltip();await refresh({load:true,fit:true});
}
function initMap(){
  if(!window.maplibregl||!window.pmtiles||!window.AtlasGeometry){rendererError='The map renderer is unavailable. Place lookup, advertiser lists and CSV downloads still work.';$('map-error').textContent=rendererError;$('map-error').hidden=false;return;}
  try{
    maplibregl.setWorkerCount(2);
    const base=new URL('data/',location.href).href;
    tileLoader=AtlasGeometry.create(geometryIndex,base);maplibregl.addProtocol('pmtiles',tileLoader.protocol.tile);
    tileState='US';
    map=new maplibregl.Map({container:'map',center:[-99,31],zoom:4.7,maxZoom:13,minZoom:2,attributionControl:false,renderWorldCopies:false,dragRotate:false,touchPitch:false,cooperativeGestures:window.innerWidth<=800,fadeDuration:reduceMotion?0:180,style:{version:8,sources:{states:{type:'geojson',data:base+'states.geojson',promoteId:'id'},zips:{type:'vector',url:tileLoader.url('zips-US'),promoteId:'id'},districts:{type:'vector',url:tileLoader.url('districts'),promoteId:'id'}},layers:[{id:'paper',type:'background',paint:{'background-color':'#f0f3f7'}},{id:'states-land',type:'fill',source:'states',paint:{'fill-color':'#e6eaf0','fill-opacity':.8}},{id:'states-fill',type:'fill',source:'states',layout:{visibility:'none'},paint:{'fill-color':'#e6eaf0','fill-opacity':.9}},{id:'zips-fill',type:'fill',source:'zips','source-layer':'zips',layout:{visibility:'none'},paint:{'fill-color':'#e6eaf0','fill-opacity':.9}},{id:'zips-lines',type:'line',source:'zips','source-layer':'zips',layout:{visibility:'none'},paint:{'line-color':'#fdfdfe','line-width':['interpolate',['linear'],['zoom'],4,.22,7,.65,10,1.2],'line-opacity':.55}},{id:'districts-fill',type:'fill',source:'districts','source-layer':'districts',layout:{visibility:'none'},paint:{'fill-color':'#e6eaf0','fill-opacity':.92}},{id:'districts-lines',type:'line',source:'districts','source-layer':'districts',layout:{visibility:'none'},paint:{'line-color':'#fdfdfe','line-width':1.1,'line-opacity':.9}},{id:'states-outline',type:'line',source:'states',paint:{'line-color':'#66728a','line-width':.75,'line-opacity':.45}},{id:'selected-state',type:'line',source:'states',filter:['==',['get','abbr'],'TX'],paint:{'line-color':'#2054b3','line-width':1.15,'line-opacity':.9}},{id:'zips-selected',type:'line',source:'zips','source-layer':'zips',filter:['==',['get','id'],''],paint:{'line-color':'#17243d','line-width':2.8}},{id:'districts-selected',type:'line',source:'districts','source-layer':'districts',filter:['==',['get','id'],''],paint:{'line-color':'#17243d','line-width':2.8}}]}});
    syncAttribution();map.addControl(new maplibregl.ScaleControl({maxWidth:75,unit:'imperial'}),'bottom-left');
    if(map.setPixelRatio)map.setPixelRatio(Math.min(devicePixelRatio,1.75));
    map.on('load',()=>{mapReady=true;Object.keys(legData).forEach(addLegislativeLayer);metrics.rendererReady=performance.now()-metrics.started;fitPlace();if(current)paintMap().then(()=>{updateMarkers();syncMapLoading();});});
    map.on('idle',()=>{scheduleVisiblePaint();syncMapLoading();});map.on('sourcedata',e=>{if(e.sourceId===sourceForView()&&e.sourceDataType==='content')scheduleVisiblePaint();});
    map.on('mousemove',showTooltip);map.on('mouseout',hideTooltip);map.on('movestart',hideTooltip);map.on('moveend',()=>{scheduleVisiblePaint();updateMarkers();});
    map.on('click',e=>{if(!current||busy)return;const source=sourceForView();const feature=map.queryRenderedFeatures(e.point,{layers:[source+'-fill']})[0];if(feature){const id=String(feature.properties.id);if(source==='states'){const s=manifest.states.find(s=>s.id===id);if(s)choosePlace(s.abbr);}else selectArea(source==='zips'?'zip':source==='districts'?'district':source,id);}else{const s=map.queryRenderedFeatures(e.point,{layers:['states-land']})[0];if(s&&s.properties.abbr!==state.place)choosePlace(s.properties.abbr);}});
    let reported=false;map.on('error',e=>{console.warn('Map resource:',e.error?.message);if(!reported&&(['zips','districts','upper','lower'].includes(e.sourceId)||/pmtiles|geometry|zips|districts/i.test(e.error?.message||''))){reported=true;rendererError='The coloured map layer couldn’t load. Refresh this page to retry. Place data and CSV downloads remain available.';$('map-error').textContent=rendererError;$('map-error').hidden=false;$('map-loading').hidden=true;}});
  }catch(error){map=null;rendererError='This browser couldn’t draw the interactive map. You can still search places, compare advertiser lists and download the data.';$('map-error').textContent=rendererError;$('map-error').hidden=false;console.warn(error);}
}
function updateMarkers(){
  if(!mapReady)return;cityMarkers.forEach(m=>m.remove());districtMarkers.forEach(m=>m.remove());cityMarkers=[];districtMarkers=[];
  const bounds=map.getBounds();
  if(map.getZoom()<4.6||state.geography==='state'){
    for(const s of manifest.states){const b=s.bounds,center=s.center||[(b[0]+b[2])/2,(b[1]+b[3])/2];if(!bounds.contains(center))continue;const el=document.createElement('div');el.className='district-label';el.textContent=s.abbr;el.setAttribute('aria-hidden','true');cityMarkers.push(new maplibregl.Marker({element:el}).setLngLat(center).addTo(map));}
  }else if(['district','upper','lower'].includes(state.geography)&&map.getZoom()>4.7&&data){
    const placed=[];const districts=(state.geography==='district'?data.districts:legData[state.geography]?.districts||[]).slice().sort((a,b)=>(b.bounds[2]-b.bounds[0])*(b.bounds[3]-b.bounds[1])-(a.bounds[2]-a.bounds[0])*(a.bounds[3]-a.bounds[1]));
    for(const d of districts){if(!bounds.contains(d.center))continue;const pt=map.project(d.center);if(placed.some(p=>Math.abs(pt.x-p.x)<46&&Math.abs(pt.y-p.y)<20))continue;placed.push(pt);const el=document.createElement('div');el.className='district-label';el.textContent=d.label||(d.state+'-'+d.number.replace(/^0+/,''));el.setAttribute('aria-hidden','true');districtMarkers.push(new maplibregl.Marker({element:el}).setLngLat(d.center).addTo(map));}
  }else if(data&&map.getZoom()>4.4){
    const candidates=data.groups.filter(g=>g.type==='CITY'&&g.members.length>1).map(g=>{let population=0,x=0,y=0;for(const [i,w]of g.members){const z=data.zips[i];population+=z.population;x+=z.center[0]*w;y+=z.center[1]*w;}const sum=g.members.reduce((a,m)=>a+m[1],0);return {name:g.name.split(',')[0],center:[x/sum,y/sum],population};}).sort((a,b)=>b.population-a.population);
    const added=[];for(const city of candidates){if(added.length>=12)break;if(!bounds.contains(city.center)||added.some(c=>c.name===city.name))continue;const pt=map.project(city.center);if(added.some(c=>Math.hypot(pt.x-c.pt.x,pt.y-c.pt.y)<65))continue;const el=document.createElement('div');el.className='city-label';el.textContent=city.name;el.setAttribute('aria-hidden','true');cityMarkers.push(new maplibregl.Marker({element:el,anchor:'left'}).setLngLat(city.center).addTo(map));added.push({...city,pt});}
  }
}
async function getZipIndex(){if(!zipIndex){const list=await json('data/zip-index.json.gz');zipIndex=new Map(list.map(row=>[row[0],row]));}return zipIndex;}
function hideSearch(){ $('search-results').hidden=true;$('search').setAttribute('aria-expanded','false');searchItems=[];searchIndex=-1;$('search').removeAttribute('aria-activedescendant'); }
async function showSearch(){
  const query=$('search').value.trim(),lower=query.toLowerCase();if(!query){hideSearch();return;}
  const items=[];
  for(const s of manifest.states)if(s.name.toLowerCase().includes(lower)||s.abbr.toLowerCase()===lower)items.push({kind:'state',name:s.name,sub:'Explore state targeting',action:()=>choosePlace(s.abbr)});
  const districtQuery=lower.replace(/\s+/g,'-');
  for(const d of manifest.districts)if(d.label.toLowerCase()===districtQuery||(districtQuery.length>=3&&d.label.toLowerCase().startsWith(districtQuery)))items.push({kind:'house',name:d.label,sub:'120th Congress district',action:()=>{state.geography='district';choosePlace(d.state,{type:'district',id:d.id});}});
  if(/^\d{2,5}$/.test(query)){
    try{const index=await getZipIndex();if(query!==$('search').value.trim())return;let found=0;for(const [id,row] of index){if(id.startsWith(query)){items.push({kind:'zip',name:'ZIP '+id,sub:manifest.states.find(s=>s.abbr===row[1])?.name||row[1],action:()=>{state.geography='zip';choosePlace(row[1],{type:'zip',id});}});if(++found>=6)break;}}}catch{items.push({kind:'error',name:'ZIP index could not load',sub:'Try the state selector, or search again.',action:()=>{}});}
  }
  const matches=[];for(let i=0;i<catalog.length;i++){const a=catalog[i];if(a.name.toLowerCase().includes(lower)||String(a.disclaimer||'').toLowerCase().includes(lower)||a.id===query)matches.push(i);}
  if(query.length>=3&&!/^\d+$/.test(query)&&window.AtlasElections?.searchCandidates){try{const candidates=await window.AtlasElections.searchCandidates(query,4);for(const c of candidates)items.push({kind:'person',name:c.name,sub:c.label+' · '+c.stateLabel+(c.status==='general'?' · November record':' · '+c.status),action:()=>window.AtlasElections.openRace(c.race,{navigate:true,candidate:c.id})});}catch{items.push({kind:'info',name:'Candidate search is unavailable',sub:'Places and advertiser search are still available.',action:()=>window.AtlasElections?.openDirectory()});}}
  matches.sort((a,b)=>(catalog[b].periods[state.period]?.spend||0)-(catalog[a].periods[state.period]?.spend||0));
  if(state.platform!=='meta'&&window.AtlasPlatforms){try{items.push(...await window.AtlasPlatforms.search(query));}catch{items.push({kind:'info',name:'Ad library search could not load',sub:'Try the platform selector again.',action:()=>window.AtlasApp.refresh()});}}
  for(const index of matches.slice(0,6)){const a=catalog[index];items.push({kind:'advr.',name:a.name,sub:labels[a.party]+' · '+accountMoney(a.periods[state.period])+' account spend',action:()=>chooseAdvertiser(index,{national:true})});}
  if(query!==$('search').value.trim())return;searchItems=items.slice(0,12);searchIndex=-1;
  $('search-results').innerHTML=searchItems.length?searchItems.map((item,i)=>`<button type="button" id="search-option-${i}" class="search-result" role="option" aria-selected="false" data-result="${i}"><span class="result-kind">${escape(item.kind)}</span><span class="result-copy"><strong>${escape(item.name)}</strong><small>${escape(item.sub)}</small></span></button>`).join(''):`<div class="search-empty">No matching candidate, place or advertiser. Try a name, a five-digit ZIP, or a district such as TX-10.</div>`;
  $('search-results').hidden=false;$('search').setAttribute('aria-expanded','true');$('search-results').querySelectorAll('[data-result]').forEach(button=>button.onclick=()=>{const item=searchItems[Number(button.dataset.result)];$('search').value='';item.action();hideSearch();});
}
function bindControls(){
  $('include-non-political').onchange=e=>{state.includeNonPolitical=e.target.checked;refresh();};
  document.querySelectorAll('[data-period]').forEach(b=>b.onclick=()=>{if(state.period===b.dataset.period)return;state.period=b.dataset.period;refresh({load:true});});
  document.querySelectorAll('[data-party]').forEach(b=>b.onclick=()=>{state.party=b.dataset.party;if(state.party!=='all')state.view='spend';refresh();});
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{state.view=b.dataset.view;syncControls();if(current&&mapReady)paintMap();else if(current)renderLegend();});
  $('state-select').onchange=e=>choosePlace(e.target.value);$('national-view').onclick=()=>choosePlace('US');
  document.querySelectorAll('[data-island]').forEach(b=>b.onclick=()=>choosePlace(b.dataset.island));
  $('geography').onchange=e=>{state.geography=e.target.value;state.area=null;refresh();updateMarkers();};
  $('basis').onchange=e=>{state.basis=e.target.value;refresh();};$('nationwide').onchange=e=>{state.nationwide=e.target.checked;refresh();};$('untagged').onchange=e=>{state.untagged=e.target.checked;if(state.pageID&&!activePage()?.tagged&&!state.untagged)state.pageID=null;refresh();};
  $('reset').onclick=()=>window.AtlasSelection.clear('filters');
  $('clear-area').onclick=()=>{state.area=null;refresh();};$('show-more').onclick=()=>{rankLimit+=12;renderRanks();};$('export').onclick=exportView;
  $('zoom-in').onclick=()=>map?.zoomIn({duration:reduceMotion?0:250});$('zoom-out').onclick=()=>map?.zoomOut({duration:reduceMotion?0:250});$('fit-map').onclick=fitPlace;
  let methodFocus=null;function closeMethod(){$('method-panel').hidden=true;document.querySelectorAll('.method-toggle').forEach(b=>b.setAttribute('aria-expanded','false'));methodFocus?.focus();}
  document.querySelectorAll('.method-toggle').forEach(button=>button.onclick=()=>{if(!$('method-panel').hidden){closeMethod();return;}methodFocus=button;$('method-panel').hidden=false;document.querySelectorAll('.method-toggle').forEach(b=>b.setAttribute('aria-expanded','true'));$('close-method').focus();});$('close-method').onclick=closeMethod;
  $('share').onclick=async()=>{syncURL();try{await navigator.clipboard.writeText(location.href);toast('Link copied. Your place, advertiser and filters are saved.');}catch{if(navigator.share){try{await navigator.share({title:'Midterms — Political Advertising Atlas',url:location.href});}catch{toast('You can copy this view’s link from your address bar.');}}else toast('Copy this view’s link from your address bar.');}};
  let searchTimer;$('search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(showSearch,90);};$('search').onfocus=()=>{getZipIndex().catch(()=>{});if($('search').value)showSearch();};
  $('search').onkeydown=e=>{if(e.key==='Escape'){hideSearch();return;}if(['ArrowDown','ArrowUp'].includes(e.key)&&searchItems.length){e.preventDefault();searchIndex=(searchIndex+(e.key==='ArrowDown'?1:-1)+searchItems.length)%searchItems.length;document.querySelectorAll('[data-result]').forEach((b,i)=>{b.classList.toggle('selected',i===searchIndex);b.setAttribute('aria-selected',String(i===searchIndex));});$('search').setAttribute('aria-activedescendant','search-option-'+searchIndex);$('search-option-'+searchIndex).scrollIntoView({block:'nearest'});}if(e.key==='Enter'&&searchItems.length){e.preventDefault();const item=searchItems[searchIndex<0?0:searchIndex];$('search').value='';item.action();hideSearch();}};
  document.addEventListener('pointerdown',e=>{if(!e.target.closest('.search-wrap'))hideSearch();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){hideSearch();if(!$('method-panel').hidden)closeMethod();}if(e.key==='/'&&!['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)){e.preventDefault();$('search').focus();}});
}
async function boot(){
  try{
    await window.AtlasIdentities.ready();
    [manifest,catalog,geometryIndex]=await Promise.all([json('data/manifest.json'),json('data/catalog.json.gz'),json('data/geometry-index.json')]);catalog=window.AtlasIdentities.apply(catalog);pageIndex=new Map(catalog.map((a,i)=>[a.id,i]));
    if(state.place!=='US'&&!manifest.states.some(s=>s.abbr===state.place))state.place='US';if(state.pageID&&!pageIndex.has(state.pageID)){state.pageID=null;toast('That advertiser is not in this snapshot. Showing the place instead.');}
    if(state.pageID&&!activePage()?.tagged)state.untagged=true;
    if(params.get('campaign')){const races=await json('data/elections/race-index.json.gz'),race=races.find(r=>r.id===params.get('campaign'));if(race){state.campaignRace=race.id;state.campaignTitle=race.title+' · '+race.state;state.campaignPages=race.advertisers||[];}else toast('That campaign filter is unavailable. Showing the place instead.');}
    $('state-select').innerHTML='<option value="US">United States</option>'+manifest.states.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(s=>`<option value="${s.abbr}">${escape(s.name)}</option>`).join('');
    worker=new Worker('model-worker.js?v=5');worker.onmessage=e=>{const p=pending.get(e.data.id);if(!p)return;clearTimeout(p.timer);pending.delete(e.data.id);e.data.error?p.reject(Error(e.data.error)):p.resolve(e.data);};worker.onerror=e=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('The map calculation worker couldn’t start. Reload this page to retry.'));}pending.clear();};worker.postMessage({type:'catalog',catalog:catalog.map(a=>({party:a.party,tagged:a.tagged,exclude_from_political:a.exclude_from_political}))});
    window.AtlasApp={refresh,prepareGeography:ensureLegislative,areaInfo,getMap:()=>map,getContext:()=>({state,manifest,catalog,data,current,legData,rows:detailRows}),navigate:async({place,area=null,geography=state.geography,tab=state.tab,fit=true,resetCampaign=false})=>{if(resetCampaign)window.AtlasSelection?.clearActors();window.AtlasSelection?.preparePlace(place);Object.assign(state,{place,area,geography,tab});await refresh({fit});},setTab:tab=>{const previous=state.tab;state.tab=tab;syncControls();emitSelection();if(tab==='targeting'&&previous!==tab)window.AtlasTargeting.enter();},setPeriod:async period=>{if(['7','30'].includes(String(period))&&state.period!==String(period)){state.period=String(period);await refresh({load:true});}},focusAdvertiser:id=>{const index=pageIndex.get(id);if(index!==undefined)chooseAdvertiser(index);},focusCampaign:async race=>{if(state.platform!=='meta')await window.AtlasPlatforms.setSource('meta');window.AtlasSelection?.clearActors();Object.assign(state,{targetMap:false,targetMapPages:null,campaignRace:race.id,campaignTitle:race.title+' · '+race.state,campaignPages:race.advertisers||[],pageID:null,party:'all',untagged:true,view:'spend',tab:'ads'});await refresh();},campaignAllocation:async({pages,place,area=null})=>{if(!data||String(data.window)!==state.period)return null;const period=state.period;await ensureLegislative(area?.type);const result=await workerCall('detail',{options:{...options(),party:'all',untagged:true,page:null,pages:pages.map(id=>pageIndex.get(id)).filter(i=>i!==undefined),stateID:manifest.states.find(s=>s.abbr===place)?.id||null},area});return {period,...result};},syncURL,reframe:fitPlace,refreshConnections:()=>{renderRanks();if(state.pageID)window.AtlasConnections?.renderAdvertiser(state.pageID);}};document.dispatchEvent(new CustomEvent('atlas:boot'));
    bindControls();initMap();await refresh({load:true,fit:true});
  }catch(error){$('map-loading').hidden=true;$('map-error').hidden=false;$('map-error').textContent='The atlas data couldn’t load. Reload this page to retry. '+error.message;$('summary').innerHTML='<span class="summary-caption">Data is currently unavailable.</span>';console.error(error);}
}
boot();
})();
