'use strict';
// Large retained datasets are shipped as gzip assets. Decode in native browser
// streams; accept hosts that have already applied Content-Encoding decoding.
self.AtlasJSON={async read(response,url){
  if(!/\.gz(?:[?#]|$)/.test(url))return response.json();
  const body=await response.blob(),magic=new Uint8Array(await body.slice(0,2).arrayBuffer());
  if(magic[0]!==0x1f||magic[1]!==0x8b)return new Response(body).json();
  if(typeof DecompressionStream==='undefined')throw Error('This browser cannot unpack the data. Use a current Chrome, Firefox or Safari version.');
  return new Response(body.stream().pipeThrough(new DecompressionStream('gzip'))).json();
}};
