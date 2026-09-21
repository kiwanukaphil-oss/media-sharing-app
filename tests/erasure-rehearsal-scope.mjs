import assert from 'node:assert/strict';
import { backupBucketId } from '../scripts/backup-storage.mjs';
import { rehearsalBucketId, rehearsalPrefix, validateRehearsalAccess, planGeneratedVersionRemoval } from '../scripts/erasure-rehearsal-scope.mjs';

const allowed = { buckets:[{id:rehearsalBucketId}], namePrefix:rehearsalPrefix,
  capabilities:['listBuckets','listFiles','readFiles','shareFiles','writeFiles','deleteFiles'] };
validateRehearsalAccess(allowed);
for (const changed of [
  {...allowed,namePrefix:'relay/'}, {...allowed,buckets:[{id:'wrong'}]},
  {...allowed,buckets:[{id:backupBucketId}]},
  {...allowed,buckets:[...allowed.buckets,{id:'another'}]},
  {...allowed,capabilities:['listFiles','readFiles']},
  ...['writeKeys','deleteBuckets','writeFileRetentions','writeFileLegalHolds','bypassGovernance','listAllBucketNames']
    .map(capability => ({...allowed,capabilities:[...allowed.capabilities,capability]})),
]) assert.throws(()=>validateRehearsalAccess(changed),/scope/);
const records = ['obsolete-private','obsolete-private','retained-shared','retained-snapshot'].map((purpose,index) =>
  ({purpose,fileId:`generated-${index}`,fileName:`${rehearsalPrefix}${index<2?'old.sql':index}`,sha256:'a'.repeat(64),size:4}));
const catalog = records.map(record => ({...record,bucketId:rehearsalBucketId,action:'upload',contentLength:record.size,fileInfo:{sha256:record.sha256}}));
const plan = planGeneratedVersionRemoval(records,catalog);
assert.equal(plan.remove.length,2,'Both old versions are selected, not only the latest name.');
assert.equal(plan.preserve.length,2,'Shared bytes and replacement snapshot remain.');
for (const changed of [catalog.slice(1), [...catalog,catalog[0]],
  catalog.map((r,i)=>i ? r : {...r,fileId:'unknown'}),
  catalog.map((r,i)=>i ? r : {...r,action:'hide'}),
  catalog.map((r,i)=>i ? r : {...r,contentLength:5}),
  catalog.map((r,i)=>i ? r : {...r,fileInfo:{sha256:'b'.repeat(64)}}),
]) assert.throws(()=>planGeneratedVersionRemoval(records,changed));
assert.throws(()=>planGeneratedVersionRemoval(records.map((r,i)=>i?r:{...r,fileName:'relay/originals/production'}),catalog));
assert.throws(()=>planGeneratedVersionRemoval(records.map(r=>({...r,purpose:'obsolete-private'})),catalog),/preservation/);
console.log('PASS: exact rehearsal access, production prefix rejection, immutable version matching and shared/snapshot preservation.');
