'use strict';
// Reuse the atlas's geographic allocation and account filters. Audience analysis
// stays off the UI thread and fetches its compact evidence only on demand.
importScripts('model-worker.js?v=5', 'json-transport.js?v=1');
const modelHandler = self.onmessage;
const criteriaCache = new Map();
const analysisCache = new Map();
let targetingMetadataPromise;
const familyLabels = {interests:'Interest', demographics:'Demographic', behaviours:'Behaviour',
  age:'Age', gender:'Gender', custom:'Custom audience', lookalike:'Lookalike audience',
  location:'Place', language:'Language'};

async function evidence(url) {
  if (!criteriaCache.has(url)) {
    const request = fetch(url).then(async response => {
      if (!response.ok) throw Error('Targeting evidence is unavailable for this date (' + response.status + ').');
      const file = await AtlasJSON.read(response,url);
      targetingMetadataPromise??=fetch(new URL('../targeting-metadata.json.gz',url)).then(r=>{if(!r.ok)throw Error('Targeting criterion metadata is unavailable.');return AtlasJSON.read(r,r.url);});
      const metadata=await targetingMetadataPromise;
      file.criteria=file.criteria.map(c=>({...metadata[c.id],...c}));
      file.byID = new Map(file.criteria.map(c => [c.id,c]));
      for (const c of file.criteria) {
        c.label = c.kind==='age' ? 'Age '+c.value : c.value;
        c.search = (c.value+' '+c.subtype+' '+familyLabels[c.kind]).toLocaleLowerCase('en-US');
      }
      return file;
    }).catch(error => {criteriaCache.delete(url);throw error;});
    criteriaCache.set(url,request);
    if (criteriaCache.size>2) criteriaCache.delete(criteriaCache.keys().next().value);
  }
  return criteriaCache.get(url);
}

function budgetScope(o,area) {
  o.pageSet=Array.isArray(o.pages)?new Set(o.pages):null;
  const local=area||o.stateID ? new Map(contributors(o,area).rows) : null;
  const budgets=new Map(),denominators=[0,0,0,0],accountCounts=[0,0,0,0];
  for(let i=0;i<catalog.length;i++) {
    const a=catalog[i],period=a.periods[o.period];
    if(o.visibleParties&&!o.visibleParties.includes(a.party))continue;
    if(!accept(i,o)||!period||period.currency!=='USD')continue;
    const budget=local?(local.get(i)||0):period.spend;
    if(!(budget>0))continue;
    const p=parties[a.party];
    budgets.set(i,budget);denominators[p]+=budget;accountCounts[p]++;
  }
  return {budgets,denominators,accountCounts};
}

function aggregateCriterion(c,scope,withAccounts=false) {
  const values=[0,0,0,0],counts=[0,0,0,0],unknown=[0,0,0,0],accounts=[];
  for(const [i,weight,ads]of c.accounts) {
    const budget=scope.budgets.get(i);
    if(budget===undefined)continue;
    const a=catalog[i],p=parties[a.party];
    counts[p]++;
    const value=!c.excluded&&Number.isFinite(weight)?budget*weight:null;
    if(value===null)unknown[p]++;else values[p]+=value;
    if(withAccounts)accounts.push({index:i,id:a.id,party:a.party,name:a.name,weight,ads,value,budget,
      spend:a.periods[activePeriod]?.spend||0,disclaimer:a.disclaimer});
  }
  const shares=values.map((v,p)=>scope.denominators[p]>0?v/scope.denominators[p]:null);
  const usageShares=counts.map((v,p)=>scope.accountCounts[p]>0?v/scope.accountCounts[p]:null);
  return {id:c.id,kind:c.kind,label:c.label,value:c.value,subtype:c.subtype,excluded:c.excluded,
    values,shares,usageShares,counts,unknown,total:values.reduce((n,v)=>n+v,0),
    count:counts.reduce((n,v)=>n+v,0),gap:!c.excluded&&shares[0]!==null&&shares[1]!==null?(shares[0]-shares[1])*100:null,
    usageGap:usageShares[0]!==null&&usageShares[1]!==null?(usageShares[0]-usageShares[1])*100:null,
    accounts};
}
let activePeriod='30';

