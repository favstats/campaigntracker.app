'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number = new Intl.NumberFormat('en-US');
  const dollars = new Intl.NumberFormat('en-US', {style:'currency', currency:'USD', maximumFractionDigits:0});
  const compact = n => Math.abs(n) >= 1e6 ? '$' + (n / 1e6).toLocaleString('en-US', {maximumFractionDigits:2}) + 'm' : Math.abs(n) >= 1000 ? '$' + (n / 1000).toLocaleString('en-US', {maximumFractionDigits:1}) + 'k' : dollars.format(n);
  const initials = name => String(name || '?').trim().split(/\s+/).filter(Boolean).filter(n => !/^(dr\.?|mr\.?|mrs\.?|ms\.?)$/i.test(n)).map(n => n[0]).filter(Boolean).slice(0,3).join('').slice(0,2);
  const normalize = s => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const cache = new Map(), stateCache = new Map(), legCache = new Map(), geometryRaces=new Map();
  const parties = {dem:'Democratic', rep:'Republican', ind:'Independent / nonpartisan', other:'Other party'};
  const statuses = {general:'November 3 record', 'unconfirmed-general':'November association · roster unconfirmed', 'earlier-election':'Earlier 2026 election', 'year-record':'2026 profile · date unconfirmed', filing:'FEC filing · ballot status unconfirmed', withdrawn:'Withdrawn in source'};
  const order = ['senate','governor','house','statewide','upper','lower','boards','judicial','county','municipal','school','special','local','unknown'];
  const localKinds=new Set(['county','municipal','school','special','local']);
  let manifest, races = [], raceByID = new Map(), candidateIndex, candidateByRace = new Map(), readyPromise, searchPromise;
  let sideKind = 'all', sideLimit = 6, sideKey = '', directory = {place:'US',kind:'all',party:'all',stage:'general',query:'',limit:40};
  let drawerMode = null, selectedRace = new URLSearchParams(location.search).get('race'), selectedCandidate = new URLSearchParams(location.search).get('candidate'), drawerRevision = 0, returnFocus = null, returnScroll=0, previousRace = null;
  const ctx = () => window.AtlasApp?.getContext();
  async function fetchSource(url) {
    for(let attempt=0;attempt<2;attempt++) {
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
      try {
        const response=await fetch(url,{signal:controller.signal});
        if(!response.ok){const error=Error('This source could not load ('+response.status+').');error.retryable=response.status===429||response.status>=500;throw error;}
        return await window.AtlasJSON.read(response,url);
      } catch(error) {
        if(attempt||!(error.retryable||error.name==='AbortError'||error instanceof TypeError))throw error;
        await new Promise(resolve=>setTimeout(resolve,500));
      } finally {clearTimeout(timer);}
    }
  }
  async function get(url) {
    const packed=url.startsWith('data/elections/')&&!url.endsWith('/manifest.json')?url+'.gz':url;
    if (!cache.has(url)) cache.set(url, fetchSource(packed).catch(e => {cache.delete(url); throw e;}));
    return cache.get(url);
  }
  function portrait(c, size = '') {
    return `<span class="portrait ${escape(c.party || 'other')} ${size}" aria-hidden="true"><span>${escape(initials(c.name))}</span>${c.photo ? `<img src="${escape(c.photo)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" width="88" height="106">` : ''}</span>`;
  }
  function bindPortraits(container) {
    container.querySelectorAll('.portrait img').forEach(img => {
      const failed = () => {img.hidden = true; img.parentElement.classList.add('portrait-fallback');};
      img.addEventListener('error', failed, {once:true});
      if (img.complete && !img.naturalWidth) failed();
    });
  }
  function stateName(abbr) {return manifest?.states.find(s => s.abbr === abbr)?.name || abbr;}
  function official(abbr) {return manifest?.states.find(s => s.abbr === abbr)?.election_office || 'https://www.usa.gov/state-election-office';}
  function raceCard(r, directoryCard = false) {
    const previews = (r.preview || []).slice(0,3);
    return `<button class="race-card ${directoryCard ? 'directory-race' : ''}" data-race="${escape(r.id)}"><span class="race-card-top"><span>${escape(stateName(r.state))}</span><span class="race-kind">${escape(manifest.kinds[r.kind])}</span></span><span class="race-card-title">${escape(r.title)}<span aria-hidden="true">↗</span></span><span class="race-card-bottom"><span class="race-portraits">${previews.map(c => portrait(c,'small')).join('')}</span><span class="race-card-copy">${previews.length ? previews.slice(0,2).map(c => escape(c.name)).join(' · ') : 'Explore the source records'}<small>${number.format(r.general)} November records${r.total > r.general ? ` · ${number.format(r.total)} total` : ''}</small></span></span>${window.AtlasConnections?.raceSummary(r)||''}</button>`;
  }
  function bindRaces(container) {
    container.querySelectorAll('[data-race]').forEach(b => b.onclick = () => openRace(b.dataset.race, {navigate:true}));
    container.querySelectorAll('[data-candidate-targeting]').forEach(b=>b.onclick=()=>window.AtlasTargeting.openAccount(b.dataset.candidateTargeting));
    bindPortraits(container);
  }
  function coverage() {
    $('atlas-vitals').innerHTML = `<div><strong>${number.format(manifest.general_records)}</strong><span>NOVEMBER RECORDS</span></div><div><strong>${number.format(manifest.races)}</strong><span>SOURCED RACES</span></div>`;
    $('election-coverage').innerHTML = [['Candidate records',manifest.candidates],['November-associated records',manifest.general_records],['Races with source records',manifest.races],['Records with portrait links',manifest.photos],['Candidate–advertiser links',manifest.advertiser_links]].map(([k,v]) => `<div class="coverage-row"><span>${escape(k)}</span><b>${number.format(v)}</b></div>`).join('') + `<p>Roster refresh checked ${escape(String(manifest.as_of).slice(0,10))}. Counts refer to records, not unique people or a complete certified ballot.</p><div class="source-links">${manifest.sources.map(s => `<a href="${escape(s.url)}" target="_blank" rel="noopener">${escape(s.name)} ↗</a>`).join('')}<a href="data/elections/manifest.json" target="_blank" rel="noopener">Coverage and limitations (JSON) ↗</a></div>`;
  }
  async function ready() {
    if (!readyPromise) readyPromise = Promise.all([get('data/elections/manifest.json'),get('data/elections/race-index.json')]).then(([m,r]) => {
      manifest=m; races=r; raceByID=new Map(r.map(r => [r.id,r]));for(const race of r)if(race.geometry&&race.general>0)geometryRaces.set(race.kind+':'+race.geometry,race); coverage(); renderSidebar();
      if (selectedRace && raceByID.has(selectedRace)) openRace(selectedRace, {navigate:false,candidate:selectedCandidate});
      else if (selectedRace) {selectedRace=null; window.AtlasApp?.syncURL();}
    }).catch(e => {readyPromise=null; $('race-place-note').textContent=e.message; $('race-cards').innerHTML='<button id="retry-elections" class="show-more">Retry the election directory ↻</button>'; $('retry-elections').onclick=ready; throw e;});
    return readyPromise;
  }
  async function searchReady() {
    if (!searchPromise) searchPromise = get('data/elections/candidate-index.json').then(rows => {
      candidateIndex=rows.map(r => ({id:r[0],name:r[1],nameSearch:normalize(r[1]),state:r[2],kind:r[3],race:r[4],party:r[5],status:r[6],search:normalize(r[1]+' '+r[2]+' '+stateName(r[2])+' '+(raceByID.get(r[4])?.title||''))}));
      for (const c of candidateIndex) {if(!candidateByRace.has(c.race))candidateByRace.set(c.race,[]);candidateByRace.get(c.race).push(c);}
    }).catch(e => {searchPromise=null;throw e;});
    return searchPromise;
  }
  async function searchCandidates(query,limit=4) {
    await ready();await searchReady();const q=normalize(query),seen=new Set(),result=[];
    for(const c of candidateIndex.filter(c=>c.nameSearch.includes(q)).sort((a,b)=>(a.status==='general'?0:1)-(b.status==='general'?0:1))){const key=c.nameSearch+':'+c.race;if(seen.has(key))continue;seen.add(key);result.push({...c,label:raceByID.get(c.race)?.title||manifest.kinds[c.kind],stateLabel:stateName(c.state)});if(result.length>=limit)break;}return result;
  }
  async function stateDetails(abbr) {
    if(!stateCache.has(abbr))stateCache.set(abbr,get('data/elections/'+abbr+'.json').then(s => ({...s, candidatesByID:new Map(s.candidates.map(c => [c.id,c]))})).catch(e=>{stateCache.delete(abbr);throw e;}));
    return stateCache.get(abbr);
  }
  async function zipLegislatures(zip) {
    for(const kind of ['upper','lower']) {
      if(!legCache.has(kind))legCache.set(kind,get('data/state-'+kind+'.json.gz').then(d => new Map(d.zip_links.map(([id,links]) => [id,Array.isArray(links)?links:[links]]))).catch(error=>{legCache.delete(kind);throw error;}));
    }
    const maps=await Promise.all([...legCache.values()]); return maps.flatMap((m,i) => (m.get(zip)||[]).map(id => [i===0?'upper':'lower',id]));
  }
  function sidebarRaces(context) {
    const {state,data}=context;
    let list=races.filter(r => r.general>0 && (state.place==='US'||r.state===state.place));
    if(state.area) {
      const area=state.area;
      const common=['senate','governor','statewide'];
      if(area.type==='zip') {
        const zip=data?.zips.find(z=>z.id===area.id),houseIDs=new Set(zip?.districts.map(d=>d[0])||[]);
        const legIDs=new Set(); for(const kind of ['upper','lower']) {const m=legCache.get(kind);if(m instanceof Map)for(const id of m.get(area.id)||[])legIDs.add(id);}
        list=list.filter(r=>common.includes(r.kind)||r.kind==='house'&&houseIDs.has(r.geometry)||['upper','lower'].includes(r.kind)&&legIDs.has(r.geometry));
      }else list=list.filter(r=>common.includes(r.kind)||r.geometry===area.id && (r.kind===(area.type==='district'?'house':area.type)));
    }
    if(sideKind!=='all')list=list.filter(r=>sideKind==='local'?localKinds.has(r.kind):r.kind===sideKind);
    const featured = ['senate:TX','senate:GA','senate:MI','senate:NC','governor:AZ','governor:PA'];
    return list.sort((a,b)=>state.place==='US' && sideKind==='all' ? (featured.indexOf(a.id)<0?100:featured.indexOf(a.id))-(featured.indexOf(b.id)<0?100:featured.indexOf(b.id)) || order.indexOf(a.kind)-order.indexOf(b.kind) || a.state.localeCompare(b.state) : order.indexOf(a.kind)-order.indexOf(b.kind)||a.title.localeCompare(b.title,undefined,{numeric:true}));
  }
  function renderSidebar() {
    const context=ctx();if(!manifest||!context)return;
    const {state}=context,key=state.place+':'+JSON.stringify(state.area);
    if(key!==sideKey){sideKey=key;sideLimit=6;sideKind='all';}
    const name=state.area?.type==='zip'?'ZIP '+state.area.id:state.area ? raceByID.get([...raceByID.keys()].find(id=>raceByID.get(id).geometry===state.area.id))?.title||stateName(state.place) : state.place==='US'?'Across America':stateName(state.place);
    $('race-place-title').textContent=name;
    const list=sidebarRaces(context);
    window.AtlasConnections?.renderPlace(context,list.length);
    $('race-place-note').textContent=state.area?.type==='zip'?'Races linked to this ZIP area. Boundaries can overlap; check your official ballot.':state.area?'District and statewide races from the source records.':'Federal, state and local races. November records are listed first; source coverage varies.';
    const counts=new Map();
    for(const r of races.filter(r=>r.general>0&&(state.place==='US'||r.state===state.place))){const key=localKinds.has(r.kind)?'local':r.kind;counts.set(key,(counts.get(key)||0)+1);}
    const chips=[['all','All'],['senate','Senate'],['governor','Governor'],['house','US House'],['upper','State Senate'],['lower','State House'],['local','Local'],['statewide','Statewide'],['judicial','Courts']].filter(([k])=>k==='all'||counts.has(k));
    $('race-quick-filters').innerHTML='<label class="sr-only" for="race-kind-select">Filter races by office</label><select id="race-kind-select">'+chips.map(([k,t])=>`<option value="${k}" ${sideKind===k?'selected':''}>${escape(k==='all'?'All offices':t)}</option>`).join('')+'</select>';
    $('race-kind-select').onchange=e=>{sideKind=e.target.value;sideLimit=6;renderSidebar();};
    $('race-cards').innerHTML=list.length?list.slice(0,sideLimit).map(r=>raceCard(r)).join(''):`<div class="election-empty"><strong>No November records in this source view.</strong><p>Browse all 2026 records for earlier elections and filings, or check the election office’s candidate list.</p><button id="browse-earlier" class="text-button">Explore all 2026 records ↗</button></div>`;
    bindRaces($('race-cards'));
    if($('browse-earlier'))$('browse-earlier').onclick=()=>openDirectory(state.place,{stage:'all'});
    $('race-show-more').hidden=list.length<=sideLimit;
    $('race-show-more').textContent=`More races (${number.format(list.length-sideLimit)}) ↓`;
    $('official-ballot').href=official(state.place);
    if(state.area?.type==='zip' && !['upper','lower'].every(k=>legCache.get(k) instanceof Map)) {
      const id=state.area.id;zipLegislatures(id).then(()=>{for(const [k,p]of legCache)if(p instanceof Promise)p.then(m=>legCache.set(k,m));return Promise.all([...legCache.values()]);}).then(()=>{if(ctx()?.state.area?.id===id)renderSidebar();}).catch(()=>{});
    }
    renderInsights();
  }
  function drawerHeader(kicker,title,back=false) {
    return `<div class="drawer-header"><div>${back?'<button id="directory-back" class="drawer-back">← Race directory</button>':`<span class="section-kicker">${escape(kicker)}</span>`}<h2 id="drawer-title">${escape(title)}</h2></div><button id="close-election" class="icon-button" aria-label="Close election details">×</button></div>`;
  }
  function showDrawer(mode) {
    const drawer=$('election-drawer');if(drawer.hidden){returnFocus=document.activeElement;returnScroll=scrollY;if(innerWidth<=800)window.scrollTo({top:0,behavior:'instant'});}
    drawer.hidden=false;drawerMode=mode;document.body.classList.add('elections-open');document.documentElement.classList.add('elections-open');document.body.style.setProperty('--drawer-width',drawer.offsetWidth+'px');window.AtlasApp?.reframe();
    $('method-panel').hidden=true;document.querySelectorAll('.method-toggle').forEach(b=>b.setAttribute('aria-expanded','false'));
  }
  function closeDrawer() {
    drawerRevision++;$('election-drawer').hidden=true;document.body.classList.remove('elections-open');document.documentElement.classList.remove('elections-open');drawerMode=null;selectedRace=null;selectedCandidate=null;window.AtlasApp?.syncURL();window.AtlasApp?.reframe();if(innerWidth<=800)window.scrollTo({top:returnScroll,behavior:'instant'});returnFocus?.focus({preventScroll:true});
  }
  function commonDrawer() {
    $('close-election').onclick=closeDrawer;
    if($('directory-back'))$('directory-back').onclick=()=>openDirectory(directory.place,{preserve:true});
    $('close-election').focus({preventScroll:true});
  }
  async function openDirectory(place='US', options={}) {
    showDrawer('directory');selectedRace=null;selectedCandidate=null;window.AtlasApp?.syncURL();const version=++drawerRevision;
    $('election-drawer').innerHTML=drawerHeader('THE 2026 ELECTION DIRECTORY','Find your next story.')+'<div class="drawer-loading"><span class="spinner"></span> Opening the national directory…</div>';commonDrawer();
    try {
      await ready();await searchReady();if(version!==drawerRevision)return;
      if(!options.preserve)directory={place,kind:'all',party:'all',stage:options.stage||'general',query:'',limit:40};
      $('election-drawer').innerHTML=drawerHeader('THE 2026 ELECTION DIRECTORY','Find your next story.')+`<p class="directory-intro">From Congress to the county courthouse. Search candidates, compare races, and follow the source.</p><div class="directory-stats"><div><b>${number.format(manifest.general_records)}</b><span>November records</span></div><div><b>${number.format(manifest.races)}</b><span>Sourced races</span></div><div><b>${number.format(manifest.photos)}</b><span>Portrait links</span></div></div><div class="directory-filters"><label class="directory-search"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg><input id="candidate-search" type="search" placeholder="Candidate, race, or district…" aria-label="Search candidates and races" autocomplete="off" value="${escape(directory.query)}"><kbd>/</kbd></label><div class="directory-selects"><label>PLACE<select id="directory-state"><option value="US">All states &amp; territories</option>${manifest.states.map(s=>`<option value="${s.abbr}" ${s.abbr===directory.place?'selected':''}>${escape(s.name)}</option>`).join('')}</select></label><label>OFFICE<select id="directory-kind"><option value="all">All offices</option>${order.map(k=>`<option value="${k}" ${k===directory.kind?'selected':''}>${escape(manifest.kinds[k])}</option>`).join('')}</select></label><label>PARTY<select id="directory-party"><option value="all">All parties</option>${Object.entries(parties).map(([k,t])=>`<option value="${k}" ${k===directory.party?'selected':''}>${escape(t)}</option>`).join('')}</select></label></div><div class="directory-stage"><label><input type="radio" name="directory-stage" value="general" ${directory.stage==='general'?'checked':''}> November records</label><label><input type="radio" name="directory-stage" value="all" ${directory.stage==='all'?'checked':''}> All 2026 records</label></div></div><div class="directory-result-heading"><span id="directory-result-count" aria-live="polite"></span><button id="download-directory" class="text-button">CSV ↓</button></div><div id="directory-results" class="directory-results"></div><button id="directory-more" class="show-more" hidden>Load more races ↓</button><div class="directory-source-note"><strong>Know what you’re looking at.</strong><p>November records are source-listed election associations. Filings and earlier primary records have separate labels. Local coverage varies. This directory is not a certified personal ballot.</p><button id="directory-sources" class="text-button">Sources &amp; coverage ↗</button></div>`;
      commonDrawer();let searchTimer;
      $('candidate-search').oninput=e=>{directory.query=e.target.value;directory.limit=40;clearTimeout(searchTimer);searchTimer=setTimeout(renderDirectory,50);};
      for(const key of ['state','kind','party'])$('directory-'+key).onchange=e=>{directory[key==='state'?'place':key]=e.target.value;directory.limit=40;renderDirectory();};
      document.querySelectorAll('[name=directory-stage]').forEach(b=>b.onchange=()=>{directory.stage=b.value;directory.limit=40;renderDirectory();});
      $('directory-more').onclick=()=>{directory.limit+=40;renderDirectory();};
      $('download-directory').onclick=()=>downloadCandidates(directoryCandidates(),'midterms-directory.csv');
      $('directory-sources').onclick=openSources;
      renderDirectory();$('candidate-search').focus({preventScroll:true});
    } catch(e) {if(version!==drawerRevision)return;$('election-drawer').innerHTML=drawerHeader('ELECTION DIRECTORY','The directory is unavailable.')+`<div class="election-empty"><p>${escape(e.message)}</p><button id="retry-directory" class="show-more">Retry ↻</button></div>`;commonDrawer();$('retry-directory').onclick=()=>openDirectory(place,options);}
  }
  function directoryCandidates() {
    const q=normalize(directory.query),tokens=q.split(' ').filter(Boolean);
    return (candidateIndex||[]).filter(c=>
      (directory.place==='US'||c.state===directory.place)&&(directory.kind==='all'||c.kind===directory.kind)&&(directory.party==='all'||c.party===directory.party)&&(directory.stage==='all'||c.status==='general')&&
      (!q||tokens.every(t=>c.search.includes(t)))
    );
  }
  function renderDirectory() {
    if(drawerMode!=='directory'||!$('directory-results'))return;
    const matches=directoryCandidates(),grouped=new Map();for(const c of matches){if(!grouped.has(c.race))grouped.set(c.race,[]);grouped.get(c.race).push(c);}const ids=new Set(grouped.keys()),list=races.filter(r=>ids.has(r.id)).sort((a,b)=>a.state.localeCompare(b.state)||order.indexOf(a.kind)-order.indexOf(b.kind)||a.title.localeCompare(b.title,undefined,{numeric:true}));
    $('directory-result-count').textContent=`${number.format(matches.length)} records · ${number.format(list.length)} races`;
    $('directory-results').innerHTML=list.slice(0,directory.limit).map(r=>{
      const records=grouped.get(r.id),names=records.slice(0,4).map(c=>escape(c.name)).join(' · ');
      return `<button class="directory-row" data-race="${escape(r.id)}"><span class="directory-row-state">${escape(r.state)}</span><span class="directory-row-main"><strong>${escape(r.title)}</strong><span>${names}${records.length>4?' +'+number.format(records.length-4):''}</span><small>${escape(manifest.kinds[r.kind])} · ${number.format(records.length)} ${directory.stage==='all'?'2026':'November'} records${!r.geometry?' · no district boundary linked':''}</small></span><span class="directory-row-arrow" aria-hidden="true">↗</span></button>`;
    }).join('')||'<div class="election-empty"><strong>No records match these filters.</strong><p>Try a shorter name, another office, or all 2026 records. The source may not yet cover this race.</p></div>';
    bindRaces($('directory-results'));$('directory-more').hidden=list.length<=directory.limit;
    if(list.length>directory.limit)$('directory-more').textContent=`Load more · ${number.format(list.length-directory.limit)} races remaining ↓`;
  }
  function candidateCard(c) {
    const finance=c.finance,f=finance&&Number.isFinite(finance.receipts)&&!finance.period_after_retrieval;
    const source=c.ballot_source||c.roster_source||c.nga_source||c.listing_source||c.source;
    return `<article tabindex="-1" class="candidate-card ${escape(c.party)}" id="candidate-${escape(c.id).replace(/[^a-zA-Z0-9_-]/g,'-')}"><div class="candidate-card-header">${portrait(c,'large')}<div class="candidate-identity"><span class="candidate-party"><i class="party-dot ${escape(c.party)}"></i>${escape(c.party_label||parties[c.party])}${c.incumbent?' · Incumbent in source':''}</span><h3>${escape(c.name)}</h3><span class="candidate-status ${c.status==='general'?'status-general':''}">${escape(c.certified?'Official list · November 3':c.roster_corroborated?'Current roster · November 3':statuses[c.status]||'Source record')}</span>${c.write_in?'<small class="candidate-date">Declared write-in in source · may not be printed on the ballot</small>':''}${c.dates?.length?`<small class="candidate-date">Source election date${c.dates.length>1?'s':''}: ${c.dates.slice().sort().map(escape).join(' · ')}</small>`:''}</div></div>${f?`<div class="candidate-finance"><div><span>RECEIPTS</span><b>${escape(compact(finance.receipts))}</b></div><div><span>SPENT</span><b>${escape(compact(finance.disbursements))}</b></div><div><span>CASH ON HAND</span><b>${escape(compact(finance.cash))}</b></div></div><p class="finance-note">FEC cumulative cycle summary · through ${escape(finance.through_iso||finance.through)} · receipts can include committee transfers${finance.debt>0?' · '+escape(compact(finance.debt))+' reported debt':''}.</p>`:finance?.period_after_retrieval?`<p class="finance-note">Source finance period ends ${escape(finance.through_iso)}, after the atlas retrieval date. Totals are withheld pending verification; follow the FEC record below.</p>`:''}<p class="finance-note">${c.source_observed_at?'Candidate source observed '+escape(c.source_observed_at.slice(0,10)):c.source_refresh==='retained manual import'?'Retained manual import · observation date unavailable':'Source observation date varies; follow the record source'}.</p><div class="candidate-platform-data" data-platform-candidate="${escape(c.id)}">${window.AtlasPlatforms?.candidateMetrics(c)||''}</div><details class="candidate-meta-evidence"><summary>Meta source accounts &amp; identity evidence</summary><div class="candidate-media-data" data-meta-candidate="${escape(c.id)}">${window.AtlasConnections?.candidateMetrics(c)||''}</div></details><div class="candidate-links">${!c.advertiser?`<a href="https://www.facebook.com/ads/library/?active_status=all&amp;ad_type=political_and_issue_ads&amp;country=US&amp;q=${escape(encodeURIComponent(c.name))}" target="_blank" rel="noopener">Search Meta ads ↗</a>`:''}${c.campaign?`<a href="${escape(c.campaign)}" target="_blank" rel="noopener">Campaign website ↗</a>`:''}${c.profile?`<a href="${escape(c.profile)}" target="_blank" rel="noopener">Candidate profile ↗</a>`:''}${c.fec?`<a href="https://www.fec.gov/data/candidate/${escape(c.fec)}/?cycle=2026" target="_blank" rel="noopener">FEC record ↗</a>`:''}${source?`<a href="${escape(source)}" target="_blank" rel="noopener">${c.certified?'Official candidate source':c.roster_source?'Current roster source':c.nga_source?'NGA listing':c.listing_source?'Provider listing':'Record source'} ↗</a>`:''}</div></article>`;
  }
  async function openRace(id,{navigate=false,candidate=null}={}) {
    await ready();const r=raceByID.get(id);if(!r)return;
    selectedRace=id;selectedCandidate=candidate;previousRace=id;showDrawer('race');const version=++drawerRevision;
    $('election-drawer').innerHTML=drawerHeader('RACE PROFILE',r.title,true)+'<div class="drawer-loading"><span class="spinner"></span> Gathering candidate records…</div>';commonDrawer();window.AtlasApp?.syncURL();
    if(navigate&&ctx()?.manifest.states.some(s=>s.abbr===r.state)) {
      const geography={house:'district',upper:'upper',lower:'lower'}[r.kind]||'state';
      const state=ctx()?.state,resetCampaign=!!(state?.campaignRace||state?.platformRace||state?.pageID||state?.platformAccount||state?.targetMap);
      window.AtlasApp.navigate({place:r.state,geography,area:r.geometry?{type:geography,id:r.geometry}:null,tab:'races',resetCampaign});
    }
    try {
      const detail=await stateDetails(r.state);if(version!==drawerRevision)return;
      const records=(detail.races.find(v=>v.id===r.id)?.candidates||[]).map(id=>detail.candidatesByID.get(id)).filter(Boolean).sort((a,b)=>(a.status==='general'?0:1)-(b.status==='general'?0:1)||(a.write_in?1:0)-(b.write_in?1:0)||a.name.localeCompare(b.name));
      const general=records.filter(c=>c.status==='general'),earlier=records.filter(c=>c.status!=='general');
      $('election-drawer').innerHTML=drawerHeader('RACE PROFILE',r.title,true)+`<p class="profile-selection-note">Viewing this race profile. Advertising filters are shown in the selection trail above.</p><div class="race-profile-meta"><span>${escape(stateName(r.state))} · ${escape(manifest.kinds[r.kind])}</span><span class="election-day-mark">03 <span>NOV<br>2026</span></span></div><div class="race-profile-tools">${r.geometry?'<button id="race-on-map" class="race-map-button">Locate this district ↗</button>':'<span>State view · no district boundary linked</span>'}<button id="download-race" class="text-button">Candidate CSV ↓</button></div><div class="candidate-section-title"><h3>November field</h3><span>${number.format(general.length)} source records</span></div>${window.AtlasReadiness?.raceEvidence(r.id)||''}<p class="race-coverage-note">These records are associated with the general election by their sources. Check the official list for ballot qualification and recent changes.</p><div class="candidate-grid">${general.map(candidateCard).join('')||'<div class="election-empty"><strong>No November candidate records linked yet.</strong><p>Earlier profiles and FEC filings are available below. They do not establish the final ballot.</p></div>'}</div>${earlier.length?`<details class="earlier-candidates" ${!general.length?'open':''}><summary><span>Other 2026 records</span><span>${number.format(earlier.length)} profiles &amp; filings</span></summary><p>Earlier elections, withdrawals, and unconfirmed federal filings remain visible for research. They are not presented as November nominees.</p><div id="earlier-list" class="candidate-grid"></div><button id="earlier-more" class="show-more" hidden>More records ↓</button></details>`:''}<a class="official-race-link" href="${escape(official(r.state))}" target="_blank" rel="noopener"><span><strong>Verify with ${escape(stateName(r.state))}’s election office</strong><small>Official ballot, candidate list, registration and voting information</small></span><span aria-hidden="true">↗</span></a><div class="race-profile-footnote">Roster refresh checked ${escape(String(manifest.as_of).slice(0,10))}. Portraits come from public candidate records; missing images use initials. Campaign finances are reported FEC totals, separate from advertising estimates.</div>`;
      commonDrawer();$('download-race').onclick=()=>downloadCandidates(records,'midterms-'+r.id.replace(/:/g,'-')+'.csv');
      const mapRace=async()=>{window.AtlasSelection?.clearActors();const geography={house:'district',upper:'upper',lower:'lower'}[r.kind]||'state';await window.AtlasApp.navigate({place:r.state,geography,area:r.geometry?{type:geography,id:r.geometry}:null,tab:'races'});if(innerWidth<900)closeDrawer();};
      if($('race-on-map'))$('race-on-map').onclick=mapRace;
      let earlierLimit=8;
      const renderEarlier=()=>{if(!$('earlier-list'))return;$('earlier-list').innerHTML=earlier.slice(0,earlierLimit).map(candidateCard).join('');$('earlier-more').hidden=earlier.length<=earlierLimit;bindCandidateActions($('earlier-list'));};
      if(earlier.length){renderEarlier();$('earlier-more').onclick=()=>{earlierLimit+=12;renderEarlier();};}
      bindCandidateActions($('election-drawer'));
      const tools=$('election-drawer').querySelector('.race-profile-tools');if(tools){const section=document.createElement('section');section.id='race-campaign-data';section.className='race-campaign-data';section.setAttribute('aria-label','Matched campaign advertising');tools.after(section);window.AtlasConnections?.showRace(r,records);}
      if(candidate)selectCandidate(candidate);window.AtlasApp?.syncURL();
    } catch(e) {if(version!==drawerRevision)return;$('election-drawer').innerHTML=drawerHeader('RACE PROFILE',r.title,true)+`<div class="election-empty"><p>${escape(e.message)}</p><button id="retry-race" class="show-more">Reload this race ↻</button></div>`;commonDrawer();$('retry-race').onclick=()=>openRace(id);}
  }
  function selectCandidate(id) {
    const target=document.getElementById('candidate-'+String(id).replace(/[^a-zA-Z0-9_-]/g,'-'));if(!target)return;
    selectedCandidate=id;
    document.querySelectorAll('.candidate-card').forEach(card=>{const selected=card===target;card.classList.toggle('candidate-selected',selected);if(selected)card.setAttribute('aria-current','true');else card.removeAttribute('aria-current');});
    target.scrollIntoView({block:'start',behavior:'instant'});target.focus({preventScroll:true});window.AtlasApp?.syncURL();
  }
  function bindCandidateActions(container) {
    container.querySelectorAll('[data-candidate-targeting]').forEach(b=>b.onclick=()=>window.AtlasTargeting.openAccount(b.dataset.candidateTargeting));
    bindPortraits(container);window.AtlasPlatforms?.bindAccounts(container);container.querySelectorAll('[data-candidate-ad]').forEach(b=>b.onclick=()=>{const id=b.dataset.candidateAd;closeDrawer();window.AtlasApp.focusAdvertiser(id);});
  }
  function downloadCandidates(rows,filename) {
    rows=rows.map(c=>({...c,...window.AtlasConnections?.annotateCandidate(c),...window.AtlasPlatforms?.annotateCandidate(c),source:c.ballot_source||c.roster_source||c.nga_source||c.listing_source||c.source,as_of:manifest.as_of,atlas_record:new URL('data/elections/'+c.state+'.json.gz',location.href).href}));const full=rows.some(c=>c.dates);const keys=['id','name','state','kind','race','party','status',...(full?['dates','fec','advertiser','source','meta_accounts','meta_match','meta_snapshot','meta_spend_7d_usd','meta_spend_30d_usd','fec_receipts','fec_disbursements','fec_cash_on_hand','fec_through','committee','google_accounts','google_complete_2026_weeks_usd','google_reporting_dates','snapchat_accounts','snapchat_campaign_to_date_usd']:[]),'as_of','atlas_record'];
    const csv=[keys.join(','),...rows.map(c=>keys.map(k=>{let value=c[k]??'';if(Array.isArray(value))value=value.join('; ');if(/^[=+@-]/.test(String(value)))value="'"+value;return '"'+String(value).replace(/"/g,'""')+'"';}).join(','))].join('\r\n');
    const url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function openSources() {
    showDrawer('sources');selectedRace=null;selectedCandidate=null;window.AtlasApp?.syncURL();drawerRevision++;
    $('election-drawer').innerHTML=drawerHeader('THE EVIDENCE BEHIND THE ATLAS','Every record has context.',true)+`<p class="directory-intro">Election records and advertising estimates answer different questions. Their source dates, coverage, and limitations stay visible.</p><div class="election-source-list">${manifest.sources.map((s,i)=>`<a href="${escape(s.url)}" target="_blank" rel="noopener"><span>${String(i+1).padStart(2,'0')}</span><strong>${escape(s.name)}</strong><span>↗</span></a>`).join('')}</div><h3 class="source-section-title">What this directory can tell you</h3><ul class="coverage-limits">${manifest.limits.map(t=>`<li>${escape(t)}</li>`).join('')}</ul><p class="race-profile-footnote">Roster refresh checked ${escape(String(manifest.as_of).slice(0,10))}. Public record fields are retained; private contact details are excluded from the atlas.</p><a href="data/elections/manifest.json" class="text-button" target="_blank" rel="noopener">Download the coverage manifest ↗</a>`;commonDrawer();
  }
  function renderInsights() {
    const context=ctx();if(!context?.current)return;
    if(context.state.platform!=='meta'){window.AtlasPlatforms?.renderInsights();return;}
    const {current,state,manifest:adManifest}=context,population=window.AtlasPopulation,perResident=state.units==='capita';
    const rank=current.national.map(r=>({...r,total:r.values.reduce((n,v)=>n+v,0),population:population.get('state',r.id)})).map(r=>({...r,score:perResident?population.rate(r.total,r.population):r.total})).sort((a,b)=>b.score-a.score),sum=rank.reduce((n,r)=>n+r.total,0),max=rank[0]?.score||1;
    const displayed=(value,pop)=>perResident?population.format(value,pop):compact(value);
    const rows=rank.slice(0,8).map((r,i)=>{const s=adManifest.states.find(s=>s.id===r.id);return `<button class="insight-state" data-insight-state="${s.abbr}"><span class="insight-state-top"><span><small>${String(i+1).padStart(2,'0')}</small>${escape(s.name)}</span><b>${displayed(r.total,r.population)}</b></span><span class="insight-bar" style="width:${r.score/max*100}%">${r.values.map((v,j)=>`<i style="flex:${v};background:${['#2054b3','#c84037','#80733b','#99a3b2'][j]}"></i>`).join('')}</span></button>`;}).join('');
    const audit=adManifest.audit[state.period];
    $('insight-content').innerHTML=`<div class="insight-total"><span>GEOGRAPHIC ALLOCATION · ${state.period} DAYS</span><strong>≈ ${displayed(sum,population.get('country'))}</strong><p>Across all states, under your current advertiser and targeting filters${perResident?', divided by 2020 ACS residents':''}. This is a modelled allocation, not observed delivery.</p></div><div class="insight-heading"><h3>${perResident?'State spending per resident':'The largest state estimates'}</h3><span>${perResident?'USD / RESIDENT':'USD'}</span></div>${rows}<div class="insight-context"><h3>The part we can see.</h3><div><strong>${displayed(audit.reported_spend,population.get('country'))}</strong><span>Reported USD account spend${perResident?' per resident':''}, all source accounts</span></div><div><strong>${displayed(audit.nationwide_budget,population.get('country'))}</strong><span>Allocated to nationwide criteria${perResident?' per resident':''}, all source accounts${state.nationwide?' · model included':' · excluded from the default map'}</span></div><p>Fundraising, persuasion and mobilisation cannot be separated from advertiser-level geography alone.</p></div><button id="insight-directory" class="insight-directory"><span>Put names to the map.</span><strong>Explore the election field ↗</strong></button>`;
    $('insight-content').querySelectorAll('[data-insight-state]').forEach(b=>b.onclick=()=>window.AtlasApp.navigate({place:b.dataset.insightState,tab:'insights'}));$('insight-directory').onclick=()=>openDirectory(state.place);
  }
  function tooltipFor(kind,id) {
    if(!manifest)return '';const type=kind==='district'?'house':kind;
    const r=geometryRaces.get(type+':'+id);if(!r)return '';return `<div class="tooltip-race"><span>${r.general} November candidate records</span><strong>${(r.preview||[]).slice(0,2).map(c=>escape(c.name)).join(' · ')}</strong><small>Click the map to explore the race.</small></div>`;
  }
  let lastNavigator;
  function updateNavigator(rows,view,party) {
    if(rows)lastNavigator={rows,view,party};else if(lastNavigator)({rows,view,party}=lastNavigator);else return;
    const fills=$('navigator-svg').querySelectorAll('[data-nav-fill]');if(!fills.length)return;
    const max=Math.max(.000001,...rows.map(r=>r.values.reduce((s,v)=>s+v,0)));
    for(const p of fills){const r=rows.find(r=>r.id===p.dataset.navFill),v=r?.values||[0,0,0,0],total=v.reduce((s,v)=>s+v,0),balance=v[0]+v[1]?(v[0]-v[1])/(v[0]+v[1]):0;
      const colours=view==='balance'?['#c84037','#e8917e','#f3d2c8','#e9ecf0','#bdcfea','#729ce0','#1d56b8']:party==='dem'?['#e5eaf1','#c3d4e9','#96b6d7','#6594c1','#315f92']:party==='rep'?['#f2e6d8','#e4c6a8','#d9a481','#c77d58','#a85132']:['#e8effa','#c6d6f0','#8dacdd','#4e79c1','#2054b3'];
      p.style.fill=total===0?'#e6eaf0':view==='balance'?colours[Math.max(0,Math.min(6,Math.round((balance+1)*3)))]:colours[Math.min(4,Math.floor(total/max*5))];
      p.parentElement.classList.toggle('navigator-selected',p.parentElement.dataset.navState===ctx()?.state.place);
    }
  }
  async function navigator() {
    try {const r=await fetch('assets/national-navigator.svg');if(!r.ok)throw Error();$('navigator-svg').innerHTML=await r.text();$('navigator-svg').querySelectorAll('[data-nav-state]').forEach(a=>a.onclick=e=>{e.preventDefault();window.AtlasApp?.navigate({place:a.dataset.navState});});updateNavigator();}
    catch {$('navigator-svg').innerHTML='<span class="navigator-fallback">Use the place selector to explore every state.</span>';}
  }
  window.AtlasElections={ready,selectCandidate,get selectedCandidate(){return selectedCandidate;},clearCandidate:()=>{selectedCandidate=null;document.querySelectorAll('.candidate-selected').forEach(card=>{card.classList.remove('candidate-selected');card.removeAttribute('aria-current');});window.AtlasApp?.syncURL();},get selectedRace(){return selectedRace;},getRace:id=>raceByID.get(id),searchCandidates,bindCandidateActions,closeDrawer,tooltipFor,updateNavigator,openRace,openDirectory};
  document.querySelectorAll('[data-tab]').forEach(b=>{b.onclick=()=>window.AtlasApp?.setTab(b.dataset.tab);b.onkeydown=e=>{const tabs=[...document.querySelectorAll('[data-tab]')];let i=tabs.indexOf(b);if(e.key==='ArrowRight')i=(i+1)%tabs.length;else if(e.key==='ArrowLeft')i=(i-1+tabs.length)%tabs.length;else if(e.key==='Home')i=0;else if(e.key==='End')i=tabs.length-1;else return;e.preventDefault();tabs[i].focus();window.AtlasApp?.setTab(tabs[i].dataset.tab);};});
  $('open-directory').onclick=()=>openDirectory('US');$('browse-place').onclick=()=>openDirectory(ctx()?.state.place||'US');
  $('race-show-more').onclick=()=>{sideLimit+=6;renderSidebar();};$('navigator-reset').onclick=()=>window.AtlasApp?.navigate({place:'US'});
  document.addEventListener('atlas:selection',()=>{renderSidebar();updateNavigator();});
  document.addEventListener('atlas:relationships',renderSidebar);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('election-drawer').hidden)closeDrawer();if(e.key==='/'&&drawerMode==='directory'&&!['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)){e.preventDefault();$('candidate-search')?.focus();}});
  document.querySelectorAll('.method-toggle').forEach(b=>b.addEventListener('click',()=>{if(!$('election-drawer').hidden)closeDrawer();}));
  const start=()=>{navigator();ready().catch(()=>{});};
  if(window.AtlasApp)start();else document.addEventListener('atlas:boot',start,{once:true});
})();
