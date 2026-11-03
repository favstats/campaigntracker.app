'use strict';
importScripts('targeting-worker.js?v=6');
const targetComparisonHandler=self.onmessage;
self.onmessage=async event=>{
  const m=event.data;if(m.type!=='comparison'){targetComparisonHandler(event);return;}
  try{
    const s=m.snapshot;targetComparisonHandler({data:{type:'catalog',catalog:s.catalog}});targetComparisonHandler({data:{type:'data',data:{...m.geo,...s.meta}}});
    for(const [kind,data]of Object.entries(m.legs))targetComparisonHandler({data:{type:'legislative',kind,data}});
    const ids=m.options.accounts?new Set(m.options.accounts):null,o={...m.options,page:null,pages:ids?s.catalog.flatMap((a,i)=>ids.has('meta:'+a.id)?[i]:[]):null,date:s.date,visibleParties:m.extras?['dem','rep','other','untagged']:['dem','rep']};
    const r=await query({url:m.targetURL,options:o,area:o.area,settings:{family:m.family||'all',mode:'positive',query:'',sort:'spend',exportAll:true,visual:false}});
    self.postMessage({id:m.id,rows:r.rows.map(a=>({id:a.id,name:a.label,platform:'Meta · '+a.kind,value:a.total,count:a.count})),total:null,observedCounts:r.observedCounts,accountCounts:r.accountCounts,collected_from:r.collected_from,collected_to:r.collected_to});
  }catch(e){self.postMessage({id:m.id,error:e.message});}
};
