'use strict';
(() => {
  const $=id=>document.getElementById(id),ctx=()=>window.AtlasApp?.getContext();
  const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});
  const compact=n=>n>=1e6?'$'+(n/1e6).toLocaleString('en-US',{maximumFractionDigits:2})+'m':n>=1000?'$'+(n/1000).toLocaleString('en-US',{maximumFractionDigits:1})+'k':money.format(n);
  const catalogMap=new Map(),byPage=new Map(),committeeByPage=new Map();let catalogRef,readyPromise,activeRace,activeCandidates=[],raceRevision=0,lastKey,graphState='loading';
  function catalog(){const ref=ctx()?.catalog;if(ref&&ref!==catalogRef){catalogRef=ref;catalogMap.clear();for(const a of ref)catalogMap.set(a.id,a);}return catalogMap;}
  const ids=c=>[...new Set(c.advertisers?.map(a=>a.id)||(c.advertiser?[c.advertiser]:[]))];
  function accounts(pages,period=ctx()?.state.period||'30') {
    const map=catalog();return [...new Set(pages||[])].map(id=>map.get(id)).filter(Boolean).map(a=>({...a,period:a.periods[period]}));
  }
  function summary(pages,period) {
    const list=accounts(pages,period),reported=list.filter(a=>a.period&&(!a.period.currency||a.period.currency==='USD'));
    return {list,reported,total:reported.reduce((sum,a)=>sum+(a.period.spend||0),0),national:reported.reduce((sum,a)=>sum+(a.period.national_budget||0),0),local:reported.reduce((sum,a)=>sum+(a.period.local_budget||0),0)};
  }
  function raceSummary(r) {
    if(!r.advertisers?.length)return '';
    const s=summary(r.advertisers);
    return `<span class="race-ad-link"><span class="connection-mark" aria-hidden="true">↔</span>${s.reported.length?compact(s.total)+' Meta account spend':'Meta account connected'}<small>${r.linked_candidates||0} linked candidate records · ${ctx()?.state.period||30} days</small></span>`;
  }
  function candidateMetrics(c) {
    const links=ids(c),s=summary(links),period=ctx()?.state.period||'30',snapshot=ctx()?.manifest.snapshot;
    if(!links.length)return `<div class="candidate-ad-empty"><span class="section-label">META ADVERTISING</span><p>No account connected in this snapshot.</p><small>This does not establish that the candidate ran no ads.</small></div>`;
    return `<div class="candidate-meta-heading"><span class="section-label">META ADVERTISING</span><span>${period} days · ${escape(snapshot)}</span></div><div class="candidate-meta-total"><strong>${s.reported.length?compact(s.total):'No USD snapshot'}</strong><span>reported across ${links.length} matched account${links.length===1?'':'s'}<br>Account spending can include audiences outside this race.</span></div><div class="candidate-local-model" data-candidate-local="${escape(c.id)}"></div><div class="candidate-meta-accounts">${accounts(links).map(a=>`<button data-candidate-ad="${escape(a.id)}"><span>${escape(a.name)}</span><span>Map targeting ↗</span></button><button data-candidate-targeting="${escape(a.id)}" class="text-button">Audience choices ↗</button>`).join('')}</div><details class="connection-evidence"><summary>How these accounts connect</summary>${(c.advertisers||[{id:c.advertiser,method:c.advertiser_match}]).map(a=>`<p>${escape(a.method)}${a.committee_name?'<br>'+escape(a.committee_name):''}${a.source?` · <a href="${escape(a.source)}" target="_blank" rel="noopener">Evidence ↗</a>`:''}</p>`).join('')}</details>`;
  }
  function renderPlace(context,raceCount) {
    const box=$('place-context');if(!box||!context?.current)return;
    if(window.AtlasPlatforms?.renderPlace(context,raceCount))return;
    const total=(context.current.partyTotals||[]).reduce((s,v)=>s+v,0),count=context.rows?.length||0,perResident=context.state.units==='capita';
    const displayed=perResident?window.AtlasPopulation.format(total,window.AtlasPopulation.selection(context.state,context.manifest)):compact(total);
    box.innerHTML=`<div class="place-context-top"><span class="section-label">RACES &amp; ADVERTISING IN THIS VIEW</span><span>${context.state.period} DAYS</span></div><div class="place-context-values"><div><strong>${Number(raceCount||0).toLocaleString('en-US')}</strong><span>sourced November races</span></div><div><strong>≈ ${displayed}</strong><span>${perResident?'modelled USD per resident':'modelled geographic allocation'}</span></div></div><button id="place-advertising" class="text-button">Explore ${count.toLocaleString('en-US')} advertisers here ↗</button>`;
    $('place-advertising').onclick=()=>window.AtlasApp.setTab('ads');
  }
  function labelFor(page) {
    const links=byPage.get(page)||[],link=links.find(c=>c.status==='general')||links[0];
    if(!link)return '';
    return link.name+' · '+(window.AtlasElections?.getRace(link.race)?.title||link.state);
  }
  function connectionFields(page){const links=byPage.get(page)||[];return [links.map(c=>c.candidate).join('; '),[...new Set(links.map(c=>c.race))].join('; '),[...new Set(links.map(c=>c.method))].join('; ')];}
  function renderAdvertiser(page) {
    const box=$('advertiser-connections');if(!box)return;
    const a=catalog().get(page),committee=committeeByPage.get(page),types={H:'House campaign committee',S:'Senate campaign committee',P:'Presidential campaign committee',O:'Super PAC',Q:'Qualified PAC',N:'Nonqualified PAC',V:'Hybrid PAC',W:'Hybrid PAC',X:'Party committee',Y:'Party committee',I:'Independent spending group',E:'Electioneering communications group',U:'Independent spending committee'};
    const inferred=window.AtlasIdentities.evidence(page,a);
    const funding=a?.disclaimer?`<div class="funding-disclosure"><span class="section-label">REPORTED AD DISCLAIMER</span><strong>${escape(a.disclaimer)}</strong>${committee?`<span>${escape(types[committee.type]||'FEC-registered committee')} · ${escape(committee.state)} · <a href="${escape(committee.source)}" target="_blank" rel="noopener">${escape(committee.id)} ↗</a></span><small>Exact disclaimer match to the FEC committee registry.</small>`:''}</div>`:'';
    const links=(byPage.get(page)||[]).filter((c,i,a)=>a.findIndex(v=>v.race===c.race&&v.name===c.name)===i).sort((a,b)=>(a.status==='general'?0:1)-(b.status==='general'?0:1));
    if(!links.length){box.innerHTML=inferred+funding+(graphState==='ready'?'<p class="advertiser-unlinked">No direct candidate account match in this snapshot.</p>':`<p class="advertiser-unlinked">${graphState==='loading'?'Loading candidate connections…':'Candidate connections could not load.'}</p>${graphState==='failed'?'<button id="retry-connections" class="text-button">Retry candidate connections ↻</button>':''}`);if($('retry-connections'))$('retry-connections').onclick=ready;return;}
    box.innerHTML=inferred+funding+`<div class="advertiser-race-links"><span class="section-label">CONNECTED ELECTION RECORDS</span>${links.slice(0,4).map(c=>`<button data-connected-race="${escape(c.race)}"><strong>${escape(c.name)}</strong><span>${escape(window.AtlasElections?.getRace(c.race)?.title||c.kind)} · ${escape(c.state)}${c.status==='general'?'':' · '+escape(c.status)}</span><small>${escape(c.method)}</small></button>`).join('')}</div>`;
    box.querySelectorAll('[data-connected-race]').forEach(b=>b.onclick=()=>window.AtlasElections?.openRace(b.dataset.connectedRace,{navigate:true}));
  }
  function annotateCandidate(c) {
    const links=ids(c),a=summary(links,'7'),b=summary(links,'30'),f=c.finance&&!c.finance.period_after_retrieval?c.finance:null;
    return {meta_accounts:links.join('; '),meta_match:(c.advertisers||[]).map(a=>a.method).join('; '),meta_snapshot:ctx()?.manifest.snapshot,meta_spend_7d_usd:a.reported.length?a.total:'',meta_spend_30d_usd:b.reported.length?b.total:'',fec_receipts:f?.receipts??'',fec_disbursements:f?.disbursements??'',fec_cash_on_hand:f?.cash??'',fec_through:f?.through_iso||'',committee:c.committee||''};
  }
  function exportRace(r,records,allocation) {
    const context=ctx(),byAccount=new Map((allocation?.rows||[]).map(([i,v])=>[context.catalog[i].id,v]));
    const header=['candidate_id','candidate','candidate_party','race_id','state','meta_page_id','meta_account','advertiser_affiliation_tag','identity_match','committee_id','match_source','snapshot','window_days','reported_account_spend_usd','modelled_allocation_to_race_or_state_usd','geographic_basis','nationwide_model','geography_level','source_url'];
    const rows=[];for(const c of records.filter(c=>c.status==='general'))for(const link of c.advertisers||[]){const a=catalog().get(link.id),p=a?.periods[context.state.period];rows.push([c.id,c.name,c.party,r.id,r.state,link.id,a?.name,a?.party,link.method,link.committee,link.source,context.manifest.snapshot,context.state.period,p&&(!p.currency||p.currency==='USD')?p.spend:'',allocation?byAccount.get(link.id)||0:'',context.state.basis,context.state.nationwide,r.geometry?r.kind:'state',context.manifest.audit[context.state.period].source]);}
    const cell=value=>{let s=String(value??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
    const csv='\ufeff'+[header,...rows].map(r=>r.map(cell).join(',')).join('\r\n'),url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='midterms-'+r.id.replace(/:/g,'-')+'-campaign-advertising.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
  }
  async function renderRace() {
    const box=$('race-campaign-data'),r=activeRace,context=ctx();if(!box||!r||window.AtlasElections?.selectedRace!==r.id||!context)return;
    if(window.AtlasOverall){lastKey=[context.state.period,context.state.basis,context.state.nationwide,context.state.date,context.state.units].join('|');window.AtlasOverall.hydrateRace(r,activeCandidates).catch(error=>{if(window.AtlasElections?.selectedRace===r.id)box.innerHTML='<p>Campaign spending could not load. Change the period to retry.</p>';console.warn(error);});return;}
    const version=++raceRevision,period=context.state.period,s=summary(r.advertisers,period),general=activeCandidates.filter(c=>c.status==='general'),linked=general.filter(c=>ids(c).length);
    lastKey=[period,context.state.basis,context.state.nationwide].join('|');
    box.innerHTML=`<div class="race-campaign-heading"><div><span class="section-label">CONNECTING THE CAMPAIGN</span><h3>Campaign advertising</h3></div><div class="campaign-period"><button data-campaign-period="7" aria-pressed="${period==='7'}">7 days</button><button data-campaign-period="30" aria-pressed="${period==='30'}">30 days</button></div></div><p class="campaign-coverage">${linked.length} of ${general.length} November candidate records connected to ${r.advertisers?.length||0} Meta accounts. Coverage is partial; unmatched records do not imply no advertising.</p>${r.advertisers?.length?`<div class="campaign-figures"><div><strong>${s.reported.length?compact(s.total):'No USD snapshot'}</strong><span>Reported Meta account spending<br>${escape(context.manifest.snapshot)} · ${period} days · all audiences</span></div><div><strong id="race-local-total">…</strong><span>${r.geometry?'Modelled allocation to this district':'Modelled allocation to this state'}<br>${context.state.nationwide?'Nationwide population model included':'Nationwide targets excluded'}</span></div></div><div class="campaign-comparison">${linked.map(c=>{const v=summary(ids(c),period),width=s.total>0?Math.min(100,v.total/s.total*100):0;return `<button class="campaign-comparison-row ${escape(c.party)}" data-campaign-candidate="${escape(c.id)}"><span><strong>${escape(c.name)}</strong><b>${v.reported.length?compact(v.total):'No snapshot'}</b></span><i class="campaign-comparison-bar" style="--share:${width}%"></i></button>`;}).join('')}</div><div class="campaign-actions"><button id="map-race-campaigns" class="campaign-map-button">Map these campaigns ↗</button><button id="export-campaign-advertising" class="text-button">Advertising CSV ↓</button></div><p class="campaign-source-note">${s.national>0?compact(s.national)+' of criterion allocation is nationwide. ':''}Amounts here cover only the matched accounts. FEC campaign totals below have their own reporting dates.</p>`:'<p class="campaign-source-note">The map still shows advertisers targeting this place. Their accounts are not assigned to a candidate without an identity match.</p><button id="race-all-advertisers" class="text-button">Explore advertisers targeting this place ↗</button>'}`;
    box.querySelectorAll('[data-campaign-period]').forEach(b=>b.onclick=()=>window.AtlasApp.setPeriod(b.dataset.campaignPeriod));
    box.querySelectorAll('[data-campaign-candidate]').forEach(b=>b.onclick=()=>{const card=document.getElementById('candidate-'+b.dataset.campaignCandidate.replace(/[^a-zA-Z0-9_-]/g,'-'));card?.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth'});card?.focus({preventScroll:true});});
    for(const c of activeCandidates){const b=document.querySelector(`[data-meta-candidate="${CSS.escape(c.id)}"]`);if(b){b.innerHTML=candidateMetrics(c);window.AtlasElections?.bindCandidateActions(b);}}
    const geography={house:'district',upper:'upper',lower:'lower'}[r.kind]||'state',area=r.geometry?{type:geography,id:r.geometry}:null;
    const navigate=async()=>{window.AtlasElections.closeDrawer();await window.AtlasApp.navigate({place:r.state,area,geography,tab:'ads',resetCampaign:true});};
    if($('race-all-advertisers'))$('race-all-advertisers').onclick=navigate;
    if(!$('map-race-campaigns'))return;
    $('map-race-campaigns').onclick=async()=>{window.AtlasElections.closeDrawer();await window.AtlasApp.navigate({place:r.state,area,geography,tab:'ads'});await window.AtlasApp.focusCampaign(r);};
    $('export-campaign-advertising').onclick=()=>exportRace(r,activeCandidates,null);
    try {
      const result=await window.AtlasApp.campaignAllocation({pages:r.advertisers,place:r.state,area});
      if(version!==raceRevision||window.AtlasElections.selectedRace!==r.id||period!==ctx()?.state.period)return;
      if(!result){$('race-local-total').textContent='Updating…';lastKey=null;return;}
      const byAccount=new Map(result.rows.map(([i,v])=>[context.catalog[i].id,v]));
      $('race-local-total').textContent='≈ '+compact(result.partyTotals.reduce((s,v)=>s+v,0));
      for(const c of general){const e=document.querySelector(`[data-candidate-local="${CSS.escape(c.id)}"]`);if(e&&ids(c).length)e.innerHTML=`<strong>≈ ${compact(ids(c).reduce((s,id)=>s+(byAccount.get(id)||0),0))}</strong><span>modelled ${r.geometry?'district':'state'} allocation · ${context.state.nationwide?'nationwide model included':'nationwide targets excluded'}</span>`;}
      $('export-campaign-advertising').onclick=()=>exportRace(r,activeCandidates,result);
    }catch{if(version===raceRevision&&$('race-local-total'))$('race-local-total').textContent='Unavailable';}
  }
  function showRace(r,candidates){activeRace=r;activeCandidates=candidates;renderRace();if(!window.AtlasOverall)window.AtlasPlatforms?.hydrateRace(r,candidates).catch(()=>{const box=document.getElementById('race-other-platforms');if(box)box.innerHTML='<p>Other ad library connections could not load. Reload to retry.</p>';});}
  async function ready() {
    if(!readyPromise){graphState='loading';readyPromise=(async()=>{const url='data/elections/relationships.json.gz';for(let attempt=0;attempt<2;attempt++){try{const response=await fetch(url,{signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error('Campaign links unavailable');return await window.AtlasJSON.read(response,url);}catch(error){if(attempt)throw error;await new Promise(r=>setTimeout(r,500));}}})().then(data=>{byPage.clear();committeeByPage.clear();for(const committee of data.committees||[])committeeByPage.set(committee.page,committee);for(const link of data.links){if(!byPage.has(link.page))byPage.set(link.page,[]);byPage.get(link.page).push(link);}graphState='ready';window.AtlasApp?.refreshConnections();document.dispatchEvent(new CustomEvent('atlas:relationships'));}).catch(()=>{readyPromise=null;graphState='failed';if(ctx()?.state.pageID)renderAdvertiser(ctx().state.pageID);});}return readyPromise;
  }
  window.AtlasConnections={candidateMetrics,raceSummary,renderPlace,renderAdvertiser,labelFor,connectionFields,annotateCandidate,showRace,ready};
  document.addEventListener('atlas:selection',()=>{const c=ctx();if(activeRace&&$('race-campaign-data')&&lastKey!==[c?.state.period,c?.state.basis,c?.state.nationwide,c?.state.date,c?.state.units].join('|')&&String(c?.data?.window)===c?.state.period)renderRace();});
  if(window.AtlasApp)ready();else document.addEventListener('atlas:boot',ready,{once:true});
})();
