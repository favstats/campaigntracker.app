'use strict';
(() => {
  const $=id=>document.getElementById(id),ctx=()=>window.AtlasApp?.getContext();
  const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const kinds={interests:'Interests',demographics:'Demographics',behaviours:'Behaviours',age:'Age',gender:'Gender',custom:'Custom audiences',lookalike:'Lookalikes',location:'Places',language:'Languages',all:'All criteria'};
  const parties=['dem','rep','other','untagged'],names=['Democratic','Republican','Other','Unclassified'];
  const number=new Intl.NumberFormat('en-US'),pct=v=>v===null?'—':(v*100).toLocaleString('en-US',{maximumFractionDigits:1})+'%';
  const dollars=v=>v>=1e6?'$'+(v/1e6).toLocaleString('en-US',{maximumFractionDigits:2})+'m':v>=1e3?'$'+(v/1e3).toLocaleString('en-US',{maximumFractionDigits:1})+'k':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(v);
  const short=v=>new Date(v+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'});
  let worker,serial=0,catalogRef,geoRef,legRefs={},renderRevision=0,limit=18,accountLimit=12,result,lastKey,inputTimer,mapKey;
  const pending=new Map(),metrics={queries:[],firstLoad:null};window.targetingPerformance=metrics;

  function initializeWorker() {
    const c=ctx();if(!c?.data)throw Error('Wait for the spending snapshot to finish loading.');
    if(!worker){worker=new Worker('targeting-worker.js?v=4');worker.onmessage=e=>{const p=pending.get(e.data.id);if(!p)return;clearTimeout(p.timer);pending.delete(e.data.id);e.data.error?p.reject(Error(e.data.error)):p.resolve(e.data);};worker.onerror=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('The targeting calculation could not start. Reload to retry.'));}pending.clear();};}
    if(catalogRef!==c.catalog){catalogRef=c.catalog;worker.postMessage({type:'catalog',catalog:c.catalog});}
    if(geoRef!==c.data){geoRef=c.data;worker.postMessage({type:'data',data:c.data});}
    for(const [kind,data]of Object.entries(c.legData))if(legRefs[kind]!==data){legRefs[kind]=data;worker.postMessage({type:'legislative',kind,data});}
  }
  function call(type,extra={}) {
    initializeWorker();const s=ctx().state,url=new URL('data/history/'+s.date+'/targeting-v2-'+s.period+'.json.gz',location.href).href;
    return new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('Targeting evidence took too long to load. Retry this view.'));},45000);pending.set(id,{resolve,reject,timer});worker.postMessage({type,id,url,...extra});});
  }
  function pageScope(s) {
    const scopes=[];if(s.pageID)scopes.push([s.pageID]);if(s.campaignPages)scopes.push(s.campaignPages);
    if(s.platformAccount)scopes.push(s.platformAccount.startsWith('meta:')?[s.platformAccount.slice(5)]:[]);
    if(s.platformAccounts)scopes.push(s.platformAccounts.filter(id=>id.startsWith('meta:')).map(id=>id.slice(5)));
    if(s.targetMap&&s.targetMapPages)scopes.push(s.targetMapPages);
    return scopes.length?scopes.reduce((a,b)=>a.filter(v=>b.includes(v))):null;
  }
  function options() {
    const c=ctx(),s=c.state,pages=pageScope(s),index=new Map(c.catalog.map((a,i)=>[a.id,i]));
    return {date:s.date,period:s.period,party:s.party,untagged:s.untagged||s.audienceExtras,includeNonPolitical:s.includeNonPolitical,visibleParties:s.audienceExtras?['dem','rep','other','untagged']:['dem','rep'],stateID:c.manifest.states.find(v=>v.abbr===s.place)?.id||null,
      page:null,pages:pages?.map(id=>index.get(id)).filter(i=>i!==undefined)??null,basis:s.platform==='meta'?s.basis:'local',nationwide:s.nationwide};
  }
  function settings(extra={}) {
    const s=ctx().state;return {family:s.targetFamily,scale:s.targetScale,sort:s.targetSort,mode:s.targetMode,query:s.targetQuery,criterion:s.targetCriterion,limit,accountLimit,visual:s.audienceView!=='map',extras:s.audienceExtras,preset:s.audiencePreset,account:s.audienceAccount,...extra};
  }
  const denomination=()=>window.AtlasPopulation.selection(ctx().state,ctx().manifest);
  const amount=v=>ctx().state.units==='capita'?window.AtlasPopulation.format(v,denomination()):dollars(v);
  const shareAxis=()=>Math.min(1,Math.max(.01,Math.ceil((result?.maxShare||0)*100)/100));
  function sync() {
    const s=ctx().state;$('targeting-family').value=s.targetFamily;$('targeting-sort').value=s.targetSort;
    document.querySelectorAll('#targeting-legend .other,#targeting-legend .untagged').forEach(dot=>dot.parentElement.hidden=!s.audienceExtras);
    if(document.activeElement!==$('targeting-search'))$('targeting-search').value=s.targetQuery;
    const excluded=s.targetMode==='exclusions';
    document.querySelectorAll('[data-target-scale]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.targetScale===s.targetScale));b.disabled=excluded;});
    document.querySelectorAll('[data-target-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.targetMode===s.targetMode)));
    $('targeting-sort').querySelector('[value="difference"]').disabled=excluded;
    $('targeting-scale-label').textContent=excluded?'REPORTED EXCLUSIONS · ACCOUNT COUNTS':s.targetScale==='share'?'ASSOCIATED SPEND / EACH PARTY’S BUDGET':s.units==='capita'?'ASSOCIATED USD PER RESIDENT':'ASSOCIATED USD · CRITERIA OVERLAP';
    $('targeting-axis-note').textContent=excluded?'Exclusions list who reports a setting; no positive spending is attributed to it.':s.targetScale==='share'?'Each party has its own denominator. Bars share a 0–'+pct(shareAxis())+' scale for this view.':s.units==='capita'?'Associated spending divided by the population of this view; it is not spending per targeted person.':'Dollar bars use one common scale. The same advertising can appear under several criteria.';
    const banner=$('targeting-map-focus');banner.hidden=!s.targetMap;
    if(s.targetMap){banner.innerHTML=`<span><strong>${escape(s.targetMapLabel||'Selected criterion')}</strong><small>Map shows these advertisers’ full geographic allocations.</small></span><button id="clear-targeting-map" aria-label="Clear targeting map filter">×</button>`;$('clear-targeting-map').onclick=()=>{Object.assign(s,{targetMap:false,targetMapPages:null,targetMapLabel:null});mapKey=null;window.AtlasApp.refresh();};}
  }
  function rowChart(row) {
    const s=ctx().state,excluded=s.targetMode==='exclusions';
    if(!excluded&&s.targetScale==='share')return `<span class="targeting-share-chart">${[0,1,...[2,3].filter(p=>row.values[p]>0)].map(p=>`<span class="targeting-party-line ${parties[p]}"><span>${['Dem','Rep','Other','Uncl.'][p]}</span><i><b style="transform:scaleX(${Math.max(0,Math.min(1,(row.shares[p]??0)/shareAxis()))})"></b></i><strong>${pct(row.shares[p])}</strong></span>`).join('')}</span>`;
    const values=excluded?row.counts:row.values,total=values.reduce((n,v)=>n+v,0),width=result.max?Math.max(0,Math.min(1,total/result.max)):0;
    return `<span class="targeting-dollar-chart"><span class="targeting-stack" style="transform:scaleX(${width})">${values.map((v,p)=>`<i class="${parties[p]}" style="flex:${v||0}"></i>`).join('')}</span></span>`;
  }
  function gap(row) {
    if(row.gap===null)return 'Select both parties to compare';
    if(Math.abs(row.gap)<.05)return 'Similar budget share';
    return (row.gap>0?'Dem':'Rep')+' +'+Math.abs(row.gap).toLocaleString('en-US',{maximumFractionDigits:1})+' pp';
  }
  function detailHTML(d) {
    if(!d)return '';
    const s=ctx().state,excluded=d.excluded,unknown=d.unknown.reduce((n,v)=>n+v,0);
    return `<div class="targeting-detail" id="targeting-detail-${d.id}" role="region" aria-label="Advertisers using ${escape(d.label)}"><div class="targeting-detail-heading"><h3>Who ${excluded?'excludes':'uses'} this?</h3><button class="targeting-detail-close" data-target-close aria-label="Close criterion details">×</button></div><div class="targeting-detail-parties">${d.counts.map((n,p)=>n?`<span class="${parties[p]}"><i class="party-dot ${parties[p]}"></i><b>${names[p]}</b><strong>${excluded?number.format(n)+' accounts':amount(d.values[p])}</strong><small>${excluded?'Exclusion reported':pct(d.shares[p])+' of party budget'}</small></span>`:'').join('')}</div>${unknown&&!excluded?`<p class="targeting-weight-note">${number.format(unknown)} accounts report this criterion without a usable spending share.</p>`:''}<p class="targeting-detail-context">${excluded?'Reported exclusions may apply to different ads from included targets.':result.local?'Amounts use each advertiser’s modelled allocation to this place × its account-wide criterion share. The source cannot link that criterion to ads delivered here.':'Amounts use each advertiser’s reported USD budget × its reported criterion spending share.'}</p><div class="targeting-account-list">${d.accounts.map(a=>{const candidate=window.AtlasConnections?.labelFor(a.id),race=window.AtlasConnections?.connectionFields(a.id)?.[1]?.split('; ')[0];return `<div class="targeting-account"><button data-target-account="${a.id}" class="targeting-account-main"><span><strong><i class="party-dot ${a.party}"></i>${escape(a.name)}</strong>${window.AtlasIdentities.badge(a.id,true)}<small>${excluded?'Reported exclusion':a.weight===null?'Spending share unavailable':pct(a.weight)+' reported spending share'}</small></span><b>${excluded?'↗':a.value===null?'Unknown':amount(a.value)}</b></button>${candidate?`<button class="targeting-candidate-link" data-target-race="${escape(race)}">${escape(candidate)} ↗</button>`:''}</div>`;}).join('')}</div>${d.accountTotal>accountLimit?'<button class="show-more" data-target-accounts-more>More advertisers ↓</button>':''}<div class="targeting-detail-actions"><button class="targeting-map-button" data-target-map ${excluded?'disabled':''}>Map these advertisers ↗</button><button class="text-button" data-target-export-accounts>Advertisers CSV ↓</button></div><a class="targeting-source-link" href="${escape(result.source)}" target="_blank" rel="noopener">Original ${s.period}-day source · ${escape(short(s.date))} ↗</a></div>`;
  }
  function renderRows() {
    const s=ctx().state,selected=s.targetCriterion,excluded=s.targetMode==='exclusions';
    $('targeting-results').innerHTML=result.rows.length?`<ol class="targeting-rows">${result.rows.map((r,i)=>`<li class="targeting-row ${selected===r.id?'is-selected':''}"><button class="targeting-criterion" data-target-criterion="${r.id}" aria-expanded="${selected===r.id}" ${selected===r.id?'aria-controls="targeting-detail-'+r.id+'"':''}><span class="targeting-row-heading"><span><small>${String(i+1).padStart(2,'0')}</small><strong>${escape(r.label)}</strong></span><b>${excluded?number.format(r.count):s.targetScale==='share'?pct(r.shares.some(v=>v!==null)?Math.max(...r.shares.filter(v=>v!==null)):null):amount(r.total)}</b></span>${rowChart(r)}<span class="targeting-row-foot"><span>${number.format(r.count)} advertiser${r.count===1?'':'s'}${s.targetFamily==='all'?' · '+escape(kinds[r.kind]):''}</span><span class="${(r.gap||0)>0?'dem':(r.gap||0)<0?'rep':''}">${excluded?'Exclusion reported':s.targetScale==='share'?gap(r):r.values[0]+r.values[1]>0?'Dem '+Math.round(r.values[0]/(r.values[0]+r.values[1])*100)+'% · Rep '+Math.round(r.values[1]/(r.values[0]+r.values[1])*100)+'%':'Other / unclassified'}</span></span></button>${selected===r.id?detailHTML(result.detail):''}</li>`).join('')}</ol>`:`<div class="targeting-empty"><h3>No matching criteria.</h3><p>${s.targetQuery?'Try a shorter term or another criterion type.':'This scope has no '+(excluded?'reported exclusions':'weighted '+kinds[s.targetFamily].toLowerCase())+'. Try including unclassified advertisers, changing the place or choosing another audience type.'}</p></div>`;
    if(selected&&result.detail&&!result.rows.some(r=>r.id===selected))$('targeting-results').insertAdjacentHTML('afterbegin',`<div class="targeting-selected-outside"><strong>${escape(result.detail.label)}</strong>${detailHTML(result.detail)}</div>`);
    $('targeting-more').hidden=result.totalRows<=limit;$('targeting-result-count').textContent=number.format(result.totalRows)+' criteria';
  }
  function renderSummary() {
    const s=ctx().state,count=result.accountCounts.reduce((n,v)=>n+v,0),observed=result.observedCounts.reduce((n,v)=>n+v,0),budget=result.denominators.reduce((n,v)=>n+v,0);
    $('targeting-context').innerHTML=`<span class="targeting-context-location">${escape(window.AtlasApp.areaInfo().title)}</span><span>Meta criteria · ${s.period} days · ${escape(short(s.date))} snapshot</span>`;
    $('targeting-denominators').innerHTML=result.denominators.map((v,p)=>`<span><i class="party-dot ${parties[p]}"></i>${['Dem','Rep','Other','Uncl.'][p]} <b>${dollars(v)}</b></span>`).join('');
    $('targeting-coverage').innerHTML=`<strong>${dollars(budget)}</strong><span>${result.local?'modelled Meta allocation in this place':'reported Meta account budget'}<br>${number.format(observed)} / ${number.format(count)} accounts have observed targeting</span>`;
    $('targeting-note').textContent='Detailed audience criteria are supplied by Meta. Google and Snapchat amounts remain in the overall spending view; their dollars are not assigned to these criteria.';
    $('targeting-legend').hidden=s.targetScale==='share'||s.targetMode==='exclusions';
    $('targeting-export').disabled=!result.totalRows;
  }
  async function render({force=false,keepLimit=false}={}) {
    const c=ctx();if(!c?.current||c.state.tab!=='targeting')return;
    if(c.data.snapshot!==c.state.date||String(c.data.window)!==c.state.period)return;
    const s=c.state;sync();
    if(s.platform!=='meta'&&s.platform!=='overall'){
      $('targeting-content').hidden=true;$('targeting-unavailable').hidden=false;$('targeting-unavailable').innerHTML=`<h3>Explore Meta’s audience criteria.</h3><p>Detailed interests and audience shares are available in the Meta snapshots. Your current ${escape(s.platform)} library has a different targeting disclosure.</p><button id="targeting-use-overall" class="targeting-map-button">Open overall targeting ↗</button>`;$('targeting-use-overall').onclick=()=>window.AtlasPlatforms.setSource('overall',{tab:'targeting',race:s.platformRace,account:null});return;
    }
    if(s.platform==='overall'&&!s.overallSources.includes('meta')){
      $('targeting-content').hidden=true;$('targeting-unavailable').hidden=false;$('targeting-unavailable').innerHTML='<h3>Meta is excluded from this view.</h3><p>Enable Meta to explore the audience criteria behind its spending.</p><button id="targeting-enable-meta" class="targeting-map-button">Include Meta ↗</button>';$('targeting-enable-meta').onclick=()=>{s.overallSources.push('meta');window.AtlasApp.refresh();};return;
    }
    $('targeting-content').hidden=false;$('targeting-unavailable').hidden=true;
    let key=JSON.stringify([options(),s.area,settings(),s.units]);if(!force&&key===lastKey)return;
    if(!keepLimit){limit=18;accountLimit=12;}
    key=JSON.stringify([options(),s.area,settings(),s.units]);
    const version=++renderRevision,began=performance.now();$('targeting-content').setAttribute('aria-busy','true');$('targeting-status').hidden=false;$('targeting-status').textContent='Reading reported targeting…';
    try {
      const r=await call('target-query',{options:options(),area:s.area,settings:settings()});
      if(version!==renderRevision||ctx().state.tab!=='targeting'||key!==JSON.stringify([options(),s.area,settings(),s.units]))return;
      result=r;lastKey=JSON.stringify([options(),s.area,settings(),s.units]);sync();renderSummary();renderRows();window.AtlasAudience?.receive(r);window.AtlasSelection?.sync();if(metrics.firstLoad===null)enter();
      metrics.queries.push({date:s.date,period:s.period,worker:r.elapsed,total:performance.now()-began,rows:r.totalRows});if(metrics.queries.length>60)metrics.queries.shift();metrics.firstLoad??=performance.now()-began;
      $('targeting-status').hidden=true;
    }catch(error){if(version!==renderRevision)return;lastKey=null;$('targeting-status').innerHTML=escape(error.message)+' <button id="targeting-retry" class="text-button">Retry ↗</button>';$('targeting-retry').onclick=()=>render({force:true});$('targeting-results').innerHTML='';$('targeting-export').disabled=true;}
    finally{if(version===renderRevision)$('targeting-content').setAttribute('aria-busy','false');}
  }
  function change(patch) {const s=ctx().state,clear=s.targetMap&&Object.hasOwn(patch,'targetCriterion')&&patch.targetCriterion!==s.targetCriterion;Object.assign(s,patch);if(clear){Object.assign(s,{targetMap:false,targetMapPages:null});mapKey=null;window.AtlasApp.refresh();}else{window.AtlasApp.syncURL();render({force:true});}}
  function csv(header,rows,name) {
    const cell=v=>'"'+(typeof v==='string'&&/^[=+@\-\t\r]/.test(v)?"'"+v:String(v??'')).replace(/"/g,'""')+'"';
    const blob=new Blob(['\uFEFF'+[header,...rows].map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
  }
  async function exportData(accounts=false) {
    const s={...ctx().state};if(ctx().data.snapshot!==s.date||String(ctx().data.window)!==s.period)throw Error('Wait for the spending snapshot to finish updating, then export again.');
    const stamp=JSON.stringify([options(),s.area,settings(),s.units]),r=await call('target-query',{options:options(),area:s.area,settings:settings({exportAll:true})});
    if(stamp!==JSON.stringify([options(),ctx().state.area,settings(),ctx().state.units]))throw Error('The view changed while the CSV was being prepared. Export the current view again.');
    const pop=denomination();
    const common=[s.date,s.period,s.area?s.area.type+':'+s.area.id:s.place,pop,r.local?'modelled place allocation × account-wide reported share':'reported account budget × reported share',r.source,'Criteria overlap; do not sum across criteria',s.includeNonPolitical];
    const shared=['snapshot','window_days','place','population_2020_acs','method','source','overlap_note','include_non_political_accounts'];
    if(accounts&&r.detail)csv(['criterion_id','criterion','family','excluded','page_id','advertiser','affiliation','reported_criterion_share','reported_num_ads','associated_usd','reported_account_usd','scope_account_usd','associated_usd_per_resident','linked_candidate_records','linked_races','identity_match','identity_status','identity_evidence_score_percent',...shared],r.detail.accounts.map(a=>[r.detail.id,r.detail.label,r.detail.kind,r.detail.excluded,a.id,a.name,a.party,a.weight,a.ads,a.value,a.spend,a.budget,a.value===null?null:window.AtlasPopulation.rate(a.value,pop),...(window.AtlasConnections?.connectionFields(a.id)||['','','']),window.AtlasIdentities.get(a.id)?.status||'source-tag',window.AtlasIdentities.get(a.id)?.score??'',...common]),'midterms-targeting-advertisers-'+s.date+'.csv');
    else csv(['criterion_id','criterion','family','subtype','excluded','advertisers','associated_usd','dem_associated_usd','rep_associated_usd','other_associated_usd','unclassified_associated_usd','dem_budget_usd','rep_budget_usd','other_budget_usd','unclassified_budget_usd','dem_budget_share','rep_budget_share','other_budget_share','unclassified_budget_share','dem_minus_rep_percentage_points','associated_usd_per_resident',...shared],r.rows.map(row=>[row.id,row.label,row.kind,row.subtype,row.excluded,row.count,row.excluded?null:row.total,...(row.excluded?[null,null,null,null]:row.values),...r.denominators,...(row.excluded?[null,null,null,null]:row.shares),row.excluded?null:row.gap,row.excluded?null:window.AtlasPopulation.rate(row.total,pop),...common]),'midterms-targeting-'+s.targetFamily+'-'+s.date+'.csv');
  }
  async function prepareMap() {
    const s=ctx().state;if(!s.targetMap){mapKey=null;return;}
    const key=[s.date,s.period,s.targetCriterion,s.audienceExtras,s.includeNonPolitical].join('|');if(key===mapKey&&s.targetMapPages)return;
    const r=await call('target-members',{criterion:s.targetCriterion,visibleParties:options().visibleParties,includeNonPolitical:s.includeNonPolitical});
    if(key!==[s.date,s.period,s.targetCriterion,s.audienceExtras,s.includeNonPolitical].join('|'))return;
    s.targetMapPages=r.pages;s.targetMapLabel=r.label;mapKey=key;
  }
  async function mapCriterion() {
    const s=ctx().state;if(!result?.detail||result.detail.excluded)return;
    const raceID=s.campaignRace||s.platformRace,previous={place:s.place,area:s.area,geography:s.geography,party:s.party,untagged:s.untagged,nationwide:s.nationwide,criterion:s.targetCriterion,page:s.pageID,campaignRace:raceID,campaignPages:pageScope(s),campaignTitle:raceID?window.AtlasElections?.getRace(raceID)?.title||s.campaignTitle:null};
    await window.AtlasPlatforms.setSource('meta',{tab:'targeting'});
    Object.assign(s,{place:previous.place,area:previous.area,geography:previous.geography,party:previous.party,untagged:previous.untagged,nationwide:previous.nationwide,targetCriterion:previous.criterion,targetMap:true,targetMapPages:null,pageID:previous.page,campaignRace:previous.campaignRace,campaignPages:previous.campaignPages,campaignTitle:previous.campaignTitle,audienceView:'map',audienceAccount:null});mapKey=null;
    await window.AtlasApp.refresh();
  }
  async function openAccount(id) {
    window.AtlasElections?.closeDrawer();
    if(ctx().state.platform!=='meta')await window.AtlasPlatforms.setSource('meta');
    Object.assign(ctx().state,{pageID:id,party:'all',untagged:true,targetMap:false,targetMapPages:null,targetCriterion:null,tab:'targeting',audienceAccount:null,audienceView:'network'});
    const account=ctx().catalog.find(a=>a.id===id);if(account&&!['dem','rep'].includes(account.party))ctx().state.audienceExtras=true;
    await window.AtlasApp.refresh();
    $('targeting-explorer').scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  }
  async function accountSummary(id,container) {
    const stamp=[ctx().state.date,ctx().state.period,id].join('|'),box=document.createElement('div');box.className='targeting-account-teaser';box.dataset.stamp=stamp;container.append(box);
    try{const r=await call('target-account',{page:id});if(!box.isConnected||stamp!==[ctx().state.date,ctx().state.period,ctx().state.pageID].join('|'))return;
      box.innerHTML=`<span class="section-label">AUDIENCE CHOICES</span>${r.available?`<p>${r.families.interests||0} interests · ${r.families.demographics||0} demographics · ${r.families.custom||0} custom-audience settings</p>${r.groups.map(g=>`<span>${escape(g.label)} <b>${pct(g.weight)}</b></span>`).join('')}`:'<p>No audience detail is available for this observation.</p>'}<button class="text-button">Explore all targeting choices ↗</button>`;box.querySelector('button').onclick=()=>window.AtlasApp.setTab('targeting');
    }catch{if(box.isConnected)box.innerHTML='<p>Audience details are unavailable. Open the Targeting tab to retry.</p>';}
  }
  function bind() {
    $('targeting-family').onchange=e=>change({targetFamily:e.target.value,targetCriterion:null});
    $('targeting-sort').onchange=e=>change({targetSort:e.target.value});
    $('targeting-search').oninput=e=>{const query=e.target.value;clearTimeout(inputTimer);inputTimer=setTimeout(()=>change({targetQuery:query,targetCriterion:null}),100);};
    document.querySelectorAll('[data-target-scale]').forEach(b=>b.onclick=()=>change({targetScale:b.dataset.targetScale}));
    document.querySelectorAll('[data-target-mode]').forEach(b=>b.onclick=()=>change({targetMode:b.dataset.targetMode,targetCriterion:null,targetSort:ctx().state.targetSort==='difference'?'spend':ctx().state.targetSort}));
    $('targeting-more').onclick=()=>{limit+=18;render({force:true,keepLimit:true});};
    $('targeting-export').onclick=()=>exportData().catch(showActionError);
    $('targeting-results').onclick=e=>{const button=e.target.closest('button');if(!button)return;
      if(button.dataset.targetCriterion){accountLimit=12;change({targetCriterion:ctx().state.targetCriterion===button.dataset.targetCriterion?null:button.dataset.targetCriterion});}
      else if(button.hasAttribute('data-target-close'))change({targetCriterion:null});
      else if(button.dataset.targetAccount)window.AtlasApp.focusAdvertiser(button.dataset.targetAccount);
      else if(button.dataset.targetRace)window.AtlasElections.openRace(button.dataset.targetRace,{navigate:false});
      else if(button.hasAttribute('data-target-accounts-more')){accountLimit+=12;render({force:true,keepLimit:true});}
      else if(button.hasAttribute('data-target-map'))mapCriterion().catch(showActionError);
      else if(button.hasAttribute('data-target-export-accounts'))exportData(true).catch(showActionError);
    };
    document.addEventListener('atlas:selection',()=>render());document.addEventListener('atlas:relationships',()=>{if(result&&ctx()?.state.tab==='targeting')renderRows();});
  }
  function showActionError(error){$('targeting-status').hidden=false;$('targeting-status').textContent=error.message;}
  function enter(){if(ctx()?.state.audienceView!=='map'){window.AtlasAudience?.enter();return;}const panel=$('targeting-explorer'),explorer=$('explore'),behavior=matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth';if(innerWidth>800)explorer.scrollTo({top:explorer.scrollTop+panel.getBoundingClientRect().top-explorer.getBoundingClientRect().top,behavior});else panel.scrollIntoView({block:'start',behavior});}
  $('targeting-controls-link').onclick=()=>{if(innerWidth>800)$('explore').scrollTo({top:0,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});else document.querySelector('.explorer-top').scrollIntoView({block:'start'});};
  window.AtlasTargeting={enter,syncControls:sync,render,prepareMap,openAccount,accountSummary,change,selectCriterion:id=>change({targetCriterion:id,audienceAccount:null}),mapCriterion,get result(){return result;},members:id=>call('target-members',{criterion:id,visibleParties:options().visibleParties,includeNonPolitical:ctx().state.includeNonPolitical})};
  bind();
})();