async function analysis(message) {
  const began=performance.now(),{url,options:o,area,settings}=message,file=await evidence(url);
  if(file.snapshot!==o.date||String(file.window)!==String(o.period))throw Error('Targeting and spending dates do not match.');
  if(file.snapshot!==data.snapshot||String(file.window)!==String(data.window))throw Error('Wait for the spending snapshot to finish updating, then retry.');
  activePeriod=o.period;
  const cacheKey=JSON.stringify([url,o,area,settings.family,settings.mode,settings.query]);
  if(analysisCache.has(cacheKey))return analysisCache.get(cacheKey);
  const scope=budgetScope(o,area),search=String(settings.query||'').trim().toLocaleLowerCase('en-US');
  const words=search.split(/\s+/).filter(Boolean),rows=[],criteria=[];
  const observed=new Set(file.observed_accounts),observedCounts=[0,0,0,0],observedBudgets=[0,0,0,0];
  for(const [i,budget]of scope.budgets)if(observed.has(i)){const p=parties[catalog[i].party];observedCounts[p]++;observedBudgets[p]+=budget;}
  for(const c of file.criteria) {
    if(c.excluded!==(settings.mode==='exclusions')||settings.family!=='all'&&settings.family!==c.kind||words.some(w=>!c.search.includes(w)))continue;
    const row=aggregateCriterion(c,scope);if(!row.count)continue;
    delete row.accounts;rows.push(row);criteria.push(c);
  }
  const result={file,scope,rows,criteria,observedCounts,observedBudgets,began};
  analysisCache.set(cacheKey,result);if(analysisCache.size>3)analysisCache.delete(analysisCache.keys().next().value);
  return result;
}

function networkLayout(nodes,edges) {
  // A bounded, deterministic force layout runs here, never on the UI thread.
  // Positions group links; they do not claim geographic or audience distance.
  const byID=new Map(nodes.map((n,i)=>[n.id,i])),groups=[[],[],[],[]];
  nodes.forEach((n,i)=>{if(n.type==='account')groups[parties[n.party]].push(i);});
  const criterionNodes=nodes.filter(n=>n.type==='criterion');
  nodes.forEach((n,i)=>{
    if(n.type==='criterion'){
      const shares=n.excluded?n.usageShares:n.shares,j=criterionNodes.indexOf(n),a=Number.isFinite(shares[0])?shares[0]:0,b=Number.isFinite(shares[1])?shares[1]:0;
      n.ax=.5+(a+b?(b-a)/(a+b):0)*.13;
      n.ay=.13+(((j+.5)*.61803398875)%1)*.73;
    }else{
      const p=parties[n.party],g=groups[p],j=g.indexOf(i);
      n.ax=p===0?.12:p===1?.88:p===2?.32:.68;
      n.ay=p<2?.09+(j+.5)/Math.max(1,g.length)*.84:p===2?.04:.96;
    }
    n.x=n.ax;n.y=n.ay;n.vx=0;n.vy=0;
  });
  const links=edges.map(e=>[byID.get(e.source),byID.get(e.target),e.value||0]);
  const top=Math.max(1,...links.map(e=>e[2]));
  for(let step=0;step<90;step++){
    const cooling=1-step/110;
    for(const n of nodes){n.vx+=(n.ax-n.x)*.06;n.vy+=(n.ay-n.y)*.035;}
    for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
      const a=nodes[i],b=nodes[j],dx=a.x-b.x,dy=a.y-b.y,d2=dx*dx+dy*dy+.00003;
      const f=Math.min(.018,.000009/d2),inv=1/Math.sqrt(d2);
      a.vx+=dx*inv*f;a.vy+=dy*inv*f;b.vx-=dx*inv*f;b.vy-=dy*inv*f;
    }
    for(const [i,j,value]of links){
      const a=nodes[i],b=nodes[j],f=.002*(.2+Math.sqrt(value/top));
      a.vx+=(b.x-a.x)*f;a.vy+=(b.y-a.y)*f;b.vx+=(a.x-b.x)*f;b.vy+=(a.y-b.y)*f;
    }
    for(const n of nodes){
      n.vx*=.55;n.vy*=.55;n.x+=n.vx*cooling;n.y+=n.vy*cooling;
      n.x=Math.max(n.type==='criterion'?.29:n.party==='dem'?.065:n.party==='rep'?.75:.12,Math.min(n.type==='criterion'?.71:n.party==='dem'?.25:n.party==='rep'?.935:.88,n.x));
      n.y=Math.max(.035,Math.min(.965,n.y));
    }
  }
  for(const n of nodes){delete n.vx;delete n.vy;delete n.ax;delete n.ay;}
}

