import assert from 'node:assert/strict';
import { randomUUID,createHmac } from 'node:crypto';
import { mkdir,readFile } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { backupCoordinationTransport,runCoordinatedBackup } from '../scripts/backup-closure-client.mjs';
import { backupCoordinationVariables } from '../scripts/backup-coordination-config.mjs';

const root=resolve('.sites-runtime/backup-coordination-tests',randomUUID());await mkdir(root,{recursive:true});
const secret='b'.repeat(64),commands=[],snapshotId=`${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID()}`;
const receipt={sha256:'a'.repeat(64)};
async function directory(name){const path=join(root,name);await mkdir(path);return path;}
const transport=backupCoordinationTransport({RELAY_BACKUP_COORDINATION_ENABLED:'true',RELAY_BACKUP_COORDINATION_SECRET:secret},async(url,options)=>{
  assert.equal(url,'https://relayalbums.com/api/operations/backup-coordination');assert.equal(options.redirect,'error');
  assert.equal(options.headers['X-Relay-Backup-Signature'],createHmac('sha256',secret).update(`relay-backup-coordination-v1.${options.headers['X-Relay-Backup-Time']}.${options.body}`).digest('hex'));
  const command=JSON.parse(options.body);commands.push(command);
  return Response.json({...command,state:command.action==='begin'?'active':command.outcome});
});
assert.equal(backupCoordinationTransport({}),null);
assert.deepEqual(backupCoordinationVariables({enabled:false}),{});
assert.deepEqual(backupCoordinationVariables({enabled:true}),{RELAY_BACKUP_COORDINATION_ENABLED:'true'});
for(const configuration of [null,{}, {enabled:'true'}, {enabled:true,secret:'forbidden'}, {enabled:true,closureTracking:true}])
  assert.throws(()=>backupCoordinationVariables(configuration),/public backup/);
assert.throws(()=>backupCoordinationTransport(backupCoordinationVariables({enabled:true})),/incomplete/);
for(const environment of [{RELAY_BACKUP_COORDINATION_ENABLED:'true'},{RELAY_BACKUP_COORDINATION_SECRET:secret},{RELAY_BACKUP_COORDINATION_ENABLED:'false',RELAY_BACKUP_COORDINATION_SECRET:secret}])
  assert.throws(()=>backupCoordinationTransport(environment),/incomplete/);
let started=false,release;
const paused=new Promise(resolve=>{release=resolve;});
let announce;const copying=new Promise(resolve=>{announce=resolve;});
const successDirectory=await directory('success');
const operation=runCoordinatedBackup(snapshotId,successDirectory,async()=>{started=true;announce();await paused;return receipt;},transport);
await copying;
assert.equal(started,true);assert.deepEqual(commands.map(command=>command.action),['begin']);
release();assert.deepEqual(await operation,receipt);
assert.deepEqual(commands.map(command=>command.action),['begin','settle']);assert.equal(commands[1].outcome,'settled');
assert.equal(JSON.parse(await readFile(join(successDirectory,'coordination-intent.json'),'utf8')).id,commands[0].id);
commands.length=0;
await assert.rejects(runCoordinatedBackup(snapshotId,await directory('failed-copy'),async()=>{throw new Error('interrupted copy');},transport),/interrupted copy/);
assert.deepEqual(commands.map(command=>command.action),['begin','settle']);assert.equal(commands[1].outcome,'uncertain');
let effects=0;
await assert.rejects(runCoordinatedBackup(snapshotId,await directory('denied'),async()=>{effects++;return receipt;},async()=>{throw new Error('admission unavailable');}),/admission unavailable/);
assert.equal(effects,0);
const missing=backupCoordinationTransport({RELAY_BACKUP_COORDINATION_ENABLED:'true',RELAY_BACKUP_COORDINATION_SECRET:secret},async()=>new Response('unavailable',{status:503}));
await assert.rejects(missing({action:'begin'}),/HTTP 503/);
const wrong=backupCoordinationTransport({RELAY_BACKUP_COORDINATION_ENABLED:'true',RELAY_BACKUP_COORDINATION_SECRET:secret},async()=>Response.json({id:'different'}));
await assert.rejects(wrong({action:'begin',id:randomUUID(),snapshotId}),/does not match/);
assert.deepEqual(await runCoordinatedBackup(snapshotId,await directory('not-activated'),async()=>receipt,null),receipt);
console.log('PASS: optional inactive compatibility, strict partial-activation refusal, authenticated exact origin, admission before effects, awaited completion, uncertainty after failure, no copy after denied admission. No hosted activation.');
