import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { queryReadOnlyDatabase } from './backup-d1-readonly.mjs';
import { operationsDirectory, runPrivateCommand } from './backup-storage.mjs';
import { createReadOnlyR2InventoryRequest, inventoryR2Objects, loadR2InventoryCredential } from './inventory-r2-objects.mjs';

export const liveObjectInventoryQuery = `SELECT json_object(
  'media',json((SELECT json_group_array(json_object('id',id,'spaceId',space_id,'objectKey',object_key,'size',size,
    'status',status,'uploadId',upload_id,'archivedAt',archived_at,'previewReady',preview_ready,'previewSize',preview_size))
    FROM (SELECT * FROM media ORDER BY id))),
  'personalSpaces',json((SELECT json_group_array(json_object('spaceId',space_id,'personId',person_id))
    FROM (SELECT * FROM personal_spaces ORDER BY space_id))),
  'attempts',json((SELECT json_group_array(json_object('objectKey',a.object_key,'publicationId',a.publication_id,
    'personId',p.person_id,'phase',p.phase)) FROM publication_attempts a JOIN publications p ON p.id=a.publication_id))
) AS inventory`;
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const liveIntakeObjectInventoryQuery=`SELECT json_object(
  'attempts',json((SELECT json_group_array(json_object('objectKey',a.object_key,'uploadId',a.upload_id,'submissionId',a.submission_id,'personId',i.person_id,'state',a.state)) FROM intake_upload_attempts a JOIN intake_submissions i ON i.id=a.submission_id)),
  'capabilities',json((SELECT json_group_array(json_object('objectKey',c.object_key,'uploadId',c.upload_id,'submissionId',c.submission_id,'expiresAt',c.expires_at)) FROM intake_capabilities c))
) AS inventory`;

// Match exact database keys and upload IDs, including Trash and publication attempts. Unknown objects
// are review candidates only, never inferred to belong to an account or treated as deletion targets.
export function reconcileLiveObjectInventory(metadata, catalog) {
  if (!metadata || !Array.isArray(metadata.media) || !Array.isArray(metadata.personalSpaces) || !Array.isArray(metadata.attempts) ||
      catalog?.listingComplete !== true || catalog.bucketName !== 'relay-media-originals' ||
      !Array.isArray(catalog.objects) || !Array.isArray(catalog.unfinishedUploads)) throw new Error('Complete live inventories are required.');
  const owners = new Map(metadata.personalSpaces.map(space => [space.spaceId,space.personId]));
  if (owners.size !== metadata.personalSpaces.length) throw new Error('Duplicate personal ownership.');
  const expected = new Map(), anomalies = [], matches = [], mediaIds = new Set();
  const addReference = (key,reference) => {const entries = expected.get(key) ?? []; entries.push(reference); expected.set(key,entries);};
  for (const media of metadata.media) {
    if (typeof media.id !== 'string' || !media.id || mediaIds.has(media.id) || typeof media.objectKey !== 'string' || !media.objectKey ||
        typeof media.spaceId !== 'string' || !media.spaceId || !['uploading','publishing','ready','deleting','cancelling','collecting','receiving','pending-review','intake-rejected'].includes(media.status) ||
        !Number.isSafeInteger(media.size) || media.size < 0 || ![0,1].includes(media.previewReady) ||
        !Number.isSafeInteger(media.previewSize) || media.previewSize < 0) throw new Error('Invalid media inventory.');
    mediaIds.add(media.id);
    const reference = {mediaId:media.id,personalOwner:owners.get(media.spaceId) ?? null,spaceId:media.spaceId,
      archived:media.archivedAt !== null,status:media.status};
    if(['collecting','receiving','pending-review','intake-rejected'].includes(media.status)&&!metadata.intake)throw new Error('Intake custody inventory is required.');
    addReference(media.objectKey,{...reference,kind:media.status==='collecting'?'allowance-marker':'original',size:media.size,required:['ready','pending-review','intake-rejected'].includes(media.status)});
    addReference(`${media.objectKey}.preview.jpg`,{...reference,kind:'preview',size:media.previewSize,required:media.previewReady === 1});
  }
  for (const attempt of metadata.attempts) {
    if (typeof attempt.objectKey !== 'string' || !attempt.objectKey) throw new Error('Invalid publication attempt inventory.');
    addReference(attempt.objectKey,{kind:'publication-attempt',publicationId:attempt.publicationId,personId:attempt.personId,required:false});
    addReference(`${attempt.objectKey}.preview.jpg`,{kind:'publication-attempt-preview',publicationId:attempt.publicationId,personId:attempt.personId,required:false});
  }
  if(metadata.intake){
    if(!Array.isArray(metadata.intake.attempts)||!Array.isArray(metadata.intake.capabilities))throw new Error('Complete intake custody is required.');
    for(const record of [...metadata.intake.attempts,...metadata.intake.capabilities]){
      if(typeof record.objectKey!=='string'||!record.objectKey||typeof record.submissionId!=='string'||!record.submissionId||!(record.uploadId===null||typeof record.uploadId==='string'))throw new Error('Invalid intake custody.');
      addReference(record.objectKey,{kind:'intake-custody',submissionId:record.submissionId,personId:record.personId??null,required:false});
    }
  }
  const objectKeys = new Set();
  for (const object of catalog.objects) {
    if (objectKeys.has(object.key)) throw new Error('Duplicate live object key.');
    objectKeys.add(object.key);
    const references = expected.get(object.key) ?? [];
    const operational = object.key === 'operations/identity-monitor-v1.json';
    matches.push({key:object.key,size:object.size,etag:object.etag,references,operational});
    if (!references.length && !operational) anomalies.push({kind:'unreferenced-object-review',key:object.key});
    for (const reference of references) {
      if (reference.required && reference.size !== object.size) anomalies.push({kind:'object-size-mismatch',key:object.key,mediaId:reference.mediaId});
      if (reference.kind === 'preview' && !reference.required) anomalies.push({kind:'uncommitted-preview-review',key:object.key,mediaId:reference.mediaId});
      if(reference.kind==='allowance-marker')anomalies.push({kind:'unexpected-allowance-object-review',key:object.key});
    }
  }
  for (const [key,references] of expected) {
    if (!objectKeys.has(key) && references.some(reference => reference.required)) anomalies.push({kind:'required-object-missing',key});
  }
  const multipart = catalog.unfinishedUploads.map(upload => {
    const references = metadata.media.filter(media => media.objectKey === upload.key && media.uploadId === upload.uploadId && media.status !== 'ready');
    const intake=(metadata.intake?[...metadata.intake.attempts,...metadata.intake.capabilities]:[]).filter(record=>record.objectKey===upload.key&&record.uploadId===upload.uploadId);
    const mediaIds=[...new Set([...references.map(media=>media.id),...intake.map(record=>record.submissionId)])];
    if (mediaIds.length !== 1) anomalies.push({kind:'multipart-ownership-review',key:upload.key,uploadId:upload.uploadId});
    return {...upload,mediaIds};
  });
  return {formatVersion:1,mode:'review-only',executable:false,atomicSnapshot:false,writeFreezeVerified:false,
    metadataFingerprint:fingerprint(metadata),catalogFingerprint:catalog.fingerprint,matches,multipart,anomalies};
}