function visualization(a,settings) {
  const {rows,criteria,scope,file}=a,byRow=new Map(rows.map(r=>[r.id,r])),byCriterion=new Map(criteria.map(c=>[c.id,c]));
  const bySpend=[...rows].sort((a,b)=>b.total-a.total||b.count-a.count),byDifference=[...rows].filter(r=>r.gap!==null).sort((a,b)=>Math.abs(b.gap)-Math.abs(a.gap)||b.total-a.total);
  const sharedScore=r=>Math.min((r.excluded?r.usageShares:r.shares)[0]||0,(r.excluded?r.usageShares:r.shares)[1]||0);
  const byShared=[...rows].filter(r=>r.counts[0]&&r.counts[1]).sort((a,b)=>sharedScore(b)-sharedScore(a)||b.total-a.total);
  const selected=[],seen=new Set(),take=(list,n)=>{for(const r of list.slice(0,n))if(!seen.has(r.id)){seen.add(r.id);selected.push(r);}};
  if(settings.preset==='shared')take(byShared,32);
  else if(settings.preset==='distinctive')take(byDifference.length?byDifference:bySpend,32);
  else{take(bySpend,18);take(byDifference.filter(r=>r.gap>0),6);take(byDifference.filter(r=>r.gap<0),6);take(byShared,5);}
  const accountCounts=new Map(),scores=new Map();
  for(const c of criteria)for(const [i,w]of c.accounts)if(scope.budgets.has(i)){
    accountCounts.set(i,(accountCounts.get(i)||0)+1);
    scores.set(i,Math.max(scores.get(i)||0,Number.isFinite(w)?scope.budgets.get(i)*w:0));
  }
  const selectedIndex=settings.account?catalog.findIndex(c=>c.id===settings.account):-1;
  if(selectedIndex>=0&&scope.budgets.has(selectedIndex)){
    const relevant=criteria.filter(c=>c.accounts.some(r=>r[0]===selectedIndex)).map(c=>({c,w:c.accounts.find(r=>r[0]===selectedIndex)[1]})).sort((a,b)=>(b.w||0)-(a.w||0));
    take(relevant.map(v=>byRow.get(v.c.id)),6);
  }
  if(settings.criterion&&byRow.has(settings.criterion))take([byRow.get(settings.criterion)],1);
  const selectedRows=selected.slice(0,39),accountCandidates=new Map();
  if(settings.criterion&&byRow.has(settings.criterion)&&!selectedRows.some(r=>r.id===settings.criterion))selectedRows.push(byRow.get(settings.criterion));
  for(const r of selectedRows){
    const members=byCriterion.get(r.id).accounts.filter(([i])=>scope.budgets.has(i)).sort((a,b)=>(scope.budgets.get(b[0])*(b[1]||0))-(scope.budgets.get(a[0])*(a[1]||0)));
    for(const p of ['dem','rep','other','untagged']){
      for(const v of members.filter(([i])=>catalog[i].party===p).slice(0,5))accountCandidates.set(v[0],(accountCandidates.get(v[0])||0)+1);
    }
  }
  const selectedAccountIndices=[...accountCandidates].sort((a,b)=>b[1]-a[1]||(scores.get(b[0])||0)-(scores.get(a[0])||0)).slice(0,54).map(v=>v[0]);
  if(selectedIndex>=0&&scope.budgets.has(selectedIndex)&&!selectedAccountIndices.includes(selectedIndex))selectedAccountIndices.push(selectedIndex);
  const selectedAccounts=new Set(selectedAccountIndices),nodes=[],edges=[];
  const accountNode=i=>({id:'a:'+catalog[i].id,page:catalog[i].id,type:'account',name:catalog[i].name,party:catalog[i].party,budget:scope.budgets.get(i),spend:catalog[i].periods[activePeriod].spend,criterionCount:accountCounts.get(i)||0});
  for(const i of selectedAccountIndices)nodes.push(accountNode(i));
  let eligibleLinks=0;
  for(const r of selectedRows){
    nodes.push({...r,id:'c:'+r.id,criterion:r.id,type:'criterion'});
    for(const [i,weight,ads]of byCriterion.get(r.id).accounts)if(scope.budgets.has(i)){
      eligibleLinks++;if(!selectedAccounts.has(i))continue;
      edges.push({id:catalog[i].id+':'+r.id,source:'a:'+catalog[i].id,target:'c:'+r.id,page:catalog[i].id,criterion:r.id,party:catalog[i].party,weight,ads,value:r.excluded?null:Number.isFinite(weight)?scope.budgets.get(i)*weight:null});
    }
  }
  networkLayout(nodes,edges);
  const selectedCriterion=settings.criterion?byRow.get(settings.criterion):bySpend[0],flow=selectedCriterion?aggregateCriterion(byCriterion.get(selectedCriterion.id),scope,true):null;
  if(flow){
    const positive=flow.accounts.filter(v=>flow.excluded||Number.isFinite(v.value)&&v.value>0);
    flow.unpriced=flow.accounts.filter(v=>!flow.excluded&&(!Number.isFinite(v.value)||v.value===0)).length;
    const flowAccounts=[];let shownAccounts=0;
    for(let p=0;p<4;p++){
      const members=positive.filter(v=>parties[v.party]===p).sort((a,b)=>flow.excluded?b.ads-a.ads:b.value-a.value),keep=members.slice(0,settings.extras?5:8),rest=members.slice(keep.length);
      flowAccounts.push(...keep.map(v=>({...v,id:'a:'+v.id,page:v.id,flowValue:flow.excluded?1:v.value})));shownAccounts+=keep.length;
      if(rest.length)flowAccounts.push({id:'rest:'+p,name:rest.length+' more '+['Democratic','Republican','Other','unclassified'][p]+' advertisers',party:['dem','rep','other','untagged'][p],flowValue:rest.reduce((n,v)=>n+(flow.excluded?1:v.value),0),group:true,count:rest.length,members:rest.slice(0,12)});
    }
    flow.accounts=flowAccounts;flow.shownAccounts=shownAccounts;flow.metric=flow.excluded?'accounts':'usd';
  }
  let focusAccount=null;
  if(selectedIndex>=0&&scope.budgets.has(selectedIndex)){
    focusAccount=accountNode(selectedIndex);
    focusAccount.criteria=criteria.flatMap(c=>{const v=c.accounts.find(r=>r[0]===selectedIndex);return v?[{id:c.id,label:c.label,kind:c.kind,weight:v[1],ads:v[2],value:c.excluded?null:Number.isFinite(v[1])?scope.budgets.get(selectedIndex)*v[1]:null}]:[];}).sort((a,b)=>(b.value||0)-(a.value||0)||b.ads-a.ads);
    focusAccount.criterionTotal=focusAccount.criteria.length;focusAccount.criteria=focusAccount.criteria.slice(0,12);
  }
  const landscape=bySpend.slice(0,6000);if(settings.criterion&&byRow.has(settings.criterion)&&!landscape.some(r=>r.id===settings.criterion))landscape.push(byRow.get(settings.criterion));
  return {network:{nodes,edges,eligibleLinks},landscape,flow,focusAccount,criteriaTotal:rows.length,advertisersTotal:accountCounts.size,
    findings:{distinctive:byDifference[0]||null,shared:byShared[0]||null,connector:[...accountCounts].sort((a,b)=>b[1]-a[1])[0]?.[0]??null},
    connector:[...accountCounts].sort((a,b)=>b[1]-a[1]).slice(0,1).map(([i])=>accountNode(i))[0]||null,
    excluded:settings.mode==='exclusions',source:file.source};
}

