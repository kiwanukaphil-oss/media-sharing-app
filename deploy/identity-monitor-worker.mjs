import { inspectAuth0Recovery, recoveryPeopleQuery } from '../lib/provider-recovery-monitor.mjs';
import { identityOperationsQuery, evaluateIdentityOperations } from '../lib/identity-operations-monitor.mjs';
import { reportIdentityHealth } from '../lib/identity-health-report.mjs';
import { readBoundedMonitorJson } from '../lib/monitor-json.mjs';

const queryUrl='https://api.cloudflare.com/client/v4/accounts/5afd1facc45c9ddd86114155b09fc2e2/d1/database/6ee89ea2-f2b2-4b8e-a14f-601f22a61142/query';

// Use the existing read-only API credential rather than a writable D1 binding. Only these two fixed
// SELECT statements are accepted, bounded results are checked, and provider errors never enter logs.
async function readMonitorRows(token,sql,request) {
  if(!token||![recoveryPeopleQuery,identityOperationsQuery].includes(sql))throw new Error('Monitor read configuration is invalid.');
  const response=await request(queryUrl,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({sql}),redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('Monitor database read failed.');
  const result=await readBoundedMonitorJson(response);
  const entry=result.result?.[0];
  if(result.success!==true||result.result?.length!==1||entry?.success!==true||!Array.isArray(entry.results)||
    entry.meta?.changed_db!==false||entry.meta?.rows_written!==0)throw new Error('Monitor read verification failed.');
  return entry.results;
}

// Every success covers BOTH independently attempted checks. Any rejection or capacity limit reports
// failure; a delivery failure throws a static error so the scheduler records it without private details.
export async function runScheduledIdentityMonitor(env,request=fetch,now=Date.now()) {
  if(env.MONITOR_ENABLED!=='true')return {status:'disabled'};
  const deadline=AbortSignal.timeout(60000);
  // Workers supports manual redirects, not Node's error mode; each reader rejects non-success responses.
  const boundedRequest=(url,options)=>request(url,{...options,redirect:'manual',signal:AbortSignal.any([deadline,options.signal])});
  const checks=await Promise.allSettled([
    (async()=>evaluateIdentityOperations(await readMonitorRows(env.CLOUDFLARE_D1_READ_TOKEN,identityOperationsQuery,boundedRequest)))(),
    (async()=>{
      const people=await readMonitorRows(env.CLOUDFLARE_D1_READ_TOKEN,recoveryPeopleQuery,boundedRequest);
      // Retain the reviewed pilot bound after the Paid upgrade; a billing change does not validate expansion.
      if(people.length>40)throw new Error('Pilot monitor capacity requires review.');
      return inspectAuth0Recovery(people,{clientId:env.AUTH0_MONITOR_CLIENT_ID,clientSecret:env.AUTH0_MONITOR_CLIENT_SECRET},boundedRequest,now);
    })(),
  ]);
  const outcomes=checks.map(check=>check.status==='fulfilled'&&check.value.length===0?'success':'failure');
  try {
    await reportIdentityHealth({RELAY_MONITOR_SECRET:env.RELAY_MONITOR_SECRET,
      IDENTITY_CHECK_OUTCOME:outcomes[0],PROVIDER_CHECK_OUTCOME:outcomes[1]},
      (url,options)=>env.RELAY.fetch(new Request(url,{...options,redirect:'manual'})),now);
  }catch{throw new Error('Scheduled identity report could not be delivered.');}
  if(outcomes.includes('failure'))throw new Error('Scheduled identity checks require private operator review.');
  return {status:'success'};
}

/** @type {ExportedHandler<IdentityMonitorEnv>} */
const identityMonitorWorker = {
  fetch(){return new Response('Not found',{status:404,headers:{'Cache-Control':'no-store'}});},
  async scheduled(_controller,env){
    const outcome=await runScheduledIdentityMonitor(env);
    console.log(JSON.stringify({event:'identity-monitor',status:outcome.status}));
  },
};
export default identityMonitorWorker;
