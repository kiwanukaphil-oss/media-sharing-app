import assert from 'node:assert/strict';
import { reconcileLiveObjectInventory } from '../scripts/reconcile-live-object-inventory.mjs';

const metadata = {personalSpaces:[{spaceId:'private-space',personId:'person'}],attempts:[{objectKey:'attempt',publicationId:'copy',personId:'person',phase:'copying'}],media:[
  {id:'private',spaceId:'private-space',objectKey:'private-key',size:10,status:'ready',uploadId:'finished',archivedAt:1,previewReady:1,previewSize:4},
  {id:'shared',spaceId:'shared-space',objectKey:'shared-key',size:10,status:'ready',uploadId:'finished-copy',archivedAt:null,previewReady:0,previewSize:0},
  {id:'pending',spaceId:'private-space',objectKey:'pending-key',size:20,status:'uploading',uploadId:'pending-upload',archivedAt:null,previewReady:0,previewSize:0},
]};
const object = (key,size) => ({key,size,etag:'opaque-etag'});
const catalog = {bucketName:'relay-media-originals',listingComplete:true,fingerprint:'fixture',
  objects:[object('private-key',10),object('private-key.preview.jpg',4),object('shared-key',10),object('attempt',10),object('operations/identity-monitor-v1.json',80)],
  unfinishedUploads:[{key:'pending-key',uploadId:'pending-upload',initiatedAt:'2026-09-21T00:00:00Z'}]};
const good = reconcileLiveObjectInventory(metadata,catalog);
assert.deepEqual(good.anomalies,[]); assert.equal(good.executable,false); assert.equal(good.writeFreezeVerified,false);
assert.equal(good.matches.find(match=>match.key==='private-key').references[0].archived,true);
assert.equal(good.matches.find(match=>match.key==='private-key').references[0].personalOwner,'person');
assert.equal(good.matches.find(match=>match.key==='shared-key').references[0].personalOwner,null);
assert.deepEqual(good.multipart[0].mediaIds,['pending']);
const missing = reconcileLiveObjectInventory(metadata,{...catalog,objects:catalog.objects.filter(entry=>entry.key!=='private-key')});
assert.ok(missing.anomalies.some(entry=>entry.kind==='required-object-missing'),'Trash still requires the original.');
const changed = reconcileLiveObjectInventory(metadata,{...catalog,objects:catalog.objects.map(entry=>({...entry,size:999}))});
assert.equal(changed.anomalies.filter(entry=>entry.kind==='object-size-mismatch').length,3);
const orphan = reconcileLiveObjectInventory(metadata,{...catalog,objects:[...catalog.objects,object('unknown',7),object('shared-key.preview.jpg',7)]});
assert.ok(orphan.anomalies.some(entry=>entry.kind==='unreferenced-object-review'));
assert.ok(orphan.anomalies.some(entry=>entry.kind==='uncommitted-preview-review'));
for (const unfinishedUploads of [[{key:'private-key',uploadId:'finished'}],[{key:'unknown',uploadId:'unknown'}]]) {
  assert.ok(reconcileLiveObjectInventory(metadata,{...catalog,unfinishedUploads}).anomalies.some(entry=>entry.kind==='multipart-ownership-review'));
}
assert.throws(()=>reconcileLiveObjectInventory(metadata,{...catalog,listingComplete:false}));
assert.throws(()=>reconcileLiveObjectInventory(metadata,{...catalog,objects:[...catalog.objects,catalog.objects[0]]}),/Duplicate/);
assert.throws(()=>reconcileLiveObjectInventory({...metadata,media:[...metadata.media,metadata.media[0]]},catalog),/Invalid/);
assert.throws(()=>reconcileLiveObjectInventory({...metadata,media:[{...metadata.media[0],status:'unknown'}]},catalog),/Invalid/);
console.log('PASS: live originals, previews, Trash, shared copies, multipart and publication references; anomalies remain non-executable review.');
