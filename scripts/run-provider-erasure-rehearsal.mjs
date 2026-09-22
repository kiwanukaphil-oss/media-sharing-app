import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { operationsDirectory,runPrivateCommand } from './backup-storage.mjs';
import { providerOrigin } from '../lib/provider-recovery-monitor.mjs';
import { readBoundedMonitorJson } from '../lib/monitor-json.mjs';
import { createProviderRehearsal,removeProviderRehearsal,providerRehearsalTransport } from './provider-erasure-rehearsal.mjs';

const runId='67985336-e179-4145-986e-6729972793fe',clientId='9HuHPIJEhoFuHHS16CoNAuiv3d6Lp0HL';
const readerClientId='1Rakur48pyVj6WOVy3Yyb4cY31E0IEpb';
const directory=resolve(operationsDirectory,'provider-erasure-rehearsal',runId);
const port=8797,origin=`http://127.0.0.1:${port}`,pathname=`/${randomBytes(24).toString('hex')}`;
let used=false,sequence=0;
await mkdir(resolve(operationsDirectory,'provider-erasure-rehearsal'),{recursive:true});
await mkdir(directory,{recursive:false});

// Existing read-only monitor credentials remain protected by Windows DPAPI and never reach the page.
async function readMonitorSecret() {
  const sealed=await readFile(resolve(operationsDirectory,'auth0-read-monitor.dpapi'),'utf8');
  return runPrivateCommand('powershell.exe',['-NoProfile','-NonInteractive','-Command',
    '$ErrorActionPreference="Stop"; $sealed=[Console]::In.ReadToEnd(); $value=ConvertTo-SecureString $sealed; $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($value); try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }'],sealed);
}

// TLS token responses supply the effective scope and expiry. Neither bearer nor client secret is saved.
async function tokenFor(id,secret,scope) {
  const response=await fetch(`${providerOrigin}/oauth/token`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
    headers:{'Content-Type':'application/json'},body:JSON.stringify({grant_type:'client_credentials',client_id:id,client_secret:secret,audience:`${providerOrigin}/api/v2/`,scope})});
  if(!response.ok)throw new Error('Token request refused.');
  const token=await readBoundedMonitorJson(response);
  if(typeof token.access_token!=='string'||token.token_type?.toLowerCase()!=='bearer'||
    typeof token.scope!=='string'||token.scope.split(' ').sort().join(' ')!==scope.split(' ').sort().join(' ')||
    !Number.isSafeInteger(token.expires_in)||token.expires_in<1||token.expires_in>86400)throw new Error('Token scope or lifetime differs from approved bounds.');
  return {bearer:token.access_token,scope:token.scope,expiresAt:new Date(Date.now()+token.expires_in*1000).toISOString()};
}

async function record(event) {
  await writeFile(resolve(directory,`${String(sequence++).padStart(2,'0')}-${event.stage}.json`),JSON.stringify({...event,observedAt:new Date().toISOString()},null,2),{flag:'wx',mode:0o600});
}

// The owner approved this exact generated account and temporary grant on 22 September 2026. No broader
// subject can be supplied through the form. Any ambiguous response stops; reruns require evidence review.
async function performApprovedTest(secret) {
  await record({stage:'approved-scope',runId,clientId,readerClientId,approvedOn:'2026-09-22',scopes:['create:users','delete:users']});
  // Auth0 returns the monitor's existing complete read-only grant; validate that exact set.
  await record({stage:'reader-token-request'});
  const reader=await tokenFor(readerClientId,await readMonitorSecret(),'read:users read:logs');
  await record({stage:'reader-token-verified',scope:reader.scope,expiresAt:reader.expiresAt});
  await record({stage:'writer-token-request'});
  const writer=await tokenFor(clientId,secret,'create:users delete:users');
  await record({stage:'token-bounds',writerScope:writer.scope,writerExpiresAt:writer.expiresAt});
  const transport=providerRehearsalTransport(reader.bearer,writer.bearer);
  const receipt=await createProviderRehearsal(runId,transport,record);
  await removeProviderRehearsal(receipt,transport,record);
  await record({stage:'verified',runId,writerExpiresAt:writer.expiresAt,grantRevocationPending:true});
}

// Single-use loopback handoff: exact host/path/origin, bounded body, no credentials in URLs or logs.
const server=createServer(async(request,response)=>{
  response.setHeader('Content-Type','text/html; charset=utf-8');response.setHeader('Cache-Control','no-store');
  response.setHeader('Content-Security-Policy',"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  if(request.headers.host!==`127.0.0.1:${port}`||request.url!==pathname){response.writeHead(404);response.end('Not found');return;}
  if(request.method==='GET'){response.end(used?'Test form closed':`<!doctype html><title>Relay approved provider test</title><h1>Approved dummy-account test</h1><p>Only the approved generated identity is created and removed.</p><form method="post"><label>Temporary application secret <input type="password" name="secret" autocomplete="off" required maxlength="256"></label><button>Run approved test</button></form>`);return;}
  if(request.method!=='POST'||request.headers.origin!==origin||used){response.writeHead(403);response.end('Refused');return;}
  used=true;
  try {
    let body='';for await(const chunk of request){body+=chunk.toString();if(Buffer.byteLength(body)>2048)throw new Error('Oversized request.');}
    const secret=new URLSearchParams(body).get('secret');if(!secret||secret.length>256)throw new Error('Secret missing.');
    await performApprovedTest(secret);
    response.end('<!doctype html><title>Relay provider test verified</title><h1>Dummy account removal verified</h1><p>Independent read confirms absence. Temporary grant revocation remains required.</p>');
    console.log('PASS: approved generated provider identity removed and independently verified; revoke temporary grant now.');
  } catch {
    await record({stage:'held-for-review',runId});response.writeHead(409);
    response.end('<!doctype html><title>Relay test held</title><h1>Test held for review</h1><p>No automatic retry. Private stage evidence retained.</p>');
    console.log('Provider test held for review; inspect private stage evidence and remove the temporary grant.');
  } finally {server.close();}
});
server.listen(port,'127.0.0.1',()=>console.log(`${origin}${pathname}`));
