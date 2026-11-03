'use strict';
importScripts('json-transport.js?v=1');
// Platform-native amounts and target counts are calculated separately from the Meta allocation model.
let geo,zipIndex,districtIndex,stateIndex,leg={},legMaps={},catalogs=new Map(),revision=0;
const classifications=new Map();
const parties={dem:0,rep:1,other:2,untagged:3};
async function library(platform,metric){
  const file=platform==='google'?(metric==='spend'?'spending':'footprints'):'geography',key=platform+':'+file;
  const url=`data/platforms/${platform}/${file}.json.gz`;
  if(!catalogs.has(key))catalogs.set(key,fetch(url).then(r=>{if(!r.ok)throw Error('Platform geography could not load');return self.AtlasJSON.read(r,url);}).catch(e=>{catalogs.delete(key);throw e;}));
  return catalogs.get(key);
}
function setLeg(kind,meta){leg[kind]=meta;legMaps[kind]=new Map(meta.zip_links.map(([id,links])=>[id,Array.isArray(links)?links:links?[links]:[]]));revision++;}
function targetAreas(t,options){
  const zips=new Set(t.zips||[]),districts=new Set(t.districts||[]),states=new Set(t.states||[]),legs={upper:new Set(),lower:new Set()};
  for(const id of zips){const z=geo.zips[zipIndex.get(id)];if(!z)continue;states.add(z.state);for(const [d]of z.districts)districts.add(d);for(const kind of Object.keys(leg))for(const d of legMaps[kind].get(id)||[])legs[kind].add(d);}
  for(const id of districts){const d=geo.districts[districtIndex.get(id)];if(d)states.add(d.state);}
  return {zips,districts,states,legs,national:!!t.national&&options.nationwide};
}
function matches(a,o){return (!a.exclude_from_political||o.includeNonPolitical)&&(!o.account||a.id===o.account)&&(!o.accounts||o.accounts.includes(a.id))&&(o.party==='all'||a.party===o.party)&&(o.untagged||a.tagged);}
async function compute(o){
  const start=performance.now(),accounts=await library(o.platform,o.metric),values=new Float64Array(geo.zips.length*4),dv=new Float64Array(geo.districts.length*4),states=geo.states.map(s=>({id:s.id,values:[0,0,0,0]})),stateMap=new Map(states.map(s=>[s.id,s.values]));
  const legislative=Object.fromEntries(Object.entries(leg).map(([kind,meta])=>[kind,{ids:meta.districts.map(d=>d.id),values:new Float64Array(meta.districts.length*4)}]));
  const legIndex=Object.fromEntries(Object.entries(leg).map(([k,m])=>[k,new Map(m.districts.map((d,i)=>[d.id,i]))]));
  const pool=[0,0,0,0],rows=[],partyTotals=[0,0,0,0],metric=o.platform==='google'&&o.metric==='spend'?'reported':'count';
  for(let i=0;i<accounts.length;i++){
    const raw=accounts[i],a={...raw,...classifications.get(raw.id)};if(!matches(a,o))continue;const p=parties[a.party]??3;
    if(metric==='reported'){
      let total=0;for(const [abbr,amount]of Object.entries(a.geo_spend||{})){const id=stateIndex.get(abbr);if(id)stateMap.get(id)[p]+=amount;if(o.place==='US'||o.place===abbr)total+=amount;}
      if(total>0){rows.push([a.index??i,total]);partyTotals[p]+=total;}continue;
    }
    const t=a.targets?.[o.window==='recent'?'recent':'year'];if(!t)continue;
    const areas=targetAreas(t,o);
    const inView=areas.national||(o.area?o.area.type==='zip'?areas.zips.has(o.area.id):o.area.type==='district'?areas.districts.has(o.area.id):areas.legs[o.area.type]?.has(o.area.id):o.place==='US'?(areas.zips.size+areas.districts.size+areas.states.size)>0:areas.states.has(o.place));
    if(inView){rows.push([a.index??i,1]);partyTotals[p]++;}
    if(areas.national){pool[p]++;continue;}
    for(const id of areas.zips){const index=zipIndex.get(id);if(index!==undefined)values[index*4+p]++;}
    for(const id of areas.districts){const index=districtIndex.get(id);if(index!==undefined)dv[index*4+p]++;}
    for(const abbr of areas.states){const id=stateIndex.get(abbr);if(id)stateMap.get(id)[p]++;}
    for(const [kind,districts]of Object.entries(areas.legs))for(const id of districts){const index=legIndex[kind]?.get(id);if(index!==undefined)legislative[kind].values[index*4+p]++;}
  }
  if(pool.some(Boolean)){
    for(const array of [values,dv,...Object.values(legislative).map(v=>v.values)])for(let i=0;i<array.length;i+=4)for(let p=0;p<4;p++)array[i+p]+=pool[p];
    for(const s of states)for(let p=0;p<4;p++)s.values[p]+=pool[p];
  }
  rows.sort((a,b)=>b[1]-a[1]);
  return {platform:o.platform,metric,values,districtValues:dv,districtIDs:geo.districts.map(d=>d.id),national:states,legislative,rows,partyTotals,summary:partyTotals,elapsed:performance.now()-start};
}
self.onmessage=async e=>{
  const {id,type}=e.data;
  try{
    if(type==='init'){geo=e.data.geo;zipIndex=new Map(geo.zips.map((z,i)=>[z.id,i]));districtIndex=new Map(geo.districts.map((d,i)=>[d.id,i]));stateIndex=new Map(geo.states.map(s=>[s.abbr,s.id]));return;}
    if(type==='classifications'){for(const a of e.data.accounts)classifications.set(a.id,a);return;}
    if(type==='leg'){setLeg(e.data.kind,e.data.data);return;}
    const result=await compute(e.data.options),transfers=[result.values.buffer,result.districtValues.buffer,...Object.values(result.legislative).map(v=>v.values.buffer)];self.postMessage({id,...result},transfers);
  }catch(error){self.postMessage({id,error:error.message});}
};
