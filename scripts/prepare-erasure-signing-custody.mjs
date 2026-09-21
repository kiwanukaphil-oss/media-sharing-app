import { createServer } from 'node:http';
import { randomBytes,sign,verify } from 'node:crypto';
import { access,mkdir,readFile,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { authorizeBackupRole,downloadBackupFile,operationsDirectory,runPrivateCommand,uploadBackupFile } from './backup-storage.mjs';
import { createErasureSigningVault,openErasureSigningVault } from './erasure-signing-vault.mjs';

const custodyDirectory=resolve(operationsDirectory,'erasure-signing-custody');
const form=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Relay recovery custody</title><style>body{font:17px/1.55 system-ui;margin:0;background:#f5f5f2;color:#202a27}main{max-width:580px;margin:7vh auto;padding:36px;background:white;border:1px solid #ddd;border-radius:18px}h1{font-size:29px;line-height:1.2}label{display:block;margin:22px 0}input[type=password]{box-sizing:border-box;width:100%;padding:12px;border:1px solid #aaa;border-radius:8px;font:inherit}button{padding:13px 18px;border:0;border-radius:9px;background:#244d3d;color:white;font:inherit;cursor:pointer}small{display:block;color:#59625f}a{color:inherit}</style>
<main><small>RELAY · OPERATOR RECOVERY</small><h1>Keep recovery decisions recoverable</h1>
<p>Create a unique password in your password manager and save it as <strong>Relay recovery custody</strong>. Enter it below; do not send it in chat.</p>
<p>This creates a signing key on this PC, protected by Windows encryption, and backs up a password-encrypted copy to your existing Backblaze backup bucket. It does not delete accounts, change access or buy a service.</p>
<form method="post"><label>Recovery password <input type="password" name="password" autocomplete="new-password" minlength="15" maxlength="256" required></label>
<label>Confirm recovery password <input type="password" name="confirmation" autocomplete="new-password" minlength="15" maxlength="256" required></label>
<label><input type="checkbox" name="saved" value="yes" required> I saved this unique password in my password manager.</label>
<button>Create and verify encrypted backup</button></form><p><small>Use at least 15 characters. Your password is used locally and is not stored or sent to Backblaze. The encrypted backup will be downloaded and tested before setup is marked complete.</small></p></main></html>`;

// Provision only after the user's same-origin form submission. Existing writer/reader roles are reused;
// only encrypted key material enters B2, and the recovered key must verify against the new public root.
// This creates custody, not a ledger decision or deletion authority. Partial setup is retained for review.
export async function provisionErasureSigningCustody(password) {
  const [writer,reader]=await Promise.all([authorizeBackupRole('writer'),authorizeBackupRole('reader')]);
  const {root,privateKey,vault}=await createErasureSigningVault(password);
  await mkdir(custodyDirectory,{recursive:false});
  const sealed=await runPrivateCommand('powershell.exe',['-NoProfile','-NonInteractive','-Command',
    '$ErrorActionPreference="Stop"; $inputValue=[Console]::In.ReadToEnd(); $protectedValue=ConvertTo-SecureString -String $inputValue -AsPlainText -Force; [Console]::Out.Write((ConvertFrom-SecureString -SecureString $protectedValue))'],
    JSON.stringify({...root,privateKey:privateKey.export({type:'pkcs8',format:'pem'})}));
  if(!/^[a-f0-9]+$/i.test(sealed.trim())) throw new Error('Local protection failed.');
  await writeFile(resolve(custodyDirectory,'signing-key.dpapi'),sealed.trim(),{flag:'wx',mode:0o600});
  await writeFile(resolve(custodyDirectory,'public-root.json'),JSON.stringify(root,null,2),{flag:'wx',mode:0o600});
  const vaultPath=resolve(custodyDirectory,'signing-vault.json');
  await writeFile(vaultPath,JSON.stringify(vault),{flag:'wx',mode:0o600});
  const remote=await uploadBackupFile(writer,vaultPath,`relay/erasure-ledger/key-vaults/${root.keyId}.json`);
  await writeFile(resolve(custodyDirectory,'remote-version.json'),JSON.stringify(remote,null,2),{flag:'wx',mode:0o600});
  const restoredPath=resolve(custodyDirectory,'restored-signing-vault.json');
  await downloadBackupFile(reader,remote,restoredPath);
  const restored=await openErasureSigningVault(JSON.parse(await readFile(restoredPath,'utf8')),password,root);
  const challenge=randomBytes(32);
  if(!verify(null,challenge,root.publicKey,sign(null,challenge,restored))) throw new Error('Independent key recovery failed.');
  await writeFile(resolve(custodyDirectory,'verification.json'),JSON.stringify({status:'verified',verifiedAt:new Date().toISOString(),
    ledgerId:root.ledgerId,keyId:root.keyId,remote,signingAuthorityDeployed:false,realDecisionsSigned:false},null,2),{flag:'wx',mode:0o600});
}

// No secret is rendered, logged or reflected. A single-use random path, exact Host/Origin checks,
// frame denial, bounded input and same-origin form protect this short-lived loopback-only handoff.
export function createSigningCustodyServer(provision=provisionErasureSigningCustody,reportStatus=console.log) {
  const pathname='/'+randomBytes(24).toString('hex'); let used=false;
  const server=createServer(async(request,response)=>{
    const address=server.address();
    if(!address || typeof address==='string') {response.writeHead(503);response.end('Setup closed');return;}
    const origin=`http://127.0.0.1:${address.port}`;
    response.setHeader('Content-Type','text/html; charset=utf-8');response.setHeader('Cache-Control','no-store');
    response.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    response.setHeader('Referrer-Policy','no-referrer');response.setHeader('X-Content-Type-Options','nosniff');
    if(request.headers.host!==`127.0.0.1:${address.port}` || request.url!==pathname) {response.writeHead(404);response.end('Not found');return;}
    if(request.method==='GET') {
      // GET renders only an empty form, so direct handoff links can open from the browser extension.
      // All changes still require the exact same-origin POST; framing and secret reflection stay blocked.
      response.end(used?'Setup closed':form);return;
    }
    if(request.method!=='POST' || request.headers.origin!==origin || used) {response.writeHead(403);response.end('Refused');return;}
    used=true; let provisioning=false;
    try {
      if(request.headers['content-type']!=='application/x-www-form-urlencoded' || Number(request.headers['content-length'])>4096) throw new Error('Invalid input');
      let body='';for await(const chunk of request) {body+=chunk;if(Buffer.byteLength(body)>4096)throw new Error('Input too large');}
      const fields=new URLSearchParams(body),password=fields.get('password'),confirmation=fields.get('confirmation');
      if([...fields.keys()].sort().join(',')!=='confirmation,password,saved' || fields.get('saved')!=='yes' ||
          !password || password!==confirmation || password.length>256 || password.trim().length<15) throw new Error('Invalid input');
      provisioning=true;await provision(password);
      response.end('<title>Relay custody verified</title><h1>Encrypted recovery backup verified</h1><p>Keep the saved password in your password manager. No account was deleted and no real erasure decision was signed.</p>');
      reportStatus('Erasure signing custody encrypted, backed up and independently restored; no secrets logged.');
    } catch {
      response.writeHead(provisioning?500:400);
      response.end(provisioning?'<h1>Setup paused for review</h1><p>Any staged encrypted files have been retained. No real deletion decision was signed.</p>':form.replace('<h1>Keep recovery decisions recoverable</h1>','<h1>Check the password fields</h1><p>Use matching passwords of at least 15 characters and confirm you saved the password.</p>'));
      if(provisioning) reportStatus('Custody setup stopped; inspect encrypted local evidence privately.');
      else used=false;
    } finally {if(provisioning)server.close();}
  });
  server.requestTimeout=30000;server.headersTimeout=10000;
  return {server,pathname};
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  let exists=false;try {await access(custodyDirectory);exists=true;} catch {}
  if(exists) throw new Error('Existing signing custody requires review; replacement is not automatic.');
  const {server,pathname}=createSigningCustodyServer();
  server.listen(8796,'127.0.0.1',()=>console.log(`Local custody setup: http://127.0.0.1:8796${pathname}`));
  setTimeout(()=>server.close(),1800000).unref();
}
