'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const context = () => window.AtlasApp?.getContext();
  const canvas = $('audience-canvas'), chart = $('audience-chart');
  const drawing = canvas.getContext('2d', {alpha:false});
  const hitDrawing = document.createElement('canvas').getContext('2d');
  const colors = {dem:'#2054b3',rep:'#c84037',other:'#80733b',untagged:'#99a3b2'};
  const partyNames = {dem:'Democratic',rep:'Republican',other:'Other',untagged:'Unclassified'};
  const partyKeys = ['dem','rep','other','untagged'];
  const number = new Intl.NumberFormat('en-US');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const narrow = matchMedia('(max-width:800px)');
  const escape = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const percent = value => Number.isFinite(value)?(value*100).toLocaleString('en-US',{maximumFractionDigits:2})+'%':'Unavailable';
  const money = value => !Number.isFinite(value)?'Unknown':value>=1e6?'$'+(value/1e6).toLocaleString('en-US',{maximumFractionDigits:2})+'m':value>=1e3?'$'+(value/1e3).toLocaleString('en-US',{maximumFractionDigits:1})+'k':'$'+value.toLocaleString('en-US',{maximumFractionDigits:0});
  const short = value => value?new Date(value+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'}):'';
  const title = {
    network:['01 / NETWORK','Find the shared choices.','Connect advertisers to the audience criteria they report using.'],
    landscape:['02 / LANDSCAPE','See the partisan differences.','Separate shared audience choices from distinctively partisan strategies.'],
    flows:['03 / FLOWS','Follow the spending.','Trace one audience choice through parties and the advertisers behind it.']
  };
  let report, scene, width=0, height=0, dpr=1, frame=0, tween, hoverID, keyboardID, drag;
  let visible=true, queryTimer, lastVisual, lastKind, lastGeometryKey, flowRemainder;
  let lastOpen=false;
  const camera={k:1,x:0,y:0};
  const metrics={frames:[],layouts:[],queries:[],draws:0,animationFrames:0,firstPaint:null};
  window.audiencePerformance=metrics;
  const rateMoney=value=>Number.isFinite(value)?'$'+value.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:value!==0&&Math.abs(value)<.0001?8:4}):'Population unavailable';
  const amount = value => context()?.state.units==='capita'?rateMoney(window.AtlasPopulation.rate(value,window.AtlasPopulation.selection(context().state,context().manifest))):money(value);
  const dollarsValue = value => context()?.state.units==='capita'?window.AtlasPopulation.rate(value,window.AtlasPopulation.selection(context().state,context().manifest)):value;
  const isOpen = () => context()?.state.tab==='targeting'&&context()?.state.audienceView!=='map';
  const selectedID = () => context()?.state.audienceAccount?'a:'+context().state.audienceAccount:context()?.state.targetCriterion?'c:'+context().state.targetCriterion:null;
  const stateStamp = () => {const s=context()?.state;return s?JSON.stringify([s.date,s.period,s.place,s.area,s.party,s.units,s.targetFamily,s.targetMode,s.targetQuery,s.includeNonPolitical,s.audienceExtras,s.audiencePreset,s.audienceAccount,s.targetCriterion,s.platform,s.pageID,s.campaignRace,s.platformRace,s.platformAccount,s.platformAccounts,s.campaignPages,s.basis,s.nationwide,s.overallSources,s.targetMap,s.targetMapPages]):'';};
  let receivedStamp='';
  const sceneCache=new Map();
  const adaptFilters=()=>{$('audience-filter-panel').open=false;};
  adaptFilters();narrow.addEventListener('change',()=>{adaptFilters();sync();});

  function change(patch) {
    flowRemainder=null;
    window.AtlasTargeting.change(patch);
    sync();
  }

  function setView(kind) {
    const c=context();if(!c)return;
    const patch={audienceView:kind};
    if(kind==='flows'&&!c.state.targetCriterion&&report?.visual?.flow)patch.targetCriterion=report.visual.flow.id;
    if(kind==='map'){
      Object.assign(c.state,patch);window.AtlasApp.syncURL();sync();
      requestAnimationFrame(()=>{window.AtlasApp.getMap()?.resize();window.AtlasApp.getMap()?.triggerRepaint();});
      return;
    }
    Object.assign(c.state,patch);
    if(c.state.tab!=='targeting')window.AtlasApp.setTab('targeting');
    else window.AtlasTargeting.render({force:true});
    window.AtlasApp.syncURL();sync();
    if(report?.visual){layout(false);requestDraw();}
  }

  function sync() {
    const c=context();if(!c)return;
    window.AtlasSelection?.sync();
    const s=c.state,open=isOpen(),kind=open?s.audienceView:'map',wasOpen=lastOpen;
    lastOpen=open;
    document.body.dataset.audienceOpen=String(open);
    document.body.dataset.audienceFocus=String(!!s.audienceFocus);
    $('audience-expand').setAttribute('aria-pressed',String(!!s.audienceFocus));
    $('audience-expand').textContent=s.audienceFocus?(innerWidth<=800?'Standard graph ↙':'Restore reporting desk ↙'):'Expand graph ↗';
    $('audience-expand').setAttribute('aria-controls',innerWidth<=800?'audience-chart':'explore');
    $('audience-expand').title=s.audienceFocus?(innerWidth<=800?'Use the standard graph height':'Show the linked reporting desk'):(innerWidth<=800?'Use more height for the graph':'Use the full width for the graph');
    $('audience-details').hidden=!s.targetCriterion&&!s.audienceAccount&&!flowRemainder;
    $('audience-details').textContent=innerWidth<=800?'Inspect selection ↓':'Inspect selection ↗';
    document.body.dataset.audienceExtra=String(s.audienceExtras);
    document.body.dataset.audienceAccount=String(!!s.audienceAccount||!!flowRemainder);
    $('audience-stage').hidden=!open;
    document.querySelectorAll('[data-audience-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.audienceView===kind)));
    $('workspace-meta').textContent=kind==='map'?'Geography · all covered platforms':'Audience choices · Meta · '+(s.audienceExtras?'all affiliations':'Democratic + Republican');
    if(!open){cancelAnimationFrame(frame);frame=0;tween=null;hoverID=null;$('audience-tooltip').hidden=true;if(wasOpen)requestAnimationFrame(()=>{window.AtlasApp.getMap()?.resize();if(innerWidth<=800)window.AtlasApp.reframe();else window.AtlasApp.getMap()?.triggerRepaint();});return;}
    const headings=title[kind];
    document.querySelector('.audience-edition').textContent=headings[0];
    $('audience-title').textContent=headings[1];$('audience-subtitle').textContent=headings[2];
    canvas.setAttribute('aria-label',kind==='network'?'Advertisers connected to reported audience criteria':kind==='landscape'?'Audience criteria plotted by partisan budget share difference and spending':'Spending associated with one criterion, traced from parties through advertisers');
    $('audience-family').value=s.targetFamily;
    $('audience-filter-summary').textContent=$('audience-family').selectedOptions[0].textContent+' · '+(s.targetMode==='exclusions'?'Exclusion counts':s.targetScale==='share'?'Party share':s.units==='capita'?'Per resident':'Dollars')+' · '+(s.audienceExtras?'All affiliations':s.party==='all'?'D + R':partyNames[s.party]);
    if(document.activeElement!==$('audience-query'))$('audience-query').value=s.targetQuery;
    $('audience-extras').checked=s.audienceExtras;
    $('audience-extra-legend').hidden=!s.audienceExtras;
    document.querySelectorAll('[data-audience-party]').forEach(b=>{
      b.setAttribute('aria-pressed',String(s.party===b.dataset.audienceParty));
      const p=partyKeys.indexOf(b.dataset.audienceParty),budget=report?.denominators[p];
      b.innerHTML='<i class="party-dot '+b.dataset.audienceParty+'"></i>'+partyNames[b.dataset.audienceParty]+(Number.isFinite(budget)?' <b>'+money(budget)+'</b>':'');
      b.title=partyNames[b.dataset.audienceParty]+' covered Meta budget. Click to isolate this party.';
    });
    document.querySelectorAll('[data-audience-preset]').forEach(b=>b.setAttribute('aria-pressed',String(s.audiencePreset===b.dataset.audiencePreset)));
    document.querySelectorAll('[data-audience-period]').forEach(b=>b.setAttribute('aria-pressed',String(s.period===b.dataset.audiencePeriod)));
    document.querySelectorAll('[data-audience-scale]').forEach(b=>{
      const scale=kind==='flows'?'spend':s.targetScale;
      b.setAttribute('aria-pressed',String(b.dataset.audienceScale===(scale==='spend'&&s.units==='capita'?'capita':scale)));
      b.disabled=s.targetMode==='exclusions'||kind==='flows'&&b.dataset.audienceScale==='share';
      b.title=kind==='flows'&&b.dataset.audienceScale==='share'?'Ribbons use dollars to reconcile within one criterion. Party budget shares appear in the details.':'';
    });
    $('audience-graph-presets').hidden=kind!=='network';
    $('audience-flow-choice').hidden=kind!=='flows';
    $('audience-clear').textContent=s.audienceAccount?'Close advertiser inspection ×':s.targetCriterion?'Close criterion inspection ×':'Close inspection ×';
    $('audience-clear').hidden=!s.targetCriterion&&!s.audienceAccount&&!flowRemainder;
    if($('audience-place').options.length!==c.manifest.states.length+1){
      $('audience-place').innerHTML='<option value="US">United States</option>'+c.manifest.states.map(v=>'<option value="'+escape(v.abbr)+'">'+escape(v.name)+'</option>').join('');
    }
    $('audience-place').value=s.place;
    $('audience-scope-note').textContent=s.period+' days · '+short(s.date)+' snapshot'+(s.area?' · '+window.AtlasApp.areaInfo().title:'');
    const original=$('history-slider'),slider=$('audience-history-slider');
    slider.max=original.max;slider.value=original.value;
    $('audience-previous').disabled=Number(slider.value)<=0;
    $('audience-next').disabled=Number(slider.value)>=Number(slider.max);
    $('audience-date').textContent=short(s.date)+' snapshot';slider.setAttribute('aria-valuetext',s.date+' snapshot');
    if(!drawing){showStatus('The visual canvas is unavailable.','Explore every criterion and advertiser in the reporting desk.');return;}
    if(!['meta','overall'].includes(s.platform)||s.platform==='overall'&&!s.overallSources.includes('meta')){
      showStatus('Detailed audience criteria come from Meta.','Your selected platform has different disclosures. Its spending remains available on the map.','Enable Meta audience data',()=>{s.overallSources=[...new Set([...s.overallSources,'meta'])];window.AtlasPlatforms.setSource('overall',{tab:'targeting'});});
      return;
    }
    if(!c.data||c.data.snapshot!==s.date||String(c.data.window)!==s.period||!report||receivedStamp!==stateStamp()){
      showStatus(report?'Updating '+short(s.date)+' audience choices…':'Reading the audience choices…','Waiting for matching spending and targeting snapshots.');
      chart.setAttribute('aria-busy','true');
    }
  }

  function showStatus(heading,description,action,callback) {
    $('audience-status').hidden=false;
    $('audience-status').innerHTML='<strong>'+escape(heading)+'</strong><span>'+escape(description)+'</span>'+(action?'<button>'+escape(action)+' ↗</button>':'');
    if(action)$('audience-status').querySelector('button').onclick=callback;
    chart.setAttribute('aria-busy','false');
  }

  function receive(value) {
    if(!value.visual)return;
    const c=context();if(!c||value.snapshot!==c.state.date||String(value.window)!==c.state.period)return;
    report=value;receivedStamp=stateStamp();
    metrics.queries.push({date:value.snapshot,period:value.window,worker:value.elapsed,criteria:value.visual.criteriaTotal});if(metrics.queries.length>50)metrics.queries.shift();
    sync();chart.setAttribute('aria-busy','false');$('audience-status').hidden=true;
    if(!value.visual.criteriaTotal){
      showStatus('No audience choices match this view.','Try another audience type, broaden the search or place, or include Other & unclassified.');
      scene=null;requestDraw();renderDesk();return;
    }
    renderFindings();renderFlowChoices();renderDesk();layout(true);requestDraw();
  }

  function renderFindings() {
    const v=report.visual,f=v.findings,buttons=[];
    if(f.distinctive&&f.distinctive.gap!==null){const r=f.distinctive;buttons.push('<button data-audience-criterion="'+r.id+'"><span>LARGEST PARTY DIFFERENCE</span><strong>'+escape(r.label)+'</strong><small>'+Math.abs(r.gap).toLocaleString('en-US',{maximumFractionDigits:1})+' pp more of '+(r.gap>0?'Democratic':'Republican')+' budget ↗</small></button>');}
    if(f.shared){const r=f.shared;buttons.push('<button data-audience-criterion="'+r.id+'"><span>SHARED BY BOTH PARTIES</span><strong>'+escape(r.label)+'</strong><small>'+number.format(r.counts[0]+r.counts[1])+' aligned advertisers report it ↗</small></button>');}
    if(v.connector){const a=v.connector;buttons.push('<button data-audience-account="'+escape(a.page)+'"><span>MOST AUDIENCE CONNECTIONS</span><strong>'+escape(a.name)+'</strong><small>'+number.format(a.criterionCount)+' reported criteria in this scope ↗</small></button>');}
    $('audience-findings').innerHTML=buttons.join('');
  }

  function renderFlowChoices() {
    const v=report.visual,selected=context().state.targetCriterion||v.flow?.id;
    const choices=v.landscape.slice(0,60),special=v.landscape.find(r=>r.id===selected);
    if(special&&!choices.includes(special))choices.unshift(special);
    $('audience-flow-select').innerHTML=(selected&&!special?'<option value="'+escape(selected)+'" disabled>Selected criterion not observed in this view</option>':'')+choices.map(r=>'<option value="'+r.id+'">'+escape(r.label)+'</option>').join('');
    $('audience-flow-select').value=selected||'';
  }

  function renderDesk() {
    const c=context(),a=report?.visual?.focusAccount,box=$('audience-account-inspector');
    const focused=c?.state.audienceAccount&&a;
    box.hidden=!focused&&!flowRemainder;
    document.body.dataset.audienceAccount=String(!!focused||!!flowRemainder);
    if(flowRemainder){
      const group=flowRemainder;
      box.innerHTML='<span class="section-label">REMAINING ADVERTISERS · '+escape(partyNames[group.party]).toUpperCase()+'</span><h3>'+number.format(group.count)+' more accounts.</h3><p>'+(report.visual.excluded?number.format(group.flowValue)+' accounts reporting exclusion':amount(group.flowValue)+' associated with '+escape(report.visual.flow.label))+'. These accounts are grouped in the flow to keep the ribbons readable.</p><ul class="audience-account-criteria">'+group.members.map(v=>'<li><button data-audience-open-account="'+escape(v.id)+'"><span>'+escape(v.name)+'</span><strong>'+(report.visual.excluded?'Exclusion reported':amount(v.value))+'</strong></button></li>').join('')+'</ul><button class="audience-account-link" data-audience-criterion="'+report.visual.flow.id+'">Open the criterion’s full advertiser list ↗</button>';
      return;
    }
    if(!focused){box.innerHTML='';return;}
    const linked=window.AtlasConnections?.labelFor(a.page),fields=window.AtlasConnections?.connectionFields(a.page),race=fields?.[1]?.split('; ')[0];
    box.innerHTML='<span class="section-label"><i class="party-dot '+a.party+'"></i> '+escape(partyNames[a.party])+' ADVERTISER</span><h3>'+escape(a.name)+'</h3>'+window.AtlasIdentities.badge(a.page)+'<div class="audience-account-figures"><div><strong>'+amount(a.budget)+'</strong><span>'+ (report.local?'Modelled allocation to this place':'Reported Meta account budget')+'</span></div><div><strong>'+number.format(a.criterionTotal)+'</strong><span>Reported '+(report.visual.excluded?'exclusions':'criteria')+' in this audience type</span></div></div>'+(linked?'<button class="audience-account-link" data-audience-race="'+escape(race)+'">'+escape(linked)+' ↗</button>':'')+'<p>Its links show reported use of a criterion. They do not establish that different advertisers reached the same people.</p><ul class="audience-account-criteria">'+a.criteria.map(r=>'<li><button data-audience-criterion="'+r.id+'"><span>'+escape(r.label)+'</span><strong>'+(report.visual.excluded?'Exclusion':Number.isFinite(r.value)?amount(r.value):'Share unavailable')+'</strong></button></li>').join('')+'</ul><button class="audience-account-link" data-audience-open-account="'+escape(a.page)+'">Open advertiser and geographic footprint ↗</button>';
  }

  function metric(row) {
    if(report.visual.excluded)return row.count||0;
    if(context().state.targetScale==='share')return Math.max(0,...row.shares.filter(Number.isFinite));
    return Math.max(0,row.total||0);
  }

  function networkScene() {
    const data=report.visual.network,s=context().state;
    const maxCriterion=Math.max(1e-12,...data.nodes.filter(n=>n.type==='criterion').map(metric));
    const accountMetric=n=>s.targetScale==='share'?n.budget/(report.denominators[partyKeys.indexOf(n.party)]||1):n.budget;
    const maxAccount=Math.max(1e-12,...data.nodes.filter(n=>n.type==='account').map(accountMetric));
    const nodes=data.nodes.map(n=>({...n,x:26+n.x*(width-52),y:27+n.y*(height-65),r:n.type==='criterion'?5+17*Math.sqrt(metric(n)/maxCriterion):3.3+8.5*Math.sqrt(accountMetric(n)/maxAccount)}));
    const byID=new Map(nodes.map(n=>[n.id,n]));
    const edges=data.edges.map(e=>({...e,a:byID.get(e.source),b:byID.get(e.target)}));
    const maxEdge=Math.max(1,...edges.map(e=>report.visual.excluded?1:e.value||0));
    return {kind:'network',nodes,edges,byID,maxEdge};
  }

  function landscapeScene() {
    const s=context().state,rows=report.visual.landscape;
    const left=width<500?43:65,right=width-27,top=30,bottom=height-50;
    const comparison=r=>r.excluded?r.usageGap:r.gap;
    const largestGap=Math.max(.25,...rows.map(r=>Math.abs(comparison(r)||0)));
    const gapMax=largestGap<=1?Math.ceil(largestGap*4)/4:Math.ceil(largestGap);
    const raw=r=>report.visual.excluded?r.count:s.targetScale==='share'?Math.max(0,...r.shares.filter(Number.isFinite)):Math.max(0,dollarsValue(r.total)||0);
    const maxY=Math.max(1e-12,...rows.map(raw)),floor=maxY/1500;
    const logTop=Math.log1p(maxY/floor),toY=value=>bottom-Math.log1p(value/floor)/logTop*(bottom-top);
    const maxCount=Math.max(1,...rows.map(r=>r.count));
    const nodes=rows.map(r=>({...r,gap:comparison(r),id:'c:'+r.id,criterion:r.id,type:'criterion',x:left+(.5-(comparison(r)||0)/(2*gapMax))*(right-left),y:toY(raw(r)),r:1.8+11*Math.sqrt(r.count/maxCount)}));
    const ticks=[];
    if(report.visual.excluded){for(const v of [1,2,5,10,20,50,100,200,500,1000,2000,5000])if(v<=maxY*1.1)ticks.push(v);}
    else if(s.targetScale==='share'){for(const v of [.00001,.0001,.001,.005,.01,.02,.05,.1,.2,.5,1])if(v<=maxY*1.1)ticks.push(v);}
    else{
      const start=Math.floor(Math.log10(Math.max(maxY/1200,1e-7))),end=Math.ceil(Math.log10(maxY));
      for(let p=start;p<=end;p++)if(10**p<=maxY*1.1)ticks.push(10**p);
    }
    const paths=new Map();
    for(const n of [...nodes].sort((a,b)=>b.r-a.r)){
      const key=n.gap>0?'dem':n.gap<0?'rep':'shared';
      if(!paths.has(key))paths.set(key,new Path2D());
      const path=paths.get(key);path.moveTo(n.x+n.r,n.y);path.arc(n.x,n.y,n.r,0,Math.PI*2);path.closePath();
    }
    return {kind:'landscape',nodes,edges:[],paths,byID:new Map(nodes.map(n=>[n.id,n])),axes:{left,right,top,bottom,gapMax,maxY,toY,ticks}};
  }

  function ribbon(x0,y0,x1,y1,band) {
    const p=new Path2D(),mid=(x0+x1)/2;
    p.moveTo(x0,y0-band/2);p.bezierCurveTo(mid,y0-band/2,mid,y1-band/2,x1,y1-band/2);
    p.lineTo(x1,y1+band/2);p.bezierCurveTo(mid,y1+band/2,mid,y0+band/2,x0,y0+band/2);p.closePath();return p;
  }

  function flowScene() {
    const flow=report.visual.flow;
    if(!flow)return {kind:'flows',nodes:[],edges:[],byID:new Map()};
    const accounts=flow.accounts,totals=partyKeys.map(p=>accounts.filter(a=>a.party===p).reduce((n,a)=>n+a.flowValue,0)),sum=totals.reduce((n,v)=>n+v,0);
    const groups=totals.filter(v=>v>0).length,gap=width<500?5:7;
    const scale=Math.max(50,height-88-gap*Math.max(0,accounts.length-1)-10*Math.max(0,groups-1))/(sum||1);
    const xParty=width<500?19:47,xAccount=width*.46,xCriterion=width-38;
    let cursor=37,lastParty;
    const nodes=[],edges=[],partyNodes=[];
    for(const a of accounts){
      if(lastParty!==undefined&&lastParty!==a.party)cursor+=10;
      const h=a.flowValue*scale,n={...a,type:a.group?'group':'account',x:xAccount,y:cursor+h/2,r:8,box:{x:xAccount-3,y:cursor,w:6,h},height:h};
      nodes.push(n);cursor+=h+gap;lastParty=a.party;
    }
    for(let p=0;p<4;p++)if(totals[p]>0){
      const members=nodes.filter(n=>n.party===partyKeys[p]),first=members[0].box.y,last=members.at(-1).box.y+members.at(-1).box.h,h=totals[p]*scale;
      const n={id:'party:'+partyKeys[p],type:'party',party:partyKeys[p],name:partyNames[partyKeys[p]],flowValue:totals[p],budget:report.denominators[p],x:xParty,y:(first+last)/2,r:12,box:{x:xParty-4,y:(first+last-h)/2,w:8,h}};
      partyNodes.push(n);
      let offset=0;
      for(const member of members){const band=member.flowValue*scale;edges.push({source:n.id,target:member.id,party:n.party,value:member.flowValue,page:member.page,criterion:flow.id,path:ribbon(xParty+4,n.box.y+offset+band/2,xAccount-3,member.y,band)});offset+=band;}
    }
    const c={...flow,id:'c:'+flow.id,criterion:flow.id,type:'criterion',name:flow.label,x:xCriterion,y:height/2,r:14,box:{x:xCriterion-7,y:(height-sum*scale)/2,w:14,h:sum*scale}};
    let offset=0;
    for(const n of nodes){const band=n.flowValue*scale;edges.push({source:n.id,target:c.id,party:n.party,value:n.flowValue,page:n.page,criterion:flow.id,path:ribbon(xAccount+3,n.y,xCriterion-7,c.box.y+offset+band/2,band)});offset+=band;}
    nodes.push(...partyNodes,c);
    return {kind:'flows',nodes,edges,byID:new Map(nodes.map(n=>[n.id,n])),sum,totals,criterion:c,scale};
  }

  function layout(animate) {
    if(!drawing||!report?.visual||!isOpen()||!width||!height||receivedStamp!==stateStamp())return;
    const start=performance.now(),kind=context().state.audienceView;
    const old=scene,previous=new Map(old?.nodes.map(n=>[n.id,{x:n.x,y:n.y,r:n.r}])||[]);
    const s=context().state;
    const cacheKey=JSON.stringify([width,height,s.date,s.period,s.place,s.area,s.party,s.units,s.targetScale,s.targetFamily,s.targetMode,s.targetQuery,s.includeNonPolitical,s.audienceExtras,s.platform,s.pageID,s.campaignRace,s.platformRace,s.platformAccount,s.platformAccounts,s.campaignPages,s.basis,s.nationwide,s.targetMap,s.targetMapPages,report.denominators,kind==='network'?[s.audiencePreset,s.audienceAccount,s.targetCriterion]:kind==='flows'?s.targetCriterion:null]);
    const cached=sceneCache.get(kind);
    const fresh=cached?.key===cacheKey?cached.scene:kind==='network'?networkScene():kind==='landscape'?landscapeScene():flowScene();
    if(cached?.key!==cacheKey)sceneCache.set(kind,{key:cacheKey,scene:fresh});
    scene=fresh;
    const kindChanged=lastKind!==kind;
    if(kindChanged){camera.k=1;camera.x=0;camera.y=0;hoverID=null;keyboardID=null;}
    const geometryKey=kind+':'+width+':'+height;
    const canAnimate=animate&&fresh!==old&&kind==='network'&&fresh.nodes.length<150&&old&&old.kind===kind&&!reduced.matches&&geometryKey===lastGeometryKey;
    tween=canAnimate?{start:performance.now(),duration:550,from:previous,to:new Map(fresh.nodes.map(n=>[n.id,{x:n.x,y:n.y,r:n.r}]))}:null;
    lastKind=kind;lastVisual=report.visual;lastGeometryKey=geometryKey;
    metrics.layouts.push({kind,ms:performance.now()-start,nodes:fresh.nodes.length,edges:fresh.edges.length,cached:cached?.key===cacheKey});if(metrics.layouts.length>50)metrics.layouts.shift();
    updateCaption();
  }

  function updateCaption() {
    if(!scene)return;
    const v=report.visual,s=context().state;
    if(scene.kind==='network'){
      $('audience-encoding').textContent='Filled circles: advertiser budgets. Rings: criteria; colours compare '+(v.excluded?'reported account counts':'party budget shares')+'. Lines: reported use. '+(v.excluded?'Criterion size: reporting account count.':s.targetScale==='share'?'Criterion size: largest party budget share.':'Criterion size: associated spending.')+' Distance is layout only.';
      $('audience-shown').textContent=scene.nodes.filter(n=>n.type==='criterion').length+' / '+number.format(v.criteriaTotal)+' criteria · '+scene.nodes.filter(n=>n.type==='account').length+' / '+number.format(v.advertisersTotal)+' advertisers shown';
    }else if(scene.kind==='landscape'){
      $('audience-encoding').textContent=v.excluded?'Left/right: difference in exclusion reporting rate among eligible party accounts, in percentage points. Height and area: account counts. No positive spending is attributed.':'Left/right: difference in party budget share. Height: '+(s.targetScale==='share'?'largest party budget share':s.units==='capita'?'associated USD per resident':'associated USD')+'. Area: advertiser count. Height uses a logarithmic scale, expanded near zero.';
      if(!report.denominators[0]||!report.denominators[1])$('audience-encoding').textContent+=' Both party budgets are needed for a partisan comparison.';
      $('audience-shown').textContent=number.format(scene.nodes.length)+' / '+number.format(v.criteriaTotal)+' criteria · '+number.format(v.advertisersTotal)+' advertisers in scope';
    }else{
      $('audience-encoding').textContent=v.excluded?'Ribbon width is advertiser count. Exclusions have no positive spending attribution.':'Ribbon width = '+(s.units==='capita'?'associated USD per resident':'associated USD')+' for this single criterion. Ribbons reconcile here; criteria overlap across selections.';
      $('audience-shown').textContent=(v.flow?.label||'')+' · '+(v.excluded?number.format(v.flow?.count||0)+' accounts':amount(scene.sum))+(v.flow?.unpriced?' · '+v.flow.unpriced+' without positive disclosed share':'');
      if(!v.flow)showStatus('This criterion has no observations in this view.','Select another criterion or change the date. Your selected criterion is preserved.');
      else if(!(scene.sum>0))showStatus('No positive spending share is available.','Use Network to inspect the advertisers reporting this criterion.');
    }
  }

  function resize() {
    const r=chart.getBoundingClientRect();if(r.width<1||r.height<1)return;
    const w=Math.round(r.width),h=Math.round(r.height),nextDpr=Math.min(devicePixelRatio||1,2,Math.max(1,Math.sqrt(2400000/(w*h))));
    if(w===width&&h===height&&nextDpr===dpr)return;
    width=w;height=h;dpr=nextDpr;canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
    tween=null;layout(false);requestDraw();
  }

  function requestDraw() {
    if(frame||!visible||document.hidden||!isOpen()||!drawing)return;
    frame=requestAnimationFrame(draw);
  }

  function focusIDs() {
    const id=hoverID||keyboardID||selectedID(),ids=new Set();
    if(!id||!scene?.byID.has(id))return ids;
    if(scene.kind==='flows'&&id===scene.criterion?.id)return new Set(scene.nodes.map(n=>n.id));
    ids.add(id);
    for(const e of scene.edges)if(e.source===id||e.target===id){ids.add(e.source);ids.add(e.target);}
    if(scene.kind==='flows'&&scene.byID.get(id)?.type==='party')for(const n of scene.nodes)if(n.party===scene.byID.get(id).party)ids.add(n.id);
    return ids;
  }

  function inkText(text,x,y,size=10,color='#63758e',align='left',weight=500) {
    drawing.font=weight+' '+size+'px Manrope, sans-serif';drawing.fillStyle=color;drawing.textAlign=align;drawing.textBaseline='middle';drawing.fillText(text,x,y);
  }

  function drawAxes() {
    if(scene.kind==='network'){
      const compact=width<600;
      inkText(compact?'DEMOCRATIC':'DEMOCRATIC ADVERTISERS',width*.1,9,compact?7:8,'#3866ad','center',600);
      inkText(compact?'CRITERIA':'REPORTED AUDIENCE CHOICES',width*.5,9,compact?7:8,'#6a7b92','center',600);
      inkText(compact?'REPUBLICAN':'REPUBLICAN ADVERTISERS',width*.9,9,compact?7:8,'#b34c46','center',600);
      return;
    }
    if(scene.kind==='flows'){
      inkText('PARTY',width<500?19:47,11,8,'#62768f','left',650);
      inkText('ADVERTISERS',width*.46,11,8,'#62768f','center',650);
      inkText('ONE CRITERION',width-38,11,8,'#62768f','right',650);
      return;
    }
    const a=scene.axes,s=context().state;
    drawing.strokeStyle='#d8e1ed';drawing.lineWidth=.7;
    for(const tick of a.ticks){const y=a.toY(tick);if(y<a.top-1||y>a.bottom)continue;drawing.beginPath();drawing.moveTo(a.left,y);drawing.lineTo(a.right,y);drawing.stroke();
      const label=report.visual.excluded?number.format(tick):s.targetScale==='share'?percent(tick):s.units==='capita'?rateMoney(tick):money(tick);
      inkText(label,a.left-8,y,8,'#718198','right');
    }
    drawing.strokeStyle='#a1b3cc';drawing.setLineDash([3,4]);drawing.beginPath();drawing.moveTo((a.left+a.right)/2,a.top-5);drawing.lineTo((a.left+a.right)/2,a.bottom);drawing.stroke();drawing.setLineDash([]);
    drawing.strokeStyle='#c9d6e6';drawing.beginPath();drawing.moveTo(a.left,a.bottom);drawing.lineTo(a.right,a.bottom);drawing.stroke();
    const xCenter=(a.left+a.right)/2;
    inkText(report.visual.excluded?'MORE DEMOCRATIC ACCOUNTS':'MORE OF DEMOCRATIC BUDGET',a.left,a.bottom+17,width<500?6:8,'#2054b3','left',650);
    inkText(report.visual.excluded?'MORE REPUBLICAN ACCOUNTS':'MORE OF REPUBLICAN BUDGET',a.right,a.bottom+17,width<500?6:8,'#b5342e','right',650);
    inkText('0 pp',xCenter,a.bottom+17,8,'#718198','center');
    inkText(a.gapMax+' pp',a.left,a.bottom+31,8,'#62748e','left');inkText(a.gapMax+' pp',a.right,a.bottom+31,8,'#62748e','right');
    const label=report.visual.excluded?'REPORTED ACCOUNT COUNT':s.targetScale==='share'?'LARGEST PARTY BUDGET SHARE':s.units==='capita'?'ASSOCIATED USD / RESIDENT':'ASSOCIATED SPENDING · USD';
    inkText(label,a.left,12,7,'#60718a','left',650);
  }

  function drawNetworkEdges(ids) {
    drawing.lineCap='round';
    for(const edge of scene.edges){
      const highlighted=ids.size&&(ids.has(edge.source)&&ids.has(edge.target));
      drawing.globalAlpha=ids.size?highlighted?.66:.045:.09+Math.sqrt((edge.value||0)/scene.maxEdge)*.08;
      drawing.strokeStyle=colors[edge.party];drawing.lineWidth=highlighted?1.3+2.1*Math.sqrt((edge.value||0)/scene.maxEdge):.35+.8*Math.sqrt((edge.value||0)/scene.maxEdge);
      if(edge.value===null&&!report.visual.excluded)drawing.setLineDash([2,3]);
      const a=edge.a,b=edge.b,mid=(a.x+b.x)/2;
      drawing.beginPath();drawing.moveTo(a.x,a.y);drawing.bezierCurveTo(mid,a.y,mid,b.y,b.x,b.y);drawing.stroke();drawing.setLineDash([]);
    }
    drawing.globalAlpha=1;
  }

  function nodePaint(n,ids) {
    const focus=ids.has(n.id),muted=ids.size&&!focus;
    drawing.globalAlpha=muted?.12:1;
    if(n.type==='account'){
      drawing.beginPath();drawing.arc(n.x,n.y,n.r,0,Math.PI*2);drawing.fillStyle=colors[n.party];drawing.fill();drawing.strokeStyle='#f7f8fa';drawing.lineWidth=1.2;drawing.stroke();
    }else{
      const parts=report.visual.excluded?n.counts:n.shares.map(v=>v||0),sum=parts.reduce((a,b)=>a+b,0);
      drawing.beginPath();drawing.arc(n.x,n.y,n.r,0,Math.PI*2);
      drawing.fillStyle=scene.kind==='landscape'?(n.gap>0?'#2054b34a':n.gap<0?'#c840374a':'#7a8da73a'):'#fbfcfe';drawing.fill();
      if(scene.kind==='landscape'){
        drawing.strokeStyle=n.gap>0?'#2054b3':n.gap<0?'#c84037':'#8293aa';drawing.lineWidth=focus?1.8:.8;drawing.stroke();
      }else{
        let angle=-Math.PI/2;
        for(let p=0;p<4;p++)if(parts[p]>0){const end=angle+parts[p]/sum*Math.PI*2;drawing.beginPath();drawing.arc(n.x,n.y,n.r,angle,end);drawing.lineWidth=n.r>15?2.8:2;drawing.strokeStyle=colors[partyKeys[p]];drawing.stroke();angle=end;}
        if(!sum){drawing.strokeStyle='#9aa9bc';drawing.lineWidth=1.2;drawing.stroke();}
      }
    }
    if(n.id===selectedID()||n.id===hoverID||n.id===keyboardID){drawing.beginPath();drawing.arc(n.x,n.y,n.r+4,0,Math.PI*2);drawing.strokeStyle='#17243d';drawing.lineWidth=1.4;drawing.stroke();}
    drawing.globalAlpha=1;
  }

  function clipText(text,max) {
    if(drawing.measureText(text).width<=max)return text;
    let value=text;while(value.length>4&&drawing.measureText(value+'…').width>max)value=value.slice(0,-1);return value+'…';
  }

  function drawLabels(ids) {
    const active=hoverID||keyboardID||selectedID();
    let candidates=scene.nodes.filter(n=>!ids.size||ids.has(n.id)).sort((a,b)=>Number(b.id===active)-Number(a.id===active)||Number(b.type==='criterion')-Number(a.type==='criterion')||(b.total||b.budget||0)-(a.total||a.budget||0));
    if(scene.kind==='network'&&!ids.size){
      const accounts=candidates.filter(n=>n.type==='account').sort((a,b)=>b.budget-a.budget),criteria=candidates.filter(n=>n.type==='criterion');
      candidates=[...accounts.slice(0,width<500?3:7),...criteria,...accounts.slice(width<500?3:7)];
    }
    const occupied=[],cap=width<500?9:ids.size?22:19;
    let count=0;
    for(const n of candidates){
      if(count>=cap)break;
      const selected=n.id===active,size=selected?11:scene.kind==='landscape'?9:10;
      drawing.font=(selected?700:600)+' '+size+'px Manrope, sans-serif';
      const text=clipText(n.label||n.name,Math.min(width<500?125:185,width*.28)),w=drawing.measureText(text).width+8,h=17;
      const spots=[[n.x+n.r+6,n.y-h/2],[n.x-n.r-6-w,n.y-h/2],[n.x-w/2,n.y-n.r-h-4],[n.x-w/2,n.y+n.r+4]];
      let found=spots.find(([x,y])=>x>=3&&x+w<width-3&&y>=22&&y+h<height-13&&!occupied.some(b=>x<b.x+b.w+3&&x+w+3>b.x&&y<b.y+b.h+2&&y+h+2>b.y));
      if(!found&&selected)found=[Math.min(width-w-3,Math.max(3,n.x-w/2)),Math.min(height-h-6,Math.max(22,n.y-n.r-h-4))];
      if(!found)continue;
      const [x,y]=found;occupied.push({x,y,w,h});
      drawing.fillStyle=selected?'#fdfdfe':'#f7f8faf0';drawing.fillRect(x,y,w,h);
      inkText(text,x+4,y+h/2,size,selected?'#17243d':n.type==='account'?colors[n.party]:'#405778','left',selected?700:600);count++;
    }
  }

  function drawFlows(ids) {
    for(const edge of scene.edges){
      const active=!ids.size||ids.has(edge.source)&&ids.has(edge.target);
      drawing.globalAlpha=active?ids.size?.63:.29:.055;drawing.fillStyle=colors[edge.party];drawing.fill(edge.path);
    }
    drawing.globalAlpha=1;
    const occupied=[];
    for(const n of scene.nodes){
      const dim=ids.size&&!ids.has(n.id);drawing.globalAlpha=dim?.16:1;
      const box=n.box;drawing.fillStyle=n.type==='criterion'?'#213b60':colors[n.party];drawing.fillRect(box.x,box.y,box.w,Math.max(1,box.h));
      if(n.id===selectedID()||n.id===hoverID||n.id===keyboardID){drawing.strokeStyle='#17243d';drawing.lineWidth=1.3;drawing.strokeRect(box.x-3,box.y-3,box.w+6,Math.max(1,box.h)+6);}
      if(n.type==='party'){
        inkText(n.name,n.x+14,n.box.y+8,width<500?9:12,colors[n.party],'left',700);
        inkText(report.visual.excluded?number.format(n.flowValue)+' accounts':amount(n.flowValue),n.x+14,n.box.y+25,width<500?8:10,'#506681','left',600);
      }else if(n.type==='criterion'){
        const text=report.visual.excluded?number.format(scene.sum)+' accounts':amount(scene.sum);
        inkText(text,n.x-16,Math.max(29,n.box.y-17),width<500?13:20,'#203856','right',750);
      }else if(!dim){
        drawing.font='600 '+(width<500?8:10)+'px Manrope, sans-serif';
        const text=clipText(n.name,Math.max(45,width*.28)),y=n.y-9;
        if(n.id===hoverID||n.id===keyboardID||!occupied.some(v=>Math.abs(v-y)<16)){
          const w=drawing.measureText(text).width+7;occupied.push(y);drawing.fillStyle='#f7f8faf0';drawing.fillRect(n.x+8,y-8,w,16);
          inkText(text,n.x+11,y,width<500?8:10,colors[n.party],'left',600);
        }
      }
      drawing.globalAlpha=1;
    }
  }

  function drawLandscape(ids) {
    for(const [key,path]of scene.paths){
      drawing.globalAlpha=ids.size?.16:1;
      drawing.fillStyle=key==='dem'?'#2054b33b':key==='rep'?'#c840373b':'#8293aa3b';
      drawing.strokeStyle=key==='dem'?'#2054b3':key==='rep'?'#c84037':'#8293aa';drawing.lineWidth=.65;
      drawing.fill(path);drawing.stroke(path);
    }
    drawing.globalAlpha=1;
    if(ids.size)for(const id of ids){const n=scene.byID.get(id);if(n)nodePaint(n,ids);}
  }

  function draw(now) {
    frame=0;
    if(!drawing||!isOpen()||!visible||document.hidden)return;
    const began=performance.now();drawing.setTransform(dpr,0,0,dpr,0,0);drawing.fillStyle='#f7f8fa';drawing.fillRect(0,0,width,height);
    if(!scene)return;
    if(tween){
      const progress=Math.min(1,(now-tween.start)/tween.duration),ease=1-(1-progress)**4;
      for(const n of scene.nodes){const from=tween.from.get(n.id),to=tween.to.get(n.id);if(from){n.x=from.x+(to.x-from.x)*ease;n.y=from.y+(to.y-from.y)*ease;n.r=from.r+(to.r-from.r)*ease;}}
      if(progress===1||reduced.matches){for(const n of scene.nodes)Object.assign(n,tween.to.get(n.id));tween=null;}else metrics.animationFrames++;
    }
    drawing.save();drawing.translate(camera.x,camera.y);drawing.scale(camera.k,camera.k);
    drawAxes();const ids=focusIDs();
    if(scene.kind==='network')drawNetworkEdges(ids);
    if(scene.kind==='flows')drawFlows(ids);
    else{
      if(scene.kind==='landscape')drawLandscape(ids);else for(const n of scene.nodes)nodePaint(n,ids);
      drawLabels(ids);
    }
    drawing.restore();
    const elapsed=performance.now()-began;metrics.frames.push(elapsed);if(metrics.frames.length>120)metrics.frames.shift();metrics.draws++;metrics.firstPaint??=performance.now();
    // A slow device gets a static result instead of a costly continuing tween.
    if(tween&&elapsed>22){for(const n of scene.nodes)Object.assign(n,tween.to.get(n.id));tween=null;requestDraw();}
    if(tween)requestDraw();
  }

  function position(event) {const r=canvas.getBoundingClientRect();return {x:event.clientX-r.left,y:event.clientY-r.top};}
  function world(point) {return {x:(point.x-camera.x)/camera.k,y:(point.y-camera.y)/camera.k};}
  function hit(point) {
    if(!scene)return null;
    const p=world(point);let best=null,distance=Infinity;
    for(const n of scene.nodes){
      const d=(n.x-p.x)**2+(n.y-p.y)**2;
      if(n.box&&p.x>=n.box.x-8&&p.x<=n.box.x+n.box.w+8&&p.y>=n.box.y-5&&p.y<=n.box.y+n.box.h+5)return n;
      if(!n.box&&d<((n.r||5)+5/camera.k)**2&&d<distance){best=n;distance=d;}
    }
    if(!best&&scene.kind==='flows')for(const edge of scene.edges)if(hitDrawing.isPointInPath(edge.path,p.x,p.y))return scene.byID.get(edge.source.startsWith('party:')?edge.target:edge.source);
    return best;
  }

  function tooltip(node,point) {
    const box=$('audience-tooltip');if(!node){box.hidden=true;return;}
    let content='<strong>'+escape(node.label||node.name)+'</strong>';
    if(node.type==='criterion'){
      const shares=node.excluded?node.usageShares:node.shares,gap=node.excluded?node.usageGap:node.gap;
      content+='<div class="audience-tooltip-pair"><span class="dem">Dem '+percent(shares[0])+'</span><span class="rep">Rep '+percent(shares[1])+'</span></div><small>'+(node.excluded?'Reported exclusion · ':amount(node.total)+' associated · ')+number.format(node.count)+' advertisers</small><small>'+(Number.isFinite(gap)?Math.abs(gap).toLocaleString('en-US',{maximumFractionDigits:2})+' pp '+(node.excluded?'higher account reporting rate for ':'more of ')+(gap>=0?'Democratic':'Republican')+(node.excluded?' advertisers':' budget'):'Party comparison unavailable')+'</small>';
    }else if(node.type==='party')content+='<small>'+(report.visual.excluded?number.format(node.flowValue)+' advertisers':amount(node.flowValue)+' associated with this criterion')+'</small><small>'+money(node.budget)+' covered party budget</small>';
    else if(node.type==='group')content+='<small>'+(report.visual.excluded?number.format(node.flowValue)+' accounts reporting exclusion':amount(node.flowValue)+' associated with this criterion')+'</small><small>Click to inspect the remaining accounts.</small>';
    else{
      const linked=window.AtlasConnections?.labelFor(node.page);
      content+=window.AtlasIdentities.badge(node.page,true)+'<small>'+escape(partyNames[node.party])+' · '+amount(node.budget)+(report.local?' modelled place allocation':' reported account budget')+'</small>'+(node.flowValue?'<small>'+(report.visual.excluded?'Reported exclusion; no spending attribution':amount(node.flowValue)+' associated with this criterion')+'</small>':'')+(node.criterionCount?'<small>'+number.format(node.criterionCount)+' criteria in this scope</small>':'')+(linked?'<small>'+escape(linked)+'</small>':'');
    }
    box.innerHTML=content+'<small>Click to inspect ↗</small>';box.hidden=false;
    const w=box.offsetWidth,h=box.offsetHeight;
    box.style.left=Math.max(4,Math.min(width-w-4,point.x+15))+'px';box.style.top=Math.max(18,Math.min(height-h-4,point.y+16))+'px';
  }

  function select(node) {
    if(!node||chart.getAttribute('aria-busy')==='true'||receivedStamp!==stateStamp())return;
    hoverID=null;keyboardID=null;$('audience-tooltip').hidden=true;
    if(node.type==='criterion'){change({targetCriterion:node.criterion,audienceAccount:null});}
    else if(node.type==='account'){change({audienceAccount:node.page,...(scene?.kind==='flows'?{}:{targetCriterion:null})});}
    else if(node.type==='group'){flowRemainder=node;renderDesk();sync();}
    else if(node.type==='party'){change({party:context().state.party===node.party?'all':node.party,audienceAccount:null});window.AtlasApp.refresh();}
    if(innerWidth>800)enter();
    requestDraw();
  }

  function clear() {hoverID=null;keyboardID=null;flowRemainder=null;change({targetCriterion:null,audienceAccount:null});}
  function zoom(value,point={x:width/2,y:height/2}) {
    const next=Math.max(.65,Math.min(5,value)),ratio=next/camera.k;
    camera.x=point.x-(point.x-camera.x)*ratio;camera.y=point.y-(point.y-camera.y)*ratio;camera.k=next;requestDraw();
  }
  function fit() {camera.k=1;camera.x=0;camera.y=0;tween=null;layout(false);requestDraw();}

  async function saveImage() {
    if(!scene||chart.getAttribute('aria-busy')==='true'||receivedStamp!==stateStamp())return;
    const output=document.createElement('canvas'),scale=Math.min(2,dpr),footer=88;
    output.width=Math.round(width*scale);output.height=Math.round((height+footer)*scale);
    const g=output.getContext('2d');g.scale(scale,scale);g.fillStyle='#f7f8fa';g.fillRect(0,0,width,height+footer);
    const kind=scene.kind,s={...context().state};
    g.drawImage(canvas,0,0,width,height);g.fillStyle='#17243d';g.font='700 '+(width<500?14:18)+'px Manrope, sans-serif';g.fillText('midterms. / '+(width<500?kind:title[kind][1]),15,height+28);
    g.fillStyle='#60738c';g.font='9px Manrope, sans-serif';
    g.fillText(window.AtlasApp.areaInfo().title+' · '+s.period+' days · '+s.date+' · reported Meta targeting · '+(s.audienceExtras?'all affiliations':'Democratic + Republican'),15,height+47);
    g.fillText(report.visual.excluded?'Reported exclusion usage. No positive spending attribution. Source: metatargetr / WhoTargets.Me.':'Associated USD = account budget × reported share. Criteria overlap; do not sum them. Source: metatargetr / WhoTargets.Me.',15,height+65);
    const blob=await new Promise(resolve=>output.toBlob(resolve,'image/png'));if(!blob)return;
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='midterms-'+kind+'-'+s.date+'.png';link.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
  }

  function enter({reveal=false}={}) {
    const s=context()?.state;if(s?.audienceFocus&&!reveal)return;
    if(reveal&&s){s.audienceFocus=false;sync();window.AtlasApp.syncURL();}
    if(reveal&&innerWidth<=800){$('targeting-explorer').scrollIntoView({block:'start',behavior:reduced.matches?'instant':'smooth'});return;}
    if(innerWidth>800){const panel=$('targeting-explorer'),explorer=$('explore');explorer.scrollTo({top:explorer.scrollTop+panel.getBoundingClientRect().top-explorer.getBoundingClientRect().top,behavior:reduced.matches?'instant':'smooth'});}
    else if(!report)$('audience-stage').scrollIntoView({block:'start'});
  }

  function delegated(event) {
    const button=event.target.closest('button');if(!button)return;
    if(button.dataset.audienceCriterion){change({targetCriterion:button.dataset.audienceCriterion,audienceAccount:null});enter();}
    else if(button.dataset.audienceAccount){change({audienceAccount:button.dataset.audienceAccount,targetCriterion:null});enter();}
    else if(button.dataset.audienceOpenAccount)window.AtlasApp.focusAdvertiser(button.dataset.audienceOpenAccount);
    else if(button.dataset.audienceRace)window.AtlasElections.openRace(button.dataset.audienceRace,{navigate:false});
  }

  document.querySelectorAll('[data-audience-view]').forEach(b=>b.onclick=()=>setView(b.dataset.audienceView));
  document.querySelectorAll('[data-audience-preset]').forEach(b=>b.onclick=()=>change({audiencePreset:b.dataset.audiencePreset}));
  document.querySelectorAll('[data-audience-party]').forEach(b=>b.onclick=()=>{const s=context().state;change({party:s.party===b.dataset.audienceParty?'all':b.dataset.audienceParty,audienceAccount:null});window.AtlasApp.refresh();});
  document.querySelectorAll('[data-audience-period]').forEach(b=>b.onclick=()=>window.AtlasApp.setPeriod(b.dataset.audiencePeriod));
  document.querySelectorAll('[data-audience-scale]').forEach(b=>b.onclick=()=>{const scale=b.dataset.audienceScale;change({targetScale:scale==='share'?'share':'spend',units:scale==='capita'?'capita':'total'});window.AtlasApp.refresh();});
  $('audience-family').onchange=e=>change({targetFamily:e.target.value,targetCriterion:null,audienceAccount:null});
  $('audience-query').oninput=e=>{const value=e.target.value;clearTimeout(queryTimer);queryTimer=setTimeout(()=>change({targetQuery:value,targetCriterion:null,audienceAccount:null}),120);};
  $('audience-extras').onchange=e=>change({audienceExtras:e.target.checked,audienceAccount:null});
  $('audience-expand').onclick=()=>{const s=context().state;s.audienceFocus=!s.audienceFocus;sync();window.AtlasApp.syncURL();};
  $('audience-details').onclick=()=>enter({reveal:true});
  $('audience-place').onchange=e=>{$('state-select').value=e.target.value;$('state-select').dispatchEvent(new Event('change',{bubbles:true}));};
  $('audience-flow-select').onchange=e=>change({targetCriterion:e.target.value,audienceAccount:null});
  $('audience-global-controls').onclick=()=>{if(innerWidth>800)$('explore').scrollTo({top:0,behavior:reduced.matches?'instant':'smooth'});else document.querySelector('.explorer-top').scrollIntoView({block:'start',behavior:reduced.matches?'instant':'smooth'});};
  $('audience-clear').onclick=()=>context().state.audienceAccount?window.AtlasSelection.clear('inspection-account'):window.AtlasSelection.clear('inspection');$('audience-zoom-in').onclick=()=>zoom(camera.k*1.3);$('audience-zoom-out').onclick=()=>zoom(camera.k/1.3);$('audience-fit').onclick=fit;$('audience-save').onclick=saveImage;
  $('audience-findings').onclick=event=>{if(event.target.closest('button'))$('audience-notes').open=false;delegated(event);};$('audience-account-inspector').onclick=delegated;
  $('audience-history-slider').oninput=e=>{$('history-slider').value=e.target.value;$('history-slider').dispatchEvent(new Event('input',{bubbles:true}));sync();};
  $('audience-previous').onclick=()=>{const slider=$('audience-history-slider');slider.value=Math.max(0,Number(slider.value)-1);slider.dispatchEvent(new Event('input'));};
  $('audience-next').onclick=()=>{const slider=$('audience-history-slider');slider.value=Math.min(Number(slider.max),Number(slider.value)+1);slider.dispatchEvent(new Event('input'));};
  document.addEventListener('click',event=>{for(const id of ['audience-filter-panel','audience-notes']){const panel=$(id);if(panel.open&&!panel.contains(event.target))panel.open=false;}});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){for(const id of ['audience-filter-panel','audience-notes']){const panel=$(id);if(panel.open){event.preventDefault();event.stopImmediatePropagation();panel.open=false;panel.querySelector('summary').focus();break;}}}},true);
  canvas.addEventListener('pointerdown',event=>{const p=position(event);drag={...p,originX:p.x,originY:p.y,cameraX:camera.x,cameraY:camera.y,moved:false,touch:event.pointerType==='touch'};if(!drag.touch)canvas.setPointerCapture(event.pointerId);});
  canvas.addEventListener('pointermove',event=>{
    const p=position(event);
    if(drag){
      const dx=p.x-drag.originX,dy=p.y-drag.originY;
      if(Math.abs(dx)+Math.abs(dy)>6){drag.moved=true;if(!drag.touch||Math.abs(dx)>Math.abs(dy)){camera.x=drag.cameraX+dx;camera.y=drag.cameraY+(drag.touch?0:dy);hoverID=null;$('audience-tooltip').hidden=true;requestDraw();}}
      return;
    }
    const node=hit(p),next=node?.id;
    if(next!==hoverID){hoverID=next;canvas.style.cursor=node?'pointer':'grab';requestDraw();}
    tooltip(node,p);
  });
  canvas.addEventListener('pointerup',event=>{const p=position(event),click=drag&&!drag.moved;drag=null;if(click)select(hit(p));});
  canvas.addEventListener('pointercancel',()=>{drag=null;});
  canvas.addEventListener('pointerleave',()=>{if(!drag){hoverID=null;$('audience-tooltip').hidden=true;requestDraw();}});
  canvas.addEventListener('wheel',event=>{if(event.ctrlKey||event.metaKey||innerWidth>800){event.preventDefault();zoom(camera.k*Math.exp(-event.deltaY*.0015),position(event));}}, {passive:false});
  canvas.addEventListener('dblclick',fit);
  canvas.addEventListener('keydown',event=>{
    if(!scene)return;
    if(['ArrowRight','ArrowLeft','ArrowDown','ArrowUp'].includes(event.key)){
      event.preventDefault();const nodes=scene.nodes,index=nodes.findIndex(n=>n.id===keyboardID),step=event.key==='ArrowRight'||event.key==='ArrowDown'?1:-1,n=nodes[(index+step+nodes.length)%nodes.length];if(!n)return;
      keyboardID=n.id;$('audience-live').textContent=(n.label||n.name)+'. Press Enter to inspect.';tooltip(n,{x:n.x*camera.k+camera.x,y:n.y*camera.k+camera.y});requestDraw();
    }else if(event.key==='Enter'){event.preventDefault();select(scene.byID.get(keyboardID));}
    else if(event.key==='Escape'){event.preventDefault();clear();}
    else if(event.key==='+'||event.key==='='){event.preventDefault();zoom(camera.k*1.25);}
    else if(event.key==='-'){event.preventDefault();zoom(camera.k/1.25);}
    else if(event.key==='0'){event.preventDefault();fit();}
  });
  new ResizeObserver(resize).observe(chart);
  new IntersectionObserver(entries=>{const entry=entries[entries.length-1];visible=entry.isIntersecting;metrics.visibility={intersecting:visible,time:entry.time};if(visible)requestDraw();else{cancelAnimationFrame(frame);frame=0;}},{threshold:0}).observe(chart);
  reduced.addEventListener('change',()=>{if(reduced.matches&&tween){for(const n of scene.nodes)Object.assign(n,tween.to.get(n.id));tween=null;requestDraw();}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelAnimationFrame(frame);frame=0;tween=null;}else requestDraw();});
  document.addEventListener('atlas:selection',()=>{sync();resize();});
  document.addEventListener('atlas:relationships',()=>{if(isOpen()&&report){renderDesk();requestDraw();}});
  document.fonts.ready.then(()=>requestDraw());
  window.AtlasAudience={sync,receive,enter,setView,clear,dismissAccount:()=>{flowRemainder=null;change({audienceAccount:null});},get inspectedGroup(){return flowRemainder;},select,fit,get scene(){return scene;},get report(){return report;},get camera(){return {...camera};},get stamp(){return receivedStamp;}};
})();
