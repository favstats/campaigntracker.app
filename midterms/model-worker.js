 'use strict';
let catalog=[],data=null,last=null,legRevision=0;
const parties={dem:0,rep:1,other:2,untagged:3},leg={};
let zipIndex=new Map(),stateWeights=new Map();
function accept(index,options){const a=catalog[index];return a&&(!a.exclude_from_political||options.includeNonPolitical)&&(options.page===null||index===options.page)&&(!options.pageSet||options.pageSet.has(index))&&(options.party==='all'||a.party===options.party)&&(a.tagged||options.untagged);}
function cacheKey(options){return [options.party,options.untagged,options.includeNonPolitical,options.page,options.pages?.join(',')??'all',options.basis,options.nationwide,legRevision].join('|');}
function compute(options){
  const began=performance.now(),key=cacheKey(options);if(last?.key===key)return {...last.result,elapsed:performance.now()-began};
  const n=data.zips.length,values=new Float64Array(n*4);
  for(const group of data.groups){
    if(options.basis==='zip'&&group.type!=='zips')continue;
    const pool=[0,0,0,0];
    for(const [index,budget]of group.accounts)if(accept(index,options))pool[parties[catalog[index].party]]+=budget;
    if(!pool.some(Boolean))continue;
    for(const [index,weight]of group.members)for(let p=0;p<4;p++)values[index*4+p]+=pool[p]*weight;
  }
  if(options.nationwide){
    const pool=[0,0,0,0];for(const [index,budget]of data.national)if(accept(index,options))pool[parties[catalog[index].party]]+=budget;
    for(let i=0;i<n;i++){const weight=data.zips[i].population/data.country_population;for(let p=0;p<4;p++)values[i*4+p]+=pool[p]*weight;}
  }
  const districtIDs=data.districts.map(d=>d.id),districtIndex=new Map(districtIDs.map((id,i)=>[id,i])),dv=new Float64Array(districtIDs.length*4),summary=[0,0,0,0],states=new Map(data.states.map(s=>[s.id,[0,0,0,0]]));
  for(let i=0;i<n;i++){
    for(let p=0;p<4;p++)summary[p]+=values[i*4+p];
    for(const [id,share]of data.zips[i].districts){const di=districtIndex.get(id),st=states.get(id.slice(0,2));if(di!==undefined)for(let p=0;p<4;p++){dv[di*4+p]+=values[i*4+p]*share;if(st)st[p]+=values[i*4+p]*share;}}
  }
  const legislative={};
  for(const [kind,meta]of Object.entries(leg)){
    const ids=meta.districts.map(d=>d.id),index=new Map(ids.map((id,i)=>[id,i])),v=new Float64Array(ids.length*4);
    for(const [zip,links]of meta.links){const i=zipIndex.get(zip);if(i===undefined||!links.length)continue;for(const id of links){const di=index.get(id);if(di!==undefined)for(let p=0;p<4;p++)v[di*4+p]+=values[i*4+p]/links.length;}}
    legislative[kind]={ids,values:v};
  }
  const result={values,districtValues:dv,districtIDs,summary,national:[...states].map(([id,values])=>({id,values})),legislative,elapsed:performance.now()-began};last={key,result};return result;
}
function weightsFor(area,options){
  if(area?.type==='zip')return data.zips.map(z=>z.id===area.id?1:0);
  if(area?.type==='district')return data.zips.map(z=>z.districts.find(d=>d[0]===area.id)?.[1]||0);
  if(area&&['upper','lower'].includes(area.type)){
    const meta=leg[area.type];if(!meta)throw Error('Legislative boundaries have not loaded.');const w=new Float64Array(data.zips.length);
    for(const [zip,links]of meta.links){const i=zipIndex.get(zip);if(i!==undefined&&links.includes(area.id))w[i]=1/links.length;}return w;
  }
  if(!options.stateID)return null;
  if(!stateWeights.has(options.stateID))stateWeights.set(options.stateID,data.zips.map(z=>z.districts.reduce((n,[id,w])=>n+(id.slice(0,2)===options.stateID?w:0),0)));
  return stateWeights.get(options.stateID);
}
function contributors(options,area){
  const weights=weightsFor(area,options),ranks=new Map();
  for(const group of data.groups){
    if(options.basis==='zip'&&group.type!=='zips')continue;
    let weight=0;for(const [i,w]of group.members)weight+=w*(weights?weights[i]:1);if(!weight)continue;
    for(const [index,budget]of group.accounts)if(accept(index,options))ranks.set(index,(ranks.get(index)||0)+budget*weight);
  }
  if(options.nationwide){let share=0;for(let i=0;i<data.zips.length;i++)share+=data.zips[i].population/data.country_population*(weights?weights[i]:1);for(const [index,budget]of data.national)if(accept(index,options))ranks.set(index,(ranks.get(index)||0)+budget*share);}
  const rows=[...ranks].filter(r=>r[1]>.00001).sort((a,b)=>b[1]-a[1]),partyTotals=[0,0,0,0];for(const [i,budget]of rows)partyTotals[parties[catalog[i].party]]+=budget;return {rows,partyTotals};
}
self.onmessage=event=>{
  const {type,id,options,area}=event.data;
  try{
    if(options)options.pageSet=Array.isArray(options.pages)?new Set(options.pages):null;
    if(type==='catalog'){catalog=event.data.catalog;return;}
    if(type==='data'){data=event.data.data;zipIndex=new Map(data.zips.map((z,i)=>[z.id,i]));last=null;stateWeights.clear();return;}
    if(type==='legislative'){const meta=event.data.data;leg[event.data.kind]={districts:meta.districts,links:meta.zip_links.map(([id,links])=>[id,Array.isArray(links)?links:links?[links]:[]])};legRevision++;last=null;return;}
    if(!data)throw Error('No nationwide data loaded');
    if(type==='compute'){
      const result=compute(options),detail=contributors(options,area),values=result.values.slice(),districtValues=result.districtValues.slice(),legislative=Object.fromEntries(Object.entries(result.legislative).map(([kind,v])=>[kind,{ids:v.ids,values:v.values.slice()}]));
      const transfers=[values.buffer,districtValues.buffer,...Object.values(legislative).map(v=>v.values.buffer)];self.postMessage({id,...result,values,districtValues,legislative,...detail},transfers);
    }else if(type==='detail')self.postMessage({id,...contributors(options,area)});
  }catch(error){self.postMessage({id,error:error.message});}
};
