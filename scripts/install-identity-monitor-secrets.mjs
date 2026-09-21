import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { operationsDirectory, runPrivateCommand } from './backup-storage.mjs';
import { inspectAuth0Recovery } from '../lib/provider-recovery-monitor.mjs';

const clientId='1Rakur48pyVj6WOVy3Yyb4cY31E0IEpb';
const port=8794,origin=`http://127.0.0.1:${port}`,pathname=`/${randomBytes(24).toString('hex')}`;
let used=false;
async function readProtectedValue(name) {
  const sealed=await readFile(resolve(operationsDirectory,name),'utf8');
  return runPrivateCommand('powershell.exe',['-NoProfile','-NonInteractive','-Command',
    '$ErrorActionPreference="Stop"; $sealed=[Console]::In.ReadToEnd(); $value=ConvertTo-SecureString $sealed; $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($value); try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }'],sealed);
}

// Install only existing monitor credentials into the dedicated disabled Worker. No new provider grant,
// D1 binding or account-recovery signing secret is created. Wrangler receives secret JSON through stdin.
async function installReadOnlyMonitorSecrets(clientSecret) {
  await inspectAuth0Recovery([],{clientId,clientSecret});
  const d1=JSON.parse(await readProtectedValue('hosted-d1.dpapi')).token;
  const report=await readProtectedValue('relay-monitor-secret.dpapi');
  if(typeof d1!=='string'||!d1||!/^[a-f0-9]{64}$/.test(report))throw new Error('Existing monitor credentials are unavailable.');
  const encrypted=await runPrivateCommand('powershell.exe',['-NoProfile','-NonInteractive','-Command',
    '$ErrorActionPreference="Stop"; $inputValue=[Console]::In.ReadToEnd(); $protectedValue=ConvertTo-SecureString -String $inputValue -AsPlainText -Force; [Console]::Out.Write((ConvertFrom-SecureString -SecureString $protectedValue))'],clientSecret);
  if(!/^[a-f0-9]+$/i.test(encrypted.trim()))throw new Error('Encryption failed.');
  await writeFile(resolve(operationsDirectory,'auth0-read-monitor.dpapi'),encrypted.trim(),{flag:'wx',mode:0o600});
  await runPrivateCommand(process.execPath,['--import','./scripts/sites-env.mjs','node_modules/wrangler/bin/wrangler.js',
    'secret','bulk','-c','deploy/wrangler.identity-monitor.jsonc'],JSON.stringify({AUTH0_MONITOR_CLIENT_ID:clientId,
    AUTH0_MONITOR_CLIENT_SECRET:clientSecret,CLOUDFLARE_D1_READ_TOKEN:d1,RELAY_MONITOR_SECRET:report}));
}

// Single-use same-origin loopback form; secret never appears in URLs, console output or plaintext files.
const server=createServer(async(request,response)=>{
  response.setHeader('Content-Type','text/html; charset=utf-8');response.setHeader('Cache-Control','no-store');
  response.setHeader('Content-Security-Policy',"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  response.setHeader('Referrer-Policy','same-origin');
  if(request.headers.host!==`127.0.0.1:${port}`||request.url!==pathname){response.writeHead(404);response.end('Not found');return;}
  if(request.method==='GET'){response.end(used?'Form closed':`<!doctype html><title>Relay scheduled monitor setup</title>
    <h1>Install the existing read-only monitor credential</h1><p>Destination: Cloudflare Worker relay-identity-monitor. Scheduling remains disabled.</p>
    <form method="post"><label>Auth0 monitor client secret <input type="password" name="secret" autocomplete="off" required maxlength="256"></label>
    <button>Verify and install encrypted monitor credentials</button></form>`);return;}
  if(request.method!=='POST'||request.headers.origin!==origin||used){response.writeHead(403);response.end('Refused');return;}
  used=true;
  try{
    let body='';for await(const chunk of request){body+=chunk;if(body.length>4096)throw new Error('Input too large');}
    const secret=new URLSearchParams(body).get('secret')?.trim();
    if(!secret||secret.length>256)throw new Error('Missing credential');
    await installReadOnlyMonitorSecrets(secret);
    response.end('<h1>Read-only monitor credentials installed</h1><p>Scheduling remains disabled until activation and verification.</p>');
    console.log('Existing read-only monitor credentials installed; no secrets logged.');
  }catch{response.writeHead(500);response.end('<h1>Installation stopped</h1><p>Review encrypted local and Worker settings privately before retrying.</p>');console.log('Monitor setup stopped; no private diagnostics logged.');}
  finally{server.close();}
});
server.listen(port,'127.0.0.1',()=>console.log(`Local monitor setup: ${origin}${pathname}`));
setTimeout(()=>server.close(),600000).unref();
