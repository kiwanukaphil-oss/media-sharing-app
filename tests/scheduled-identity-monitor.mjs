import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import worker, { runScheduledIdentityMonitor } from '../deploy/identity-monitor-worker.mjs';
import { identityOperationsQuery } from '../lib/identity-operations-monitor.mjs';
import { recoveryPeopleQuery } from '../lib/provider-recovery-monitor.mjs';

const now=Date.now(),secret='d'.repeat(64);
const json=value=>Response.json(value);
const healthyCounts={requests_to_review:0,unknown_request_states:0,unreconciled_watermarks:0,stale_active_sessions:0};
const healthyPerson={subject:'generated-subject',credentials_changed_at:0,delivered_changed_at:0};

// Record only fixture requests. Verify exact read statements and signed aggregate reporting on every path.
function fixture({counts=healthyCounts,people=[healthyPerson],databaseFailure=false,providerFailure=false,reportFailure=false}={}) {
  const calls=[],reports=[];
  const env={MONITOR_ENABLED:'true',AUTH0_MONITOR_CLIENT_ID:'fixture-client',AUTH0_MONITOR_CLIENT_SECRET:'fixture-secret',
    CLOUDFLARE_D1_READ_TOKEN:'fixture-read-token',RELAY_MONITOR_SECRET:secret,RELAY:{async fetch(request){
      const body=await request.text();
      assert.equal(request.url,'https://relayalbums.com/api/operations/health');
      assert.equal(request.headers.get('x-relay-monitor-time'),String(now));
      assert.equal(request.headers.get('x-relay-monitor-signature'),createHmac('sha256',secret).update(`${now}.${body}`).digest('hex'));
      reports.push(JSON.parse(body));return new Response(null,{status:reportFailure?503:204});
    }}};
  const request=async(url,options)=>{
    calls.push(url);assert.equal(options.redirect,'manual');
    const parsed=new URL(url);
    if(parsed.hostname==='api.cloudflare.com'){
      const {sql}=JSON.parse(options.body);assert.ok([identityOperationsQuery,recoveryPeopleQuery].includes(sql));
      if(databaseFailure)throw new Error('PRIVATE DATABASE ERROR');
      return json({success:true,result:[{success:true,results:sql===identityOperationsQuery?[counts]:people,meta:{changed_db:false,rows_written:0}}]});
    }
    assert.equal(parsed.origin,'https://dev-q1z0b44pcvdxwni6.us.auth0.com');
    if(providerFailure)throw new Error('PRIVATE PROVIDER ERROR');
    if(parsed.pathname==='/oauth/token')return json({access_token:'fixture-token',token_type:'Bearer'});
    if(parsed.pathname==='/api/v2/logs')return json([]);
    assert.equal(parsed.pathname,'/api/v2/users/generated-subject');
    return json({user_id:'generated-subject'});
  };
  return {env,request,calls,reports};
}

const good=fixture();
assert.deepEqual(await runScheduledIdentityMonitor(good.env,good.request,now),{status:'success'});
assert.deepEqual(good.reports,[{status:'success'}]);
for(const options of [{databaseFailure:true},{providerFailure:true},{counts:{...healthyCounts,requests_to_review:1}},
  {people:Array.from({length:41},()=>healthyPerson)}]){
  const fail=fixture(options);
  await assert.rejects(runScheduledIdentityMonitor(fail.env,fail.request,now),error=>error.message==='Scheduled identity checks require private operator review.');
  assert.deepEqual(fail.reports,[{status:'failure'}]);
  assert.equal(fail.calls.filter(url=>url.startsWith('https://api.cloudflare.com/')).length,2,'Both checks attempt their independent read.');
}
const rejected=fixture({reportFailure:true});
await assert.rejects(runScheduledIdentityMonitor(rejected.env,rejected.request,now),/could not be delivered/);
const disabled=fixture();disabled.env.MONITOR_ENABLED='false';
assert.deepEqual(await runScheduledIdentityMonitor(disabled.env,disabled.request,now),{status:'disabled'});
assert.equal(disabled.calls.length,0);assert.equal(disabled.reports.length,0);
assert.equal(worker.fetch(new Request('https://fixture/anything')).status,404);

// No Node compatibility or polyfills are permitted: checks/reporting use only native Workers Web APIs.
const compiled=await build({entryPoints:['deploy/identity-monitor-worker.mjs'],bundle:true,write:false,format:'esm',platform:'browser'});
const runtime=new Miniflare(convertV4MiniflareOptions({workers:[{name:'scheduled-monitor-test',modules:true,script:compiled.outputFiles[0].text,
  compatibilityDate:'2026-09-21',bindings:{MONITOR_ENABLED:'false'}}]}));
try {
  assert.equal((await runtime.dispatchFetch('https://fixture/')).status,404);
  const runtimeWorker=await runtime.getWorker();
  await runtimeWorker.scheduled({cron:'19,49 * * * *',scheduledTime:now});
} finally {await runtime.dispose();}
for(const providerFailure of [false,true]) {
  const integration=fixture({providerFailure}),reported=[];
  const bindings={...integration.env};
  delete bindings.RELAY;
  const enabledRuntime=new Miniflare(convertV4MiniflareOptions({workers:[{name:'enabled-monitor-test',modules:true,
    script:compiled.outputFiles[0].text,compatibilityDate:'2026-09-21',bindings,
    outboundService:async request=>integration.request(request.url,{method:request.method,headers:request.headers,
      body:request.method==='POST'?await request.text():undefined,redirect:'manual',signal:request.signal}),
    serviceBindings:{RELAY:async request=>{
      const body=await request.text(),timestamp=request.headers.get('x-relay-monitor-time');
      assert.equal(request.headers.get('x-relay-monitor-signature'),createHmac('sha256',secret).update(`${timestamp}.${body}`).digest('hex'));
      reported.push(JSON.parse(body));return new Response(null,{status:204});
    }}}]}));
  try {
    const execution=(await enabledRuntime.getWorker()).scheduled({cron:'19,49 * * * *',scheduledTime:now});
    assert.equal((await execution).outcome,providerFailure?'exception':'ok');
    assert.deepEqual(reported,[{status:providerFailure?'failure':'success'}]);
  } finally {await enabledRuntime.dispose();}
}
console.log('PASS: scheduled combined checks, fixed read scope, signed failure/success, capacity, delivery errors, disabled runtime and no public trigger.');
