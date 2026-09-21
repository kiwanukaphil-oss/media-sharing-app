import assert from 'node:assert/strict';
import { inventoryBackupVersions } from '../scripts/inventory-backup-versions.mjs';
import { backupBucketId } from '../scripts/backup-storage.mjs';

const file = (fileId, action='upload') => ({ bucketId:backupBucketId, fileId, fileName:'relay/originals/same-name',
  action, contentLength:action === 'upload' ? 12 : 0, fileInfo:{ privateName:'Never retain', sha256:'a'.repeat(64) } });
const calls = [];
const inventory = await inventoryBackupVersions(async (operation, parameters) => {
  calls.push({ operation, parameters });
  if (operation === 'b2_list_unfinished_large_files') return { files:[file('unfinished','start')], nextFileId:null };
  if (!parameters.startFileId) return { files:[file('new'),file('hide','hide')], nextFileId:'old', nextFileName:'relay/originals/same-name' };
  assert.equal(parameters.startFileId,'old');
  assert.equal(parameters.startFileName,'relay/originals/same-name');
  return { files:[file('old')], nextFileId:null, nextFileName:null };
});
assert.equal(inventory.versions.length,3);
assert.equal(inventory.unfinished.length,1);
assert.equal(inventory.executable,false);
assert.equal(inventory.atomicSnapshot,false);
assert.ok(inventory.versions.every(record => !record.retentionKnown && !record.legalHoldKnown));
assert.doesNotMatch(JSON.stringify(inventory), /Never retain/);
assert.ok(calls.every(call => call.parameters.bucketId === backupBucketId));
assert.ok(calls.filter(call => call.operation === 'b2_list_file_versions').every(call => call.parameters.prefix === 'relay/'));
assert.ok(calls.filter(call => call.operation === 'b2_list_unfinished_large_files').every(call => call.parameters.namePrefix === 'relay/' && call.parameters.maxFileCount === 100));
for (const invalid of [
  {files:[{...file('bad'),bucketId:'another'}],nextFileId:null,nextFileName:null},
  {files:[{...file('bad'),fileName:'outside/file'}],nextFileId:null,nextFileName:null},
  {files:[file('same'),file('same')],nextFileId:null,nextFileName:null},
  {files:[file('future','unknown')],nextFileId:null,nextFileName:null},
  {files:[],nextFileId:'next',nextFileName:null},
  {files:[]},
]) await assert.rejects(inventoryBackupVersions(async () => invalid));
await assert.rejects(inventoryBackupVersions(async () => ({files:[],nextFileId:'cycle',nextFileName:'relay/cycle'})),/cursor/);
await assert.rejects(inventoryBackupVersions(async () => { throw new Error('Unavailable'); }), /Unavailable/);
const unfinishedPages = await inventoryBackupVersions(async (operation, parameters) => {
  if (operation === 'b2_list_file_versions') return { files:[], nextFileId:null, nextFileName:null };
  if (!parameters.startFileId) return { files:[file('first','start')], nextFileId:'second' };
  assert.equal(parameters.startFileId,'second');
  assert.equal(parameters.namePrefix,'relay/');
  assert.equal(parameters.startFileName,undefined);
  return { files:[file('second','start')], nextFileId:null };
});
assert.equal(unfinishedPages.unfinished.length,2);
console.log('PASS: all-version pagination, hidden/old versions, unfinished uploads, private metadata, malformed pages and cursor failures.');
