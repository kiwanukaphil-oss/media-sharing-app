import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';

const bundle=await build({entryPoints:['lib/original-package.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {writeOriginalPackage,validatePackageManifest,packageMemoryLimit}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const bytes=Buffer.from('Generated original with exact bytes.'),hash=createHash('sha256').update(bytes).digest('hex');
const ids=[randomUUID(),randomUUID()],files=ids.map(id=>({id,name:'Same name.txt',size:bytes.length,sha256:hash,suggestedPath:`files/${id}/Same name.txt`}));
const manifest={format:'relay-metadata',formatVersion:1,files:files.map(file=>({...file,albums:[{name:'Album',section:{name:'Section'}}]}))};
const makeSink=()=>{const chunks=[];return {chunks,closed:false,aborted:false,async write(value){chunks.push(Buffer.from(value));},async close(){this.closed=true;},async abort(){this.aborted=true;chunks.length=0;}};};
const sink=makeSink(),progress=[];
await writeOriginalPackage(manifest,sink,{signal:new AbortController().signal,read:async()=>new Response(bytes),revalidate:async()=>{},onProgress:(value,total)=>progress.push([value,total])});
assert.equal(sink.closed,true);assert.equal(sink.aborted,false);assert.equal(progress.at(-1)[0],bytes.length*2);
await mkdir('.sites-runtime/package-test',{recursive:true});await writeFile('.sites-runtime/package-test/originals.zip',Buffer.concat(sink.chunks));
// Python's independent standard-library reader checks archive structure, CRCs, manifest and each
// uncompressed original. This catches writer/reader implementation mistakes a mirrored parser misses.
const verification=spawnSync(process.platform==='win32'?'python':'python3',['-c',`import zipfile,json
with zipfile.ZipFile('.sites-runtime/package-test/originals.zip') as z:
 assert z.testzip() is None
 m=json.loads(z.read('manifest.json'))
 assert m['includesOriginalBytes'] is True
 assert len(z.namelist())==3
 for f in m['files']:
  assert z.read(f['suggestedPath'])==b'Generated original with exact bytes.'
  assert f['albums'][0]['section']['name']=='Section'
`],{encoding:'utf8'});assert.equal(verification.status,0,verification.stderr);
for(const [label,read,revalidate] of [
  ['corrupt',async()=>new Response(Buffer.alloc(bytes.length)),async()=>{}],
  ['short',async()=>new Response('tiny'),async()=>{}],
  ['oversize',async()=>new Response(Buffer.alloc(bytes.length+1)),async()=>{}],
  ['denied',async()=>new Response('',{status:403}),async()=>{}],
  ['final access loss',async()=>new Response(bytes),async()=>{throw new Error('Revoked');}],
]){
  const failed=makeSink();await assert.rejects(writeOriginalPackage(manifest,failed,{signal:new AbortController().signal,read,revalidate}),undefined,label);assert.equal(failed.closed,false,label);assert.equal(failed.aborted,true,label);assert.equal(failed.chunks.length,0);
}
const cancel=new AbortController(),cancelled=makeSink();
await assert.rejects(writeOriginalPackage(manifest,cancelled,{signal:cancel.signal,read:async()=>new Response(bytes),revalidate:async()=>{},onProgress:()=>cancel.abort()}),{name:'AbortError'});
assert.equal(cancelled.closed,false);assert.equal(cancelled.aborted,true);
assert.throws(()=>validatePackageManifest({files:[{...files[0],suggestedPath:`files/${ids[0]}/../secret`}]}),/unsafe/);
assert.throws(()=>validatePackageManifest({files:[files[0],files[0]]}),/invalid/);
assert.throws(()=>validatePackageManifest({files:[{...files[0],size:packageMemoryLimit+1}]},packageMemoryLimit),/64 MiB/);
assert.throws(()=>validatePackageManifest({files:[{...files[0],size:2*1024**3+1}]}),/2 GiB/);
// Stream beyond the fallback limit without retaining output. Peak write size stays at one
// source chunk, demonstrating that large packages do not accumulate original bytes in memory.
const streamMiB=Number(process.env.RELAY_PACKAGE_STREAM_MIB||80);assert.ok([80,2048].includes(streamMiB));
const chunk=Buffer.alloc(1024*1024,7),largeHash=createHash('sha256');for(let n=0;n<streamMiB;n++)largeHash.update(chunk);
const large={files:[{...files[0],size:streamMiB*1024**2,sha256:largeHash.digest('hex')}]};let largestWrite=0,committed=false;
await writeOriginalPackage(large,{write:async value=>{largestWrite=Math.max(largestWrite,value.length);},close:async()=>{committed=true;},abort:async()=>{committed=false;}},{signal:new AbortController().signal,revalidate:async()=>{},read:async()=>{let count=0;return new Response(new ReadableStream({pull(controller){if(count++<streamMiB)controller.enqueue(chunk);else controller.close();}}));}});
assert.equal(committed,true);assert.equal(largestWrite,1024*1024);console.log(`PASS ${streamMiB} MiB streamed package; maximum output chunk ${largestWrite} bytes`);
console.log('PASS original packages: independent ZIP extraction/CRC/manifest, identical names, SHA-256, bounds, corrupt/truncated/denied originals, final revocation and cancellation without sink commit');
