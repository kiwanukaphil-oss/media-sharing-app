import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { reportIdentityHealth } from '../scripts/report-identity-health.mjs';

const compiled = await build({entryPoints:['lib/operations-health.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {acceptOperationsReport,readOperationsHealth} = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const runtime = new Miniflare(convertV4MiniflareOptions({workers:[{name:'operations-test',modules:true,script:'export default { fetch() { return new Response("unused"); } }',r2Buckets:['STATUS']}]}));
const secret='c'.repeat(64);
const now=Date.now();
const signReport=(status,time=now,key=secret,extra={})=> {
  const body=JSON.stringify({status,...extra});
  return new Request('https://relayalbums.com/api/operations/health',{method:'POST',body,headers:{
    'X-Relay-Monitor-Time':String(time),'X-Relay-Monitor-Signature':createHmac('sha256',key).update(`${time}.${body}`).digest('hex')}});
};
try {
  const storage=await runtime.getR2Bucket('STATUS');
  assert.equal((await readOperationsHealth(storage,secret,now)).status,503);
  for(const invalid of [signReport('success',now,'wrong'),signReport('success',now-300001),signReport(['success']),signReport('success',now,secret,{name:'private'})]) {
    await assert.rejects(acceptOperationsReport(invalid,storage,secret,now),/verified/);
  }
  const originReport=signReport('success'); originReport.headers.set('Origin','https://relayalbums.com');
  await assert.rejects(acceptOperationsReport(originReport,storage,secret,now),/verified/);
  await assert.rejects(acceptOperationsReport(new Request('https://relayalbums.com/api/operations/health',{method:'POST',body:'x'.repeat(1025),headers:signReport('success').headers}),storage,secret,now),/verified/);
  assert.equal((await acceptOperationsReport(signReport('success'),storage,secret,now)).status,204);
  const healthy=await readOperationsHealth(storage,secret,now);
  assert.equal(healthy.status,200); assert.equal(healthy.headers.get('cache-control'),'no-store');
  assert.deepEqual(await healthy.json(),{status:'ok'});
  assert.equal((await readOperationsHealth(storage,undefined,now)).status,503);
  assert.equal((await readOperationsHealth(storage,secret,now+90*60000+1)).status,503,'Missing runs expire.');
  await acceptOperationsReport(signReport('success'),storage,secret,now+1000);
  assert.equal((await readOperationsHealth(storage,secret,now+90*60000+1)).status,503,'Replay cannot refresh a heartbeat.');
  await Promise.all([acceptOperationsReport(signReport('failure',now+2000),storage,secret,now+2000),acceptOperationsReport(signReport('success',now+1000),storage,secret,now+2000)]);
  assert.equal((await readOperationsHealth(storage,secret,now+2000)).status,503,'Newer failure wins a concurrent race.');
  await acceptOperationsReport(signReport('success',now+2000),storage,secret,now+2000);
  assert.equal((await readOperationsHealth(storage,secret,now+2000)).status,503,'Failure wins a timestamp tie.');
  await acceptOperationsReport(signReport('success',now+3000),storage,secret,now+3000);
  assert.equal((await readOperationsHealth(storage,secret,now+3000)).status,200);
  for(const outcomes of [['success','success'],['success','failure'],['skipped','success'],[undefined,undefined]]) {
    await reportIdentityHealth({RELAY_MONITOR_SECRET:secret,IDENTITY_CHECK_OUTCOME:outcomes[0],PROVIDER_CHECK_OUTCOME:outcomes[1]},async(url,options)=>{
      assert.equal(url,'https://relayalbums.com/api/operations/health');
      assert.equal(JSON.parse(options.body).status,outcomes.every(value=>value==='success')?'success':'failure');
      return acceptOperationsReport(new Request(url,options),storage,secret,now+4000);
    },now+4000);
  }
  await assert.rejects(reportIdentityHealth({RELAY_MONITOR_SECRET:secret},async()=>{throw new Error('private secret');}),error=>!error.message.includes('private secret'));
  console.log('PASS: real R2 conditional writes, stale/failed checks, signatures, limits, races, replay and private status output.');
} finally {await runtime.dispose();}
