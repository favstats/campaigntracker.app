'use strict';
(() => {
  const $=id=>document.getElementById(id),context=()=>window.AtlasApp?.getContext();
  const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const platforms={overall:'Overall spending',meta:'Meta',google:'Google',snapchat:'Snapchat',reddit:'Reddit',x:'X'};
  const parties={dem:'Democratic',rep:'Republican',other:'Other affiliations'};
  let stamp='',announcement='',timer,accountNames=new Map(),nameRequest=0;
  function clearActors() {
    const s=context()?.state;if(!s)return;
    Object.assign(s,{pageID:null,campaignRace:null,campaignTitle:null,campaignPages:null,platformAccount:null,platformRace:null,platformAccounts:null,targetCriterion:null,audienceAccount:null,targetMap:false,targetMapPages:null,targetMapLabel:null,targetQuery:''});
  }
  function preparePlace(place) {
    const s=context()?.state;if(!s||place===s.place)return;
    const race=window.AtlasElections?.getRace(s.campaignRace||s.platformRace);
    if(race&&race.state!==place){Object.assign(s,{campaignRace:null,campaignTitle:null,campaignPages:null,platformRace:null,platformAccounts:null});}
    Object.assign(s,{targetCriterion:null,audienceAccount:null});
    if(s.targetMap)Object.assign(s,{targetMap:false,targetMapPages:null,targetMapLabel:null});
  }
  async function clear(kind) {
    const c=context();if(!c)return;const s=c.state;
    if(kind==='race')Object.assign(s,{campaignRace:null,campaignTitle:null,campaignPages:null,platformRace:null,platformAccounts:null});
    if(kind==='account')Object.assign(s,{pageID:null,platformAccount:null});
    if(kind==='party')s.party='all';
    if(kind==='query')s.targetQuery='';
    if(kind==='nonpolitical')s.includeNonPolitical=false;
    if(kind==='extras')s.audienceExtras=false;
    if(kind==='unclassified')s.untagged=false;
    if(kind==='criterion-map')Object.assign(s,{targetMap:false,targetMapPages:null,targetMapLabel:null});
    if(kind==='inspection-account'){window.AtlasAudience?.dismissAccount();return;}
    if(kind==='inspection'){if(s.audienceView==='flows')window.AtlasAudience?.setView('network');window.AtlasAudience?.clear();return;}
    if(kind==='candidate'){window.AtlasElections?.clearCandidate();return;}
    if(kind==='profile'){window.AtlasElections?.closeDrawer();return;}
    if(kind==='filters'){if(s.audienceView==='flows')window.AtlasAudience?.setView('network');clearActors();Object.assign(s,{party:'all',includeNonPolitical:false,audienceExtras:false,untagged:s.platform!=='meta'});window.AtlasElections?.closeDrawer();}
    await window.AtlasApp.refresh();
  }
  const chip=(kind,label,action,title)=>`<span class="selection-chip ${kind}"><span>${escape(label)}</span><button type="button" data-selection-clear="${action}" aria-label="${escape(title||'Clear '+label)}" title="${escape(title||'Clear '+label)}">×</button></span>`;
  function accountName(id,c){return c.current?.rows?.find(a=>a.id===id)?.name||c.catalog.find(a=>a.id===id||'meta:'+a.id===id)?.name||accountNames.get(id)||'Selected '+(platforms[id?.split(':')[0]]||'ad')+' account';}
  function sync() {
    const c=context();if(!c)return;const s=c.state;
    const place=c.manifest.states.find(v=>v.abbr===s.place)?.name||'United States';
    const area=s.area?window.AtlasApp.areaInfo().title:null;
    const open=s.tab==='targeting'&&s.audienceView!=='map';
    const raceID=s.campaignRace||s.platformRace,race=raceID?window.AtlasElections?.getRace(raceID):null;
    const account=s.pageID||s.platformAccount;
    const detail=window.AtlasTargeting?.result?.detail;
    const criterion=s.targetCriterion?(detail?.id===s.targetCriterion?detail.label:window.AtlasAudience?.report?.visual?.flow?.id===s.targetCriterion?window.AtlasAudience.report.visual.flow.label:s.targetMapLabel||'Selected audience criterion'):null;
    const profileID=window.AtlasElections?.selectedRace,profile=profileID?window.AtlasElections?.getRace(profileID):null;
    const filters=[];
    if(raceID)filters.push(chip('race','Campaigns: '+(race?.title||s.campaignTitle||raceID),'race','Show all campaigns in this place'));
    if(account)filters.push(chip('account','Advertiser: '+accountName(account,c),'account','Show all advertisers in this place'));
    if(s.party!=='all')filters.push(chip('party '+s.party,parties[s.party],'party','Show all selected affiliations'));
    if(s.targetMap)filters.push(chip('criterion','Advertisers using: '+(criterion||'selected criterion'),'criterion-map','Remove criterion filter from the map'));
    if(s.tab==='targeting'&&s.targetQuery)filters.push(chip('query','Search: '+s.targetQuery,'query','Clear audience search'));
    if(s.includeNonPolitical)filters.push(chip('audit','Nonpolitical accounts included','nonpolitical'));
    if(open&&s.audienceExtras)filters.push(chip('audit','Other + unclassified included','extras'));
    if(!open&&s.platform==='meta'&&s.untagged)filters.push(chip('audit','Unclassified included','unclassified'));
    const inspections=[];
    if(profile)inspections.push(chip('profile','Race profile: '+profile.title,'profile','Close race profile; keep data filters'));
    const candidate=document.querySelector('#election-drawer .candidate-selected h3')?.textContent;
    if(profile&&candidate)inspections.push(chip('profile','Candidate: '+candidate,'candidate','Clear candidate highlight; keep race profile'));
    const group=window.AtlasAudience?.inspectedGroup;
    if(open&&group)inspections.push(chip('inspection',group.count+' remaining '+(parties[group.party]||'other')+' advertisers','inspection-account','Close grouped advertiser inspection; keep flow'));
    if(s.tab==='targeting'&&(criterion||s.audienceAccount)){
      if(criterion)inspections.push(chip('inspection','Criterion: '+criterion,'inspection','Close audience inspection; keep data filters'));
      if(s.audienceAccount)inspections.push(chip('inspection','Advertiser: '+accountName(s.audienceAccount,c),'inspection-account','Close advertiser inspection; keep criterion and data filters'));
    }
    const lens=open?'Meta audience data':platforms[s.platform];
    const affiliation=open?(s.party==='all'?(s.audienceExtras?'All affiliations':'Democratic + Republican'):parties[s.party]):s.party==='all'?'All affiliations':parties[s.party];
    const covered=s.platform==='overall'&&!open?' ('+s.overallSources.map(id=>platforms[id]).join(' + ')+')':'';
    const estimated=['overall','meta'].includes(s.platform)||['google','snapchat'].includes(s.platform)&&s.platformMetric==='estimate';
    const period=estimated?s.period+' days':s.platform==='google'?(s.platformMetric==='spend'?'All archive dates':s.platformWindow==='year'?'Ads served in 2026':'Ads served in past 30 days'):s.platform==='snapchat'?'2026 campaign totals':s.platform==='reddit'?'June–July disclosure':'Spending unavailable';
    const measure=s.tab==='targeting'&&s.targetMode==='exclusions'?'Accounts reporting exclusions':!open&&!estimated&&s.platformMetric==='footprint'?'Advertiser counts':s.units==='capita'?'USD per resident':s.targetScale==='share'&&open&&s.audienceView!=='flows'?'Party budget share':open?'Associated USD':estimated?'Estimated USD':'Reported USD';
    const settings=[lens+covered,affiliation,period,estimated?s.date||'Latest snapshot':null,measure];
    if(open)settings.push(s.targetMode==='exclusions'?'Reported exclusions':'Included targets');
    if(!open)settings.push(({zip:'ZIP areas',district:'US House districts',upper:'State Senate districts',lower:'State House districts',state:'States'})[s.geography]);
    if(estimated)settings.push(s.nationwide?'Nationwide model included':'Nationwide targets excluded');
    const next=JSON.stringify([place,area,filters,inspections,settings]);
    if(next!==stamp){
      stamp=next;
      const crumbs=[s.place==='US'?'<strong aria-current="location">United States</strong>':'<button type="button" data-selection-place="US" title="Show the United States; retain advertiser filters">United States</button>'];
      if(s.place!=='US')crumbs.push(area?`<button type="button" data-selection-place="${escape(s.place)}" title="Show all of ${escape(place)}; retain advertiser filters">${escape(place)}</button>`:`<strong aria-current="location">${escape(place)}</strong>`);
      if(area)crumbs.push(`<strong aria-current="location">${escape(area)}</strong>`);
      $('selection-place').innerHTML=crumbs.join('<span class="selection-chevron" aria-hidden="true">›</span>');
      $('selection-filters').innerHTML=filters.join('');
      $('selection-inspection').hidden=!inspections.length;
      $('selection-inspection').innerHTML=inspections.length?'<span class="selection-label">INSPECTING</span>'+inspections.join(''):'';
      $('selection-context').textContent=settings.filter(Boolean).join(' · ');
      $('selection-clear').hidden=!filters.length&&!inspections.length;$('selection-clear').textContent=filters.length?'Clear filters':'Close inspections';
      $('reset').hidden=!filters.length&&!inspections.length;$('reset').textContent=filters.length?'Clear filters':'Close inspections';
      document.querySelectorAll('[data-selection-clear]').forEach(b=>b.onclick=()=>clear(b.dataset.selectionClear));
      document.querySelectorAll('[data-selection-place]').forEach(b=>b.onclick=()=>window.AtlasApp.navigate({place:b.dataset.selectionPlace}));
      const message='Data scope: '+[place,area,...filters.map(v=>v.replace(/<[^>]+>/g,'').replace(/×$/,''))].filter(Boolean).join(', ')+'. '+$('selection-context').textContent+(inspections.length?'. Inspecting: '+$('selection-inspection').textContent:'');
      if(message!==announcement){announcement=message;clearTimeout(timer);timer=setTimeout(()=>{$('selection-announcement').textContent=message;},220);}
    }
    document.body.style.setProperty('--selection-height',$('selection-trail').offsetHeight+'px');
    if(s.platformAccount){const heading=$('campaign-scope')?.querySelector('strong');if(heading)heading.textContent=accountName(s.platformAccount,c);}
    document.querySelectorAll('[data-race]').forEach(b=>{const selected=b.dataset.race===profileID;b.setAttribute('aria-current',selected?'true':'false');b.classList.toggle('selection-current',selected);});
    document.querySelectorAll('[data-index]').forEach(b=>{const selected=c.catalog[Number(b.dataset.index)]?.id===s.pageID;b.setAttribute('aria-pressed',String(selected));b.classList.toggle('selection-current',selected);});
    document.querySelectorAll('[data-overall-account],[data-platform-account]').forEach(b=>{const id=b.dataset.overallAccount||b.dataset.platformAccount,selected=id===s.platformAccount||id==='meta:'+s.pageID;b.setAttribute('aria-pressed',String(selected));b.classList.toggle('selection-current',selected);});
    if(s.platformAccount&&!accountNames.has(s.platformAccount)&&!c.current?.rows?.some(a=>a.id===s.platformAccount)){
      const id=s.platformAccount,request=++nameRequest;accountNames.set(id,'Selected '+(platforms[s.platform]||'ad')+' account');
      window.AtlasPlatforms?.catalog(s.platform).then(list=>{const found=list.find(a=>a.id===id);if(found)accountNames.set(id,found.name);if(request===nameRequest)sync();}).catch(()=>{});
    }
  }
  $('selection-clear').onclick=()=>clear('filters');
  new ResizeObserver(entries=>{const height=entries[0].target.offsetHeight;document.body.style.setProperty('--selection-height',height+'px');window.AtlasApp?.getMap()?.resize();}).observe($('selection-trail'));
  document.addEventListener('click',event=>{const b=event.target.closest('[data-campaign-candidate],[data-overall-candidate-jump]');if(b)window.AtlasElections?.selectCandidate(b.dataset.campaignCandidate||b.dataset.overallCandidateJump);});
  document.addEventListener('atlas:boot',sync);
  document.addEventListener('atlas:selection',sync);
  document.addEventListener('atlas:relationships',sync);
  window.AtlasSelection={sync,clear,clearActors,preparePlace};
  sync();
})();
