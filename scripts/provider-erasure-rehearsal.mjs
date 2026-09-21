import { randomBytes } from 'node:crypto';
import { providerOrigin } from '../lib/provider-recovery-monitor.mjs';
import { readBoundedMonitorJson } from '../lib/monitor-json.mjs';

const connection='Username-Password-Authentication';
const fail=message=>{throw new Error(message);};

export function providerRehearsalTarget(runId) {
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(runId))fail('A generated rehearsal identifier is required.');
  const localId=`relay-erasure-rehearsal-${runId}`;
  return Object.freeze({runId,subject:`auth0|${localId}`,localId,email:`relay-erasure-${runId}@example.invalid`,connection});
}

// Refuse real accounts, linked identities, activated fixtures or a changed provider binding. Email is
// corroborating evidence only: the exact generated subject and creation receipt establish the target.
export function verifyProviderRehearsalProfile(target,profile) {
  const expected=providerRehearsalTarget(target.runId);
  if(JSON.stringify(target)!==JSON.stringify(expected) || profile?.user_id!==expected.subject || profile.email!==expected.email ||
      profile.blocked!==true || profile.email_verified!==false || profile.app_metadata?.relay_erasure_rehearsal!==expected.runId ||
      !Array.isArray(profile.identities) || profile.identities.length!==1 || profile.identities[0].provider!=='auth0' ||
      profile.identities[0].connection!==connection || profile.identities[0].user_id!==expected.localId ||
      profile.identities[0].isSocial!==false || (profile.logins_count??0)!==0 || profile.last_login)fail('Provider rehearsal identity changed; no removal is permitted.');
  return true;
}

// Transport credentials are supplied by an explicitly approved operator setup, never discovered or
// broadened here. Independent reader and writer bearers must differ; no network error exposes payloads.
export function providerRehearsalTransport(readerToken,writerToken,request=fetch) {
  if(!readerToken || !writerToken || readerToken===writerToken)fail('Separate provider reader and rehearsal writer are required.');
  return async(method,path,body)=>{
    if(!((method==='POST' && path==='/api/v2/users') || (['GET','DELETE'].includes(method) &&
      /^\/api\/v2\/users\/auth0%7Crelay-erasure-rehearsal-[a-f0-9-]+$/.test(path))))fail('Unexpected provider rehearsal operation.');
    let response;
    try {response=await request(`${providerOrigin}${path}`,{method,redirect:'error',signal:AbortSignal.timeout(15000),
      headers:{Authorization:`Bearer ${method==='GET'?readerToken:writerToken}`,'Content-Type':'application/json'},
      ...(body?{body:JSON.stringify(body)}:{})});}
    catch {fail('Provider rehearsal request outcome is unknown; inspect the exact fixture before retrying.');}
    if(response.status===404 && method==='GET')return {status:404};
    if(response.status===204 && method==='DELETE')return {status:204};
    if(response.status!==(method==='POST'?201:200))fail(`Provider rehearsal request rejected (HTTP ${response.status}).`);
    try{return {status:response.status,profile:await readBoundedMonitorJson(response)};}
    catch {fail('Provider rehearsal response is unreadable; inspect the exact fixture before retrying.');}
  };
}

// Creation is a separate operator action. Persist intent before POST; never retry an ambiguous POST or
// adopt a pre-existing identity. The random password remains memory-only and the account is blocked.
export async function createProviderRehearsal(runId,transport,record) {
  const target=providerRehearsalTarget(runId),path=`/api/v2/users/${encodeURIComponent(target.subject)}`;
  if((await transport('GET',path)).status!==404)fail('Rehearsal target already exists; no account was created.');
  await record({stage:'creation-intent',target});
  const response=await transport('POST','/api/v2/users',{connection,email:target.email,user_id:target.localId,
    password:`Aa1!${randomBytes(32).toString('base64url')}`,blocked:true,email_verified:false,verify_email:false,
    app_metadata:{relay_erasure_rehearsal:runId}});
  if(response.status!==201)fail('Provider creation was not acknowledged.');
  verifyProviderRehearsalProfile(target,response.profile);
  const receipt={stage:'created',target,createdAt:response.profile.created_at};
  if(!Number.isFinite(Date.parse(receipt.createdAt)))fail('Provider creation timestamp is missing.');
  await record(receipt);
  verifyProviderRehearsalProfile(target,(await transport('GET',path)).profile);
  return receipt;
}

// This primitive requires separate concrete user approval at the operator boundary. A saved receipt
// is scope evidence, not consent. Persist removal intent first; ambiguity never triggers a second DELETE.
export async function removeProviderRehearsal(receipt,transport,record) {
  const target=providerRehearsalTarget(receipt?.target?.runId);
  if(receipt.stage!=='created' || JSON.stringify(receipt.target)!==JSON.stringify(target) || !Number.isFinite(Date.parse(receipt.createdAt)))fail('A verified creation receipt is required.');
  const path=`/api/v2/users/${encodeURIComponent(target.subject)}`;
  const observed=await transport('GET',path);
  verifyProviderRehearsalProfile(target,observed.profile);
  if(observed.profile.created_at!==receipt.createdAt)fail('Provider identity was recreated; review required.');
  await record({stage:'removal-intent',target,createdAt:receipt.createdAt});
  if((await transport('DELETE',path)).status!==204)fail('Provider removal was not acknowledged.');
  if((await transport('GET',path)).status!==404)fail('Independent provider absence verification failed.');
  const outcome={stage:'absence-verified',target,createdAt:receipt.createdAt,realAccountErased:false};
  await record(outcome);return outcome;
}
