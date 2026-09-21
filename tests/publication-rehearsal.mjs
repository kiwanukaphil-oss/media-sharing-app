import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const compiled = await build({entryPoints:['deploy/publication-rehearsal-worker.ts'],bundle:true,write:false,format:'esm',platform:'browser'});
const key='c'.repeat(64);
const emulator = new Miniflare(convertV4MiniflareOptions({ workers:[{name:'isolated-publication-rehearsal',modules:true,
  script:compiled.outputFiles[0].text,compatibilityDate:'2026-09-21',d1Databases:['DB'],r2Buckets:['BUCKET'],
  bindings:{REHEARSAL_KEY:key,REHEARSAL_EXPIRES_AT:String(Date.now()+3600000),REHEARSAL_RUN_ENABLED:'true'}}]}));
try {
  await emulator.ready;
  const database=await emulator.getD1Database('DB');
  const journal=JSON.parse(await readFile('drizzle/meta/_journal.json','utf8')).entries;
  for(const migration of journal) for(const statement of (await readFile(`drizzle/${migration.tag}.sql`,'utf8')).split('--> statement-breakpoint')) {
    if(statement.trim()) await database.prepare(statement.trim()).run();
  }
  // All mutations/deletions here concern disposable local D1/R2 fixtures, never cloud resources.
  const invoke=async (operation,signingKey=key,timestamp=Date.now(),origin) => emulator.dispatchFetch('https://rehearsal.invalid/',{
    method:'POST',headers:{'X-Rehearsal-Operation':operation,'X-Rehearsal-Time':String(timestamp),
      'X-Rehearsal-Signature':createHmac('sha256',signingKey).update(`${timestamp}.${operation}`).digest('hex'),...(origin?{Origin:origin}:{})}});
  assert.equal((await emulator.dispatchFetch('https://rehearsal.invalid/')).status,403);
  assert.equal((await invoke('seed:copy','d'.repeat(64))).status,403);
  assert.equal((await invoke('seed:copy',key,Date.now()-300001)).status,403);
  assert.equal((await invoke('seed:copy',key,Date.now(),'https://evil.example')).status,403);
  assert.equal((await invoke('arbitrary-sql')).status,403);
  await database.prepare("INSERT INTO spaces(id,name,created_at) VALUES ('existing','Existing data',1)").run();
  assert.equal((await invoke('seed:copy')).status,503,'Populated application storage must never become rehearsal storage.');
  assert.equal(await database.prepare("SELECT name FROM sqlite_schema WHERE name='publication_rehearsal_state'").first(),null);
  await database.prepare("DELETE FROM spaces WHERE id='existing'").run();
  const bucket=await emulator.getR2Bucket('BUCKET');
  await bucket.put('existing-object','Other data');
  assert.equal((await invoke('seed:copy')).status,503,'Populated object storage must also fail closed.');
  await bucket.delete('existing-object');
  for(const scenario of ['copy','interruption','revocation','cancellation']) {
    const seeded=await invoke(`seed:${scenario}`);
    assert.equal(seeded.status,200,`Seed ${scenario}: ${await seeded.text()}`);
    const completed=await invoke(`run:${scenario}`);
    assert.equal(completed.status,200,`Run ${scenario}: ${await completed.text()}`);
  }
  console.log('PASS: isolated expiring rehearsal receiver, nonempty-storage rejection, real-R2 copy, interrupted retry, revoked authority and cancelled-copy cleanup.');
} finally { await emulator.dispose(); }

// An unarmed test runner and expired deployment grants are rejected before storage is accessed.
for (const bindings of [
  {REHEARSAL_KEY:key,REHEARSAL_EXPIRES_AT:String(Date.now()+3600000),REHEARSAL_RUN_ENABLED:'false'},
  {REHEARSAL_KEY:key,REHEARSAL_EXPIRES_AT:String(Date.now()-1),REHEARSAL_RUN_ENABLED:'true'},
]) {
  const blocked=new Miniflare(convertV4MiniflareOptions({workers:[{name:'blocked-rehearsal',modules:true,
    script:compiled.outputFiles[0].text,compatibilityDate:'2026-09-21',bindings}]}));
  try {
    const timestamp=Date.now(),operation='run:copy';
    const response=await blocked.dispatchFetch('https://rehearsal.invalid/',{method:'POST',headers:{
      'X-Rehearsal-Operation':operation,'X-Rehearsal-Time':String(timestamp),
      'X-Rehearsal-Signature':createHmac('sha256',key).update(`${timestamp}.${operation}`).digest('hex')}});
    assert.equal(response.status,403);
  } finally {await blocked.dispose();}
}
