import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle=await build({entryPoints:['lib/library-polling.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {startLibraryPolling}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const saved=Object.fromEntries(['window','document','navigator','setInterval','clearInterval'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
const target=new EventTarget(), document=Object.assign(new EventTarget(),{visibilityState:'visible'}), navigator={onLine:true};
const timers=new Map(); let sequence=0;
Object.defineProperties(globalThis,{
  window:{configurable:true,value:target},document:{configurable:true,value:document},navigator:{configurable:true,value:navigator},
  setInterval:{configurable:true,value:callback=>{timers.set(++sequence,callback);return sequence;}},
  clearInterval:{configurable:true,value:id=>timers.delete(id)},
});
const tick=()=>{for(const callback of [...timers.values()]) callback();};
const settle=async()=>{for(let index=0;index<5;index++) await Promise.resolve();};
const show=persisted=>{const event=new Event('pageshow');Object.defineProperty(event,'persisted',{value:persisted});target.dispatchEvent(event);};
let dispose;
try {
  const calls=[],failures=[];
  dispose=startLibraryPolling(signal=>new Promise((resolve,reject)=>calls.push({signal,resolve,reject})),failure=>failures.push(failure));
  assert.equal(timers.size,1);
  tick(); assert.equal(calls.length,1); tick(); assert.equal(calls.length,1,'Slow polls must not overlap');
  const oldTick=[...timers.values()][0];
  target.dispatchEvent(new Event('pagehide'));
  assert.equal(calls[0].signal.aborted,true); assert.equal(timers.size,0);
  oldTick(); assert.equal(calls.length,1,'Queued timer must not fetch from an inactive page');
  calls[0].reject(new Error('Navigation cancelled')); await settle(); assert.equal(failures.length,0);
  show(false); assert.equal(timers.size,0);
  show(true); assert.equal(timers.size,1); assert.equal(calls.length,2);
  show(true); assert.equal(timers.size,1); assert.equal(calls.length,2);
  calls[1].resolve(); await settle();
  navigator.onLine=false; tick(); assert.equal(calls.length,2);
  navigator.onLine=true; document.visibilityState='hidden'; tick(); assert.equal(calls.length,2);
  document.visibilityState='visible'; tick(); assert.equal(calls.length,3);
  calls[2].reject(new Error('Real failure')); await settle(); assert.equal(failures.length,1);
  assert.equal(calls[2].signal.aborted,true,'A failed batch cancels any remaining reads');
  tick(); assert.equal(calls.length,4);
  dispose(); assert.equal(calls[3].signal.aborted,true); assert.equal(timers.size,0);
  show(true); tick(); assert.equal(calls.length,4,'Unmount removes lifecycle listeners');
  calls[3].resolve(); await settle();
  const resumedCalls=[];
  dispose=startLibraryPolling(async signal=>{resumedCalls.push(signal);},failure=>failures.push(failure));
  const queuedBeforeUnload=[...timers.values()][0];
  target.dispatchEvent(new Event('beforeunload'));
  queuedBeforeUnload();await settle();assert.equal(resumedCalls.length,0,'Visible but unloading documents must not start polling');
  target.dispatchEvent(new Event('focus'));await settle();assert.equal(resumedCalls.length,1,'Cancelled navigation resumes when focus returns');
  document.visibilityState='hidden';document.dispatchEvent(new Event('visibilitychange'));assert.equal(timers.size,0);
  document.visibilityState='visible';document.dispatchEvent(new Event('visibilitychange'));await settle();assert.equal(resumedCalls.length,2);
  target.dispatchEvent(new Event('beforeunload'));target.dispatchEvent(new Event('pointerdown'));await settle();assert.equal(resumedCalls.length,3);
  dispose();target.dispatchEvent(new Event('focus'));target.dispatchEvent(new Event('keydown'));await settle();assert.equal(resumedCalls.length,3);
  console.log('PASS: navigation cancels polling, queued callbacks stay paused, bfcache resumes once, slow polls do not overlap, hidden/offline pages skip reads and genuine failures remain visible.');
} finally {
  dispose?.();
  for(const [key,descriptor] of Object.entries(saved)) {
    if(descriptor) Object.defineProperty(globalThis,key,descriptor); else delete globalThis[key];
  }
}
