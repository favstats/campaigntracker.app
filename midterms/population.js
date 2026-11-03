'use strict';
(() => {
  const indexes={zip:new Map(),district:new Map(),state:new Map()},legRefs={};let ref;
  const rateFormat=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:4});
  function prepare(geo,legs={}){
    if(ref!==geo.zips){ref=geo.zips;for(const m of Object.values(indexes))m.clear();
      for(const z of geo.zips){indexes.zip.set(z.id,z.population);for(const [id,w]of z.districts){indexes.district.set(id,(indexes.district.get(id)||0)+z.population*w);indexes.state.set(id.slice(0,2),(indexes.state.get(id.slice(0,2))||0)+z.population*w);}}
      indexes.country=geo.zips.reduce((n,z)=>n+z.population,0);
    }
    for(const [kind,meta]of Object.entries(legs))if(legRefs[kind]!==meta){legRefs[kind]=meta;indexes[kind]=new Map();for(const [zip,ids]of meta.zip_links){const links=Array.isArray(ids)?ids:ids?[ids]:[];for(const id of links)indexes[kind].set(id,(indexes[kind].get(id)||0)+(indexes.zip.get(zip)||0)/links.length);}}
  }
  function get(kind,id){return kind==='country'?indexes.country:indexes[kind]?.get(id)||0;}
  function selection(s,manifest){return s.area?get(s.area.type,s.area.id):s.place==='US'?get('country'):get('state',manifest.states.find(v=>v.abbr===s.place)?.id);}
  function rate(value,population){return population>0?value/population:null;}
  function format(value,population){const v=rate(value,population);return v===null?'Population unavailable':rateFormat.format(v);}
  const active=()=>window.AtlasApp?.getContext().state.units==='capita'&&window.AtlasApp?.getContext().current?.metric!=='count'&&window.AtlasApp?.getContext().current?.metric!=='unavailable';
  window.AtlasPopulation={prepare,get,selection,rate,format,active,formatRate:v=>Number.isFinite(v)?rateFormat.format(v):'Unavailable',note:'2020 ACS five-year ZIP-area population; district/state totals use the same ZIP overlaps as the spending model. Legislative population uses ZIP representative points. Approximate residents, not registered voters.'};
})();
