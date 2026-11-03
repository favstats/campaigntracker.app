'use strict';
// Share the bounded Meta model; add independently compiled platform budgets.
importScripts('model-worker.js?v=5');
importScripts('json-transport.js?v=1');
importScripts('identities.js?v=4');
const metaHandler=self.onmessage;
let nativeRef,overallGeo,overallCatalog,overallStateMembers,overallLeg={};
const overallCache=new Map();
const overallShapes=new Map();
let nativeMetadataPromise;
const emptyValues=()=>new Float64Array(overallGeo.zips.length*4);
function overallAccept(a,o){return (!a.exclude_from_political||o.includeNonPolitical)&&(o.party==='all'||a.party===o.party)&&(a.tagged||o.untagged)&&(!o.accounts||o.accounts.includes(a.id));}
function aggregateOverall(values){
  const dv=new Float64Array(overallGeo.districts.length*4),di=new Map(overallGeo.districts.map((d,i)=>[d.id,i])),states=new Map(overallGeo.states.map(s=>[s.id,[0,0,0,0]])),summary=[0,0,0,0],legislative={};
  for(let i=0;i<overallGeo.zips.length;i++){const z=overallGeo.zips[i];for(let p=0;p<4;p++)summary[p]+=values[i*4+p];for(const [id,w]of z.districts){const at=di.get(id),st=states.get(id.slice(0,2));if(at!==undefined)for(let p=0;p<4;p++){dv[at*4+p]+=values[i*4+p]*w;if(st)st[p]+=values[i*4+p]*w;}}}
  for(const [kind,meta]of Object.entries(overallLeg)){const ids=meta.districts.map(d=>d.id),ix=new Map(ids.map((id,i)=>[id,i])),v=new Float64Array(ids.length*4);for(const [zip,links0]of meta.zip_links){const zi=zipIndex.get(zip),links=Array.isArray(links0)?links0:links0?[links0]:[];if(zi===undefined)continue;for(const id of links){const at=ix.get(id);if(at!==undefined)for(let p=0;p<4;p++)v[at*4+p]+=values[zi*4+p]/links.length;}}legislative[kind]={ids,values:v};}
  return {values,districtValues:dv,districtIDs:overallGeo.districts.map(d=>d.id),national:[...states].map(([id,values])=>({id,values})),summary,legislative};
}
async function computeOverall(o){
  const start=performance.now();
  if(!overallCache.has(o.nativeURL)){overallCache.set(o.nativeURL,fetch(o.nativeURL).then(r=>{if(!r.ok)throw Error('Could not load dated platform spending');return self.AtlasJSON.read(r,o.nativeURL);}).catch(e=>{overallCache.delete(o.nativeURL);throw e;}));if(overallCache.size>3)overallCache.delete(overallCache.keys().next().value);}
  const frozen=await overallCache.get(o.nativeURL);
  nativeMetadataPromise??=fetch(new URL('../native-metadata.json.gz',o.nativeURL)).then(r=>{if(!r.ok)throw Error('Could not load shared platform account metadata');return self.AtlasJSON.read(r,r.url);});
  const metadata=await nativeMetadataPromise;await self.AtlasIdentities.ready();const native={...frozen,accounts:self.AtlasIdentities.apply(frozen.accounts.map(a=>({...metadata[a.id],...a})),'native')},sources=new Set(o.sources),scope=o.accounts?new Set(o.accounts):null;
  for(const platform of ['google','snapchat'])if(sources.has(platform)&&!overallShapes.has(platform)){
    const url=new URL('../'+platform+'-geography.json'+(o.nativeURL.endsWith('.gz')?'.gz':''),o.nativeURL).href;
    const response=await fetch(url,{cache:'no-cache'});if(!response.ok)throw Error('Could not load shared platform allocation shapes');overallShapes.set(platform,await self.AtlasJSON.read(response,url));
  }
  const metaOptions={...o,page:null,pages:scope?overallCatalog.map((a,i)=>scope.has('meta:'+a.id)?i:-1).filter(i=>i>=0):null};metaOptions.pageSet=metaOptions.pages?new Set(metaOptions.pages):null;
  const meta=sources.has('meta')?compute(metaOptions):aggregateOverall(emptyValues()),detail=sources.has('meta')?contributors(metaOptions,o.area):{rows:[],partyTotals:[0,0,0,0]},values=meta.values.slice(),weights=weightsFor(o.area,o),rows=[],coverage={};
  const metaSpend=overallCatalog.reduce((n,a,i)=>n+(accept(i,metaOptions)&&a.periods?.[o.period]?.currency==='USD'?a.periods[o.period].spend:0),0);
  const metaAccounts=sources.has('meta')?overallCatalog.filter((a,i)=>accept(i,metaOptions)&&a.periods?.[o.period]?.currency==='USD').length:0;
  coverage.meta={accounts:metaAccounts,platform:'meta',accountSpend:sources.has('meta')?metaSpend:0,mappedSpend:meta.summary.reduce((n,v)=>n+v,0),localSpend:detail.partyTotals.reduce((n,v)=>n+v,0),included:sources.has('meta'),kind:'reported account budgets / targeting allocation'};
  for(const [i,value]of detail.rows){const a=overallCatalog[i];rows.push({id:'meta:'+a.id,name:a.name,party:a.party,platform:'meta',value,spend:a.periods[o.period]?.spend||0,kind:'reported account budgets / targeting allocation'});}
  const partyTotals=detail.partyTotals.slice();
  for(const platform of ['google','snapchat']){
    const included=sources.has(platform),mapped=emptyValues(),ranks=new Map(),accounts=native.accounts,statePools=new Map(),stateLocalWeights=new Map();
    if(platform==='google')for(const [st,members]of overallStateMembers){let w=0;for(const [i,share]of members)w+=share*(weights?weights[i]:1);stateLocalWeights.set(st,w);}
    const accepted=new Set(accounts.map((a,i)=>a.platform===platform&&overallAccept(a,o)?i:-1).filter(i=>i>=0));
    if(included)for(const entry of native.groups){if(entry.platform!==platform)continue;const shape=overallShapes.get(platform)[entry.shape];if(!shape)throw Error('Allocation shape is missing');const group={...entry,...shape};if(group.national&&!o.nationwide)continue;const pool=[0,0,0,0];
      if(group.states){let localWeight=0;const pool=[0,0,0,0];for(const [st,w]of group.states)localWeight+=w*(stateLocalWeights.get(st)||0);for(const [i,budget]of group.accounts)if(accepted.has(i)){pool[parties[accounts[i].party]]+=budget;ranks.set(i,(ranks.get(i)||0)+budget*localWeight);}for(const [st,w]of group.states){if(!statePools.has(st))statePools.set(st,[0,0,0,0]);const totals=statePools.get(st);for(let p=0;p<4;p++)totals[p]+=pool[p]*w;}continue;}
      let members=group.members;if(group.national)members=overallGeo.zips.map((z,i)=>[i,z.population/overallGeo.country_population]);
      let localWeight=0;for(const [i,w]of members||[])localWeight+=w*(weights?weights[i]:1);
      for(const [i,budget]of group.accounts)if(accepted.has(i)){pool[parties[accounts[i].party]]+=budget;ranks.set(i,(ranks.get(i)||0)+budget*localWeight);}
      if(pool.some(Boolean))for(const [i,w]of members||[])for(let p=0;p<4;p++)mapped[i*4+p]+=pool[p]*w;
    }
    for(const [st,pool]of statePools)for(const [i,w]of overallStateMembers.get(st)||[])for(let p=0;p<4;p++)mapped[i*4+p]+=pool[p]*w;
    const accountSpend=included?[...accepted].reduce((n,i)=>n+accounts[i].spend,0):0,mappedSpend=mapped.reduce((n,v)=>n+v,0);let localSpend=0;
    for(const [i,value]of ranks)if(value>.000001){const a=accounts[i];localSpend+=value;partyTotals[parties[a.party]]+=value;rows.push({...a,value});}
    coverage[platform]={accounts:included?accepted.size:0,platform,included,accountSpend,mappedSpend,localSpend,kind:platform==='google'?'weekly overlap / historical state share estimate':'elapsed campaign day / ad targeting estimate',...native.sources[platform]};
    for(let i=0;i<values.length;i++)values[i]+=mapped[i];
  }
  rows.sort((a,b)=>b.value-a.value);
  return {...aggregateOverall(values),platform:o.platform,metric:'estimate',rows,partyTotals,coverage,accountSpend:Object.values(coverage).reduce((n,v)=>n+v.accountSpend,0),start:native.start,end:native.end,elapsed:performance.now()-start};
}
self.onmessage=async event=>{
  const e=event.data;
  if(e.type==='catalog'){overallCatalog=e.catalog;metaHandler(event);return;}
  if(e.type==='data'){
    overallGeo=e.data;overallStateMembers=new Map();const fips=new Map(overallGeo.states.map(s=>[s.id,s.abbr])),totals=new Map();
    for(let i=0;i<overallGeo.zips.length;i++)for(const [id,w]of overallGeo.zips[i].districts){const st=fips.get(id.slice(0,2)),value=overallGeo.zips[i].population*w;if(!overallStateMembers.has(st))overallStateMembers.set(st,[]);overallStateMembers.get(st).push([i,value]);totals.set(st,(totals.get(st)||0)+value);}
    for(const [st,members]of overallStateMembers)for(const row of members)row[1]/=totals.get(st);metaHandler(event);return;
  }
  if(e.type==='legislative'){overallLeg[e.kind]=e.data;metaHandler(event);return;}
  if(e.type!=='overall'){metaHandler(event);return;}
  try{self.postMessage({id:e.id,...await computeOverall(e.options)});}catch(error){self.postMessage({id:e.id,error:error.message});}
};