async function query(message) {
  const began=performance.now(),{options:o,settings}=message,a=await analysis(message),{file,scope,observedCounts,observedBudgets}=a;
  activePeriod=o.period;
  const rows=[...a.rows];
  const key=settings.mode==='exclusions'||settings.sort==='accounts'?'count':settings.sort==='difference'?'gap':'total';
  rows.sort((a,b)=>(key==='gap'?Math.abs(b.gap||0)-Math.abs(a.gap||0):(b[key]||0)-(a[key]||0))||b.total-a.total||a.label.localeCompare(b.label));
  const selected=settings.criterion?file.byID.get(settings.criterion):null;
  const detail=selected?aggregateCriterion(selected,scope,true):null;
  if(detail){detail.accounts.sort((a,b)=>(b.value??b.budget)-(a.value??a.budget));detail.accountTotal=detail.accounts.length;if(!settings.exportAll)detail.accounts=detail.accounts.slice(0,settings.accountLimit||12);}
  return {rows:settings.exportAll?rows:rows.slice(0,settings.limit||18),totalRows:rows.length,
    max:rows.reduce((n,r)=>Math.max(n,settings.mode==='exclusions'?r.count:r.total),0),
    maxShare:rows.reduce((n,r)=>Math.max(n,...r.shares.map(v=>v??0)),0),
    denominators:scope.denominators,accountCounts:scope.accountCounts,observedCounts,observedBudgets,
    detail,source:file.source,collected_from:file.collected_from,collected_to:file.collected_to,
    snapshot:file.snapshot,window:file.window,local:!!(message.area||o.stateID),
    visual:settings.visual&&!settings.exportAll?visualization(a,settings):null,elapsed:performance.now()-began};
}