// Repeat both read-only inventories around reconciliation. Equal fingerprints detect no intervening
// metadata changes, but do not prove a write freeze, byte integrity or authority for erasure.
async function saveLiveObjectReconciliation() {
  const sealed = await readFile(resolve(operationsDirectory,'hosted-d1.dpapi'),'utf8');
  const raw = await runPrivateCommand('powershell.exe',['-NoProfile','-NonInteractive','-Command',
    '$ErrorActionPreference="Stop"; $sealed=[Console]::In.ReadToEnd(); $value=ConvertTo-SecureString $sealed; $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($value); try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }'],sealed);
  const source = JSON.parse(await readFile('deploy/cloudflare.json','utf8')), token = JSON.parse(raw).token;
  const readMetadata = async () => {
    const rows = await queryReadOnlyDatabase(source,token,liveObjectInventoryQuery);
    if (rows.length !== 1 || typeof rows[0].inventory !== 'string') throw new Error('Invalid live metadata result.');
    const metadata=JSON.parse(rows[0].inventory);
    const tables=await queryReadOnlyDatabase(source,token,"SELECT name FROM sqlite_schema WHERE type='table' AND name IN ('upload_requests','intake_submissions','intake_upload_attempts','intake_capabilities')");
    if(tables.length&&tables.length!==4)throw new Error('Incomplete intake schema.');
    if(tables.length){
      const intake=await queryReadOnlyDatabase(source,token,liveIntakeObjectInventoryQuery);
      if(intake.length!==1||typeof intake[0].inventory!=='string')throw new Error('Invalid intake inventory.');
      metadata.intake=JSON.parse(intake[0].inventory);
    }
    return metadata;
  };
  const request = createReadOnlyR2InventoryRequest(await loadR2InventoryCredential());
  const metadata = await readMetadata(), before = await inventoryR2Objects(request);
  const report = reconcileLiveObjectInventory(metadata,before);
  const after = await inventoryR2Objects(request), finalMetadata = await readMetadata();
  if (before.fingerprint !== after.fingerprint || fingerprint(metadata) !== fingerprint(finalMetadata)) throw new Error('Live inventories changed during reconciliation.');
  const directory = resolve(operationsDirectory,'live-object-reconciliations');
  await mkdir(directory,{recursive:true});
  await writeFile(resolve(directory,`${Date.now()}-${randomUUID()}.json`),JSON.stringify({...report,
    generatedAt:new Date().toISOString(),unchangedAcrossReads:true},null,2),{flag:'wx',mode:0o600});
  console.log(JSON.stringify({status:'private-live-reconciliation-saved',objects:report.matches.length,
    unfinishedUploads:report.multipart.length,reviewAnomalies:report.anomalies.length,executable:false}));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await saveLiveObjectReconciliation(); }
  catch { console.error('Live object reconciliation incomplete; no deletion or write-freeze authority recorded.'); process.exitCode=1; }
}
