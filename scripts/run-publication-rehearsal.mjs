import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { runPrivateCommand } from './backup-storage.mjs';

// Pin the isolated test service and decrypt its expiring key only in memory; no production credential is read.
async function runPublicationRehearsal(mode) {
  if (!['seed','run'].includes(mode)) throw new Error('Choose seed or run for the isolated publication rehearsal.');
  const config=JSON.parse(await readFile('deploy/wrangler.publication-rehearsal.json','utf8'));
  if (config.name!=='relay-publication-rehearsal'||config.d1_databases[0].database_id!=='a22d670e-2a20-4266-9f07-0601406a0d56'||
    config.r2_buckets[0].bucket_name!=='relay-publication-rehearsal'||Date.now()>=Number(config.vars.REHEARSAL_EXPIRES_AT)) {
    throw new Error('Isolated rehearsal scope or expiry needs review.');
  }
  if(mode==='run' && config.vars.REHEARSAL_RUN_ENABLED!=='true') throw new Error('Cloud rehearsal execution is not armed. Verify isolated resources before enabling it.');
  const sealed=await readFile('.sites-runtime/operations/publication-rehearsal-key.dpapi','utf8');
  const key=await runPrivateCommand('powershell.exe',['-NoProfile','-NonInteractive','-Command',
    '$ErrorActionPreference="Stop"; $sealed=[Console]::In.ReadToEnd(); $value=ConvertTo-SecureString $sealed; $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($value); try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }'],sealed);
  for(const scenario of ['copy','interruption','revocation','cancellation']) {
    const operation=`${mode}:${scenario}`,timestamp=String(Date.now());
    const signature=createHmac('sha256',key).update(`${timestamp}.${operation}`).digest('hex');
    const response=await fetch('https://relay-publication-rehearsal.kiwanukaphil.workers.dev/',{method:'POST',redirect:'error',
      headers:{'X-Rehearsal-Operation':operation,'X-Rehearsal-Time':timestamp,'X-Rehearsal-Signature':signature},signal:AbortSignal.timeout(60000)});
    if(response.status!==200) throw new Error(`Isolated ${operation} did not pass (HTTP ${response.status}).`);
    const result=await response.json();
    if(result.status!=='passed'||result.operation!==operation) throw new Error('Isolated rehearsal response did not match the requested operation.');
    console.log(`PASS: isolated ${operation}.`);
  }
}

try { await runPublicationRehearsal(process.argv[2]); }
catch { console.error('Isolated publication rehearsal stopped; check scope, arming, expiry and private deployment diagnostics. No private response was logged.'); process.exitCode=1; }
