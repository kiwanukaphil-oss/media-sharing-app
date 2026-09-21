import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createProviderRehearsal,removeProviderRehearsal,providerRehearsalTarget,providerRehearsalTransport,verifyProviderRehearsalProfile } from '../scripts/provider-erasure-rehearsal.mjs';

const runId=randomUUID(),target=providerRehearsalTarget(runId),events=[],calls=[];
let stored,inject;
// Exercise the exact production transport with an in-memory provider; no credentials or cloud calls.
const transport=providerRehearsalTransport('fixture-reader','fixture-writer',async(url,options)=>{
  assert.equal(new URL(url).origin,'https://dev-q1z0b44pcvdxwni6.us.auth0.com');
  assert.equal(options.redirect,'error');calls.push(options.method);
  assert.equal(options.headers.Authorization,`Bearer fixture-${options.method==='GET'?'reader':'writer'}`);
  if(inject)await inject(options);
  if(options.method==='GET')return Response.json(stored??{}, {status:stored?200:404});
  if(options.method==='DELETE'){stored=undefined;return new Response(null,{status:204});}
  const input=JSON.parse(options.body);
  assert.equal(input.blocked,true);assert.equal(input.verify_email,false);assert.equal(input.email_verified,false);
  assert.equal(input.user_id,target.localId);assert.ok(input.password.length>=40);
  stored={...input,user_id:target.subject,created_at:new Date().toISOString(),identities:[{
    provider:'auth0',connection:target.connection,user_id:target.localId,isSocial:false}]};
  delete stored.password;return Response.json(stored,{status:201});
});
const record=async event=>{events.push(structuredClone(event));};
const receipt=await createProviderRehearsal(runId,transport,record);
assert.deepEqual(events.map(event=>event.stage),['creation-intent','created']);
assert.equal(JSON.stringify(events).includes('password'),false);
await assert.rejects(createProviderRehearsal(runId,transport,record),/already exists/);
const unchanged=structuredClone(stored);
for(const change of [{blocked:false},{user_id:'auth0|real-account'},{email:'owner@example.com'},
  {identities:[...stored.identities,...stored.identities]},{app_metadata:{}},{logins_count:1},{last_login:new Date().toISOString()}]){
  stored={...unchanged,...change};const before=calls.filter(method=>method==='DELETE').length;
  await assert.rejects(removeProviderRehearsal(receipt,transport,record),/identity changed/);
  assert.equal(calls.filter(method=>method==='DELETE').length,before);
}
stored={...unchanged,created_at:'2020-01-01T00:00:00Z'};
await assert.rejects(removeProviderRehearsal(receipt,transport,record),/recreated/);
stored=structuredClone(unchanged);
await assert.rejects(removeProviderRehearsal(receipt,transport,async()=>{throw new Error('journal unavailable');}),/journal unavailable/);
assert.equal(calls.includes('DELETE'),false);
inject=async options=>{if(options.method==='DELETE')throw new Error('sensitive token must not leak');};
await assert.rejects(removeProviderRehearsal(receipt,transport,record),error=>/outcome is unknown/.test(error.message)&&!error.message.includes('sensitive'));
assert.equal(calls.filter(method=>method==='DELETE').length,1,'Ambiguous removal is not automatically retried');
inject=undefined;
const outcome=await removeProviderRehearsal(receipt,transport,record);
assert.equal(outcome.stage,'absence-verified');assert.equal(stored,undefined);
await assert.rejects(removeProviderRehearsal(receipt,transport,record),/identity changed/);
assert.equal(calls.filter(method=>method==='DELETE').length,2,'Already absent identity is never deleted again');
assert.throws(()=>providerRehearsalTransport('same','same'),/Separate/);
assert.throws(()=>providerRehearsalTarget('auth0|owner'),/generated/);
assert.throws(()=>verifyProviderRehearsalProfile({...target,subject:'auth0|owner'},unchanged),/identity changed/);
for(const [method,path] of [['GET','/api/v2/users'],['DELETE','/api/v2/users'],['DELETE','/api/v2/users/auth0%7Cowner'],['PATCH','/api/v2/users']])
  await assert.rejects(transport(method,path),/Unexpected/);
console.log('PASS: generated blocked provider scope, independent reader, exact receipt and profile binding, preexisting/changed/linked/active identity refusal, durable intent, ambiguous response and no blind retries. No live provider action.');
