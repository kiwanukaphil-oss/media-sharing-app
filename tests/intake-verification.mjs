import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

// Exercise the maximum permitted file through the actual workerd stream/heap, using only generated
// bytes. Wall time is a local bound check, not production CPU evidence or permission to process users' files.
const size=250*1024*1024,chunk=new Uint8Array(256*1024).fill(7),hash=createHash('sha256');
for(let offset=0;offset<size;offset+=chunk.length)hash.update(chunk);
const expected=hash.digest('hex');
const bundle=await build({entryPoints:['lib/intake-review.ts'],bundle:true,write:false,platform:'browser',format:'esm'});
const worker=bundle.outputFiles[0].text+`
export default {async fetch(request){
  const bytes=new Uint8Array(256*1024).fill(7);let sent=0,cancelled=false;
  const invalid=new URL(request.url).pathname==='/invalid';
  const body=new ReadableStream({pull(controller){if(sent>=${size}){controller.close();return;}sent+=bytes.length;controller.enqueue(bytes);},cancel(){cancelled=true;}});
  const started=performance.now();
  try {await verifyIntakeOriginal(body,${size},invalid?'0'.repeat(64):'${expected}');return Response.json({verified:true,bytes:sent,elapsedMs:performance.now()-started});}
  catch(error){return Response.json({verified:false,message:error.message,cancelled},{status:409});}
}};`;
const runtime=new Miniflare(convertV4MiniflareOptions({workers:[{name:'intake-verification',compatibilityDate:'2026-09-17',modules:true,script:worker}]}));
try {
  const response=await runtime.dispatchFetch('http://localhost/valid'),result=await response.json();
  assert.equal(response.status,200);assert.equal(result.verified,true);assert.equal(result.bytes,size);
  const invalid=await runtime.dispatchFetch('http://localhost/invalid'),failure=await invalid.json();
  assert.equal(invalid.status,409);assert.equal(failure.verified,false);assert.match(failure.message,/checksum/);
  console.log(`PASS: maximum 250 MiB generated original streamed and independently hashed in workerd (${Math.round(result.elapsedMs)} ms local wall time); mismatched hash rejected without publishing.`);
}finally{await runtime.dispose();}
