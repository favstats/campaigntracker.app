'use strict';
(() => {
// Fixed small files make the archive reader independent of HTTP Range support.
// Deduplicate concurrent requests and bound the settled/in-flight chunk cache.
const cache=new Map(), cacheLimit=192;
function chunk(url){
  if(cache.has(url)){const p=cache.get(url);cache.delete(url);cache.set(url,p);return p;}
  const p=fetch(url,{credentials:'same-origin'}).then(r=>{
    if(!r.ok)throw Error(`Map geometry chunk couldn’t load (${r.status}).`);
    return r.arrayBuffer().then(buffer=>new Response(
      new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))
    ).arrayBuffer());
  }).catch(error=>{if(cache.get(url)===p)cache.delete(url);throw error;});
  cache.set(url,p);if(cache.size>cacheLimit)cache.delete(cache.keys().next().value);
  return p;
}
class ChunkedSource{
  constructor(key,spec,size,root){this.key=key;this.spec=spec;this.size=size;this.root=root;}
  getKey(){return this.key;}
  async getBytes(offset,length,signal){
    if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
    if(!Number.isSafeInteger(offset)||offset<0||offset>=this.spec.bytes||!Number.isSafeInteger(length)||length<=0)throw Error('Invalid map geometry byte request.');
    const end=Math.min(offset+length,this.spec.bytes),first=Math.floor(offset/this.size),last=Math.floor((end-1)/this.size);
    const indices=Array.from({length:last-first+1},(_,i)=>first+i);
    const parts=await Promise.all(indices.map(i=>chunk(new URL(String(i).padStart(4,'0')+'.bin.gz',this.root).href)));
    if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
    const data=new Uint8Array(end-offset);
    for(let k=0;k<parts.length;k++){
      const start=indices[k]*this.size,from=Math.max(offset,start),to=Math.min(end,start+parts[k].byteLength);
      const expected=Math.min(this.size,this.spec.bytes-start);
      if(parts[k].byteLength!==expected)throw Error('Incomplete map geometry chunk. Reload to retry.');
      data.set(new Uint8Array(parts[k],from-start,to-from),from-offset);
    }
    return {data:data.buffer,etag:this.spec.sha256};
  }
}
window.AtlasGeometry={create(index,root){
  const protocol=new pmtiles.Protocol();
  return {protocol,url(name){
    const spec=index.archives[name];if(!spec)throw Error('No map geometry is available for '+name);
    const base=new URL(spec.path,root).href,key=new URL('archive.pmtiles',base).href;
    if(!protocol.get(key))protocol.add(new pmtiles.PMTiles(new ChunkedSource(key,spec,index.chunk_size,base)));
    return 'pmtiles://'+key;
  }};
}};
})();