async function accountSummary(message) {
  const file=await evidence(message.url),i=catalog.findIndex(a=>a.id===message.page),groups=[],families={};
  if(i<0)return {groups:[],available:false};
  for(const c of file.criteria) {
    const row=c.accounts.find(r=>r[0]===i);if(!row)continue;
    if(!c.excluded){families[c.kind]=(families[c.kind]||0)+1;
      if(c.kind==='interests'&&Number.isFinite(row[1]))groups.push({id:c.id,label:c.label,weight:row[1]});}
  }
  groups.sort((a,b)=>b.weight-a.weight);
  return {groups:groups.slice(0,3),families,available:file.observed_accounts.includes(i)};
}

self.onmessage=event=>{
  const m=event.data;
  if(!['target-query','target-members','target-account'].includes(m.type)){if(m.type==='data'||m.type==='catalog'||m.type==='legislative')analysisCache.clear();modelHandler(event);return;}
  (async()=>{
    if(m.type==='target-members') {
      const c=(await evidence(m.url)).byID.get(m.criterion);
      return {pages:c?c.accounts.filter(r=>(!catalog[r[0]]?.exclude_from_political||m.includeNonPolitical)&&(!m.visibleParties||m.visibleParties.includes(catalog[r[0]]?.party))).map(r=>catalog[r[0]]?.id).filter(Boolean):[],label:c?.label||'',kind:c?.kind};
    }
    if(m.type==='target-account')return accountSummary(m);
    return query(m);
  })().then(result=>self.postMessage({id:m.id,...result})).catch(error=>self.postMessage({id:m.id,error:error.message}));
};
