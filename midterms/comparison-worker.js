'use strict';
importScripts('overall-worker.js?v=6');
const comparisonHandler=self.onmessage;
self.onmessage=async event=>{
  const m=event.data;if(m.type!=='comparison'){comparisonHandler(event);return;}
  try{
    const s=m.snapshot;comparisonHandler({data:{type:'catalog',catalog:s.catalog}});comparisonHandler({data:{type:'data',data:{...m.geo,...s.meta}}});
    for(const [kind,data]of Object.entries(m.legs))comparisonHandler({data:{type:'legislative',kind,data}});
    const o={...m.options,nativeURL:s.nativeURL},result=await computeOverall(o);
    let rows=result.rows;
    if(o.place==='US'&&!o.area){
      rows=[];const selected=o.accounts?new Set(o.accounts):null;
      if(o.sources.includes('meta'))for(const a of s.catalog){if((!a.exclude_from_political||o.includeNonPolitical)&&(o.party==='all'||a.party===o.party)&&(a.tagged||o.untagged)&&(!selected||selected.has('meta:'+a.id))&&a.periods[o.period]?.currency==='USD')rows.push({id:'meta:'+a.id,name:a.name,party:a.party,platform:'meta',value:a.periods[o.period].spend});}
      const frozen=await overallCache.get(s.nativeURL),metadata=await nativeMetadataPromise;
      for(const a of self.AtlasIdentities.apply(frozen.accounts.map(a=>({...metadata[a.id],...a})),'native'))if(o.sources.includes(a.platform)&&overallAccept(a,o))rows.push({id:a.id,name:a.name,party:a.party,platform:a.platform,value:a.spend});
    }
    self.postMessage({id:m.id,rows:rows.map(a=>({id:a.id,name:a.name,party:a.party,platform:a.platform,value:a.value})),total:o.place==='US'&&!o.area?result.accountSpend:result.partyTotals.reduce((n,v)=>n+v,0),coverage:result.coverage,start:result.start,end:result.end});
  }catch(e){self.postMessage({id:m.id,error:e.message});}
};
