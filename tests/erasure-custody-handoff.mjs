import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { createSigningCustodyServer } from '../scripts/prepare-erasure-signing-custody.mjs';

const password='test-only-15chr!';
let received,release;
const held=new Promise(resolve=>{release=resolve;});
let entered;
const started=new Promise(resolve=>{entered=resolve;});
const {server,pathname}=createSigningCustodyServer(async value=>{received=value;entered();await held;},()=>{});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`,url=origin+pathname;
const post=(body,headers={})=>fetch(url,{method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded',...headers},body});
const valid=new URLSearchParams({password,confirmation:password,saved:'yes'}).toString();
try {
  const form=await fetch(url);
  assert.equal(form.status,200);assert.equal(form.headers.get('cache-control'),'no-store');
  assert.match(form.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  assert.match(await form.text(),/minlength="15"/);
  assert.equal((await fetch(origin+'/wrong')).status,404);
  const wrongHost=await new Promise((resolve,reject)=>{
    const request=httpRequest(url,{headers:{Host:'localhost:'+server.address().port}},response=>{response.resume();response.on('end',()=>resolve(response.statusCode));});
    request.on('error',reject);request.end();
  });
  assert.equal(wrongHost,404);
  assert.equal((await fetch(url,{headers:{'Sec-Fetch-Site':'cross-site'}})).status,200,'A handoff link may read the empty form without causing changes');
  assert.equal((await post(valid,{Origin:'https://other.example'})).status,403);
  assert.equal((await post(valid,{'Content-Type':'application/json'})).status,400);
  for(const body of [valid+'&password=duplicate',valid.replace('saved=yes','saved=no'),new URLSearchParams({password,confirmation:'wrong',saved:'yes'}).toString(),'x'.repeat(4097)]) {
    const rejected=await post(body);assert.equal(rejected.status,400);assert.equal((await rejected.text()).includes(password),false);
  }
  assert.equal((await post(new URLSearchParams({password:'a'.repeat(14),confirmation:'a'.repeat(14),saved:'yes'}))).status,400);
  assert.equal(received,undefined);
  const completed=post(valid);await started;
  assert.equal((await post(valid)).status,403,'Only one provisioning call is admitted');
  release();const success=await completed;
  assert.equal(success.status,200);assert.equal(received,password);
  assert.equal((await success.text()).includes(password),false);
  console.log('PASS: loopback custody handoff Host/Origin/path checks, hidden input, no reflection, bounded/strict form, mismatch rejection and single-use admission. No production key or backup created.');
} finally {release();if(server.listening)await new Promise(resolve=>server.close(resolve));}
