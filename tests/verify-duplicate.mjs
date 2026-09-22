import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createHash,randomUUID} from 'node:crypto';
const bundle=await build({entryPoints:['lib/verify-duplicate.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {verifyDuplicatePair}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const original=Buffer.from('original'),source={id:randomUUID(),name:'First',revision:0,accessScopeId:null,size:original.length,sha256:createHash('sha256').update(original).digest('hex')},candidate={...source,id:randomUUID(),name:'Second'};
let checked=0;
await verifyDuplicatePair(source,candidate,{signal:new AbortController().signal,read:async()=>new Response(original),revalidate:async()=>{checked++;}});assert.equal(checked,1);
for(const read of [async()=>new Response('wrong!!!'),async()=>new Response('short'),async()=>new Response('',{status:403})]){
  checked=0;await assert.rejects(verifyDuplicatePair(source,candidate,{signal:new AbortController().signal,read,revalidate:async()=>{checked++;}}));assert.equal(checked,0);
}
await assert.rejects(verifyDuplicatePair(source,candidate,{signal:new AbortController().signal,read:async()=>new Response(original),revalidate:async()=>{throw new Error('Access revoked');}}),/Access revoked/);
await assert.rejects(verifyDuplicatePair(source,{...candidate,accessScopeId:randomUUID()},{signal:new AbortController().signal,read:async()=>{throw new Error('Should not read');},revalidate:async()=>{}}),/candidate pair/);
await assert.rejects(verifyDuplicatePair({...source,size:251*1024**2},{...candidate,size:251*1024**2},{signal:new AbortController().signal,read:async()=>{throw new Error('Should not read');},revalidate:async()=>{}}),/250 MiB/);
const abort=new AbortController();await assert.rejects(verifyDuplicatePair(source,candidate,{signal:abort.signal,read:async()=>new Response(original),revalidate:async()=>{},onProgress:()=>abort.abort()}),{name:'AbortError'});
console.log('PASS duplicate verification: independent original SHA/length checks, mismatch/truncation/denial, final access loss, cross-audience refusal, bounded reads and cancellation');
