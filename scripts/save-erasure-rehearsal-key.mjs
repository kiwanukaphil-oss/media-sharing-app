import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runPrivateCommand, operationsDirectory } from './backup-storage.mjs';
import { authorizeRehearsalCredential } from './erasure-rehearsal-storage.mjs';

const port=8793, origin=`http://127.0.0.1:${port}`, pathname=`/${randomBytes(24).toString('hex')}`;
let used=false;
const html=`<!doctype html><title>Relay isolated rehearsal key</title><h1>Save the isolated test key</h1>
<p>Only the temporary key for the separate rehearsal bucket is accepted. Windows encrypts it locally.</p>
<form method="post"><label>Key ID <input name="keyId" autocomplete="off" required></label>
<label>Application key <input name="secret" type="password" autocomplete="off" required></label>
<button>Verify scope and save encrypted key</button></form>`;

// Single-use loopback form with a random path, strict origin/host checks and no third-party resources.
// Secret values are sent through subprocess stdin and never appear in command lines, files or logs.
const server=createServer(async(request,response)=>{
  response.setHeader('Content-Type','text/html; charset=utf-8');
  response.setHeader('Cache-Control','no-store');
  response.setHeader('Content-Security-Policy',"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  response.setHeader('Referrer-Policy','no-referrer');
  if(request.headers.host!==`127.0.0.1:${port}`||request.url!==pathname){response.writeHead(404);response.end('Not found');return;}
  if(request.method==='GET'){response.end(used?'Form closed':html);return;}
  if(request.method!=='POST'||request.headers.origin!==origin||used){response.writeHead(403);response.end('Refused');return;}
  used=true;
  try{
    let body='';
    for await(const chunk of request){body+=chunk;if(body.length>4096)throw new Error('Input too large');}
    const fields=new URLSearchParams(body);
    const credential={applicationKeyId:fields.get('keyId')?.trim(),applicationKey:fields.get('secret')?.trim(),savedAt:Date.now()};
    const session=await authorizeRehearsalCredential(credential);
    const encrypted=await runPrivateCommand('powershell.exe',['-NoProfile','-NonInteractive','-Command',
      '$ErrorActionPreference="Stop"; $inputValue=[Console]::In.ReadToEnd(); $protectedValue=ConvertTo-SecureString -String $inputValue -AsPlainText -Force; [Console]::Out.Write((ConvertFrom-SecureString -SecureString $protectedValue))'],JSON.stringify(credential));
    if(!/^[a-f0-9]+$/i.test(encrypted.trim()))throw new Error('Encryption failed');
    await writeFile(resolve(operationsDirectory,'erasure-isolated-test.dpapi'),encrypted.trim(),{flag:'wx',mode:0o600});
    await writeFile(resolve(operationsDirectory,'erasure-isolated-test-scope.json'),JSON.stringify({allowed:session.allowed,verifiedAt:new Date().toISOString()}),{flag:'wx',mode:0o600});
    response.end('<h1>Test key scope verified and encrypted locally</h1><p>No storage objects were changed.</p>');
    console.log('Isolated test credential verified and saved with Windows encryption.');
  }catch{response.writeHead(500);response.end('<h1>Key was not accepted</h1><p>Review the scope privately; no cloud mutation attempted.</p>');console.log('Isolated key handoff stopped without exposing credentials.');}
  finally{server.close();}
});
server.listen(port,'127.0.0.1',()=>console.log(`Local key handoff: ${origin}${pathname}`));
setTimeout(()=>server.close(),600000).unref();
