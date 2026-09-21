import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { authorizeBackupRole, backupBucketId, backupPrefix, operationsDirectory, storageRequest } from './backup-storage.mjs';

// Retain only review metadata; arbitrary provider fileInfo can contain unnecessary personal information.
function versionRecord(file) {
  if (!file || file.bucketId !== backupBucketId || typeof file.fileName !== 'string' ||
      !file.fileName.startsWith(backupPrefix) || typeof file.fileId !== 'string' || !file.fileId ||
      !['upload', 'hide', 'start'].includes(file.action) ||
      !Number.isSafeInteger(file.contentLength) || file.contentLength < 0) {
    throw new Error('Unexpected backup version; inventory is incomplete.');
  }
  return { fileId:file.fileId, fileName:file.fileName, action:file.action, size:file.contentLength,
    sha256:/^[a-f0-9]{64}$/i.test(file.fileInfo?.sha256 ?? '') ? file.fileInfo.sha256.toLowerCase() : null,
    retentionKnown:file.fileRetention?.isClientAuthorizedToRead === true,
    legalHoldKnown:file.legalHold?.isClientAuthorizedToRead === true };
}

// Exhaust both catalogs using their independent cursor formats. Any malformed/cycling page fails closed.
// Listing is not a transactional snapshot or authority to delete; writes must be frozen before execution.
export async function inventoryBackupVersions(request) {
  const versions = [], unfinished = [];
  for (const mode of ['versions', 'unfinished']) {
    const records = mode === 'versions' ? versions : unfinished;
    const operation = mode === 'versions' ? 'b2_list_file_versions' : 'b2_list_unfinished_large_files';
    const cursors = new Set(), ids = new Set();
    let cursor = {};
    for (let page = 0; ; page++) {
      if (page >= 10000) throw new Error('Backup inventory page limit reached.');
      const scope = mode === 'versions' ? { prefix:backupPrefix, maxFileCount:1000 } : { namePrefix:backupPrefix, maxFileCount:100 };
      const result = await request(operation, { bucketId:backupBucketId, ...scope, ...cursor });
      if (!Array.isArray(result?.files) || result.files.length > scope.maxFileCount) throw new Error('Invalid backup inventory page.');
      for (const file of result.files) {
        const record = versionRecord(file);
        if (ids.has(record.fileId) || (mode === 'unfinished' && record.action !== 'start')) {
          throw new Error('Duplicate or inconsistent backup inventory record.');
        }
        ids.add(record.fileId); records.push(record);
      }
      if (result.nextFileId === null && (mode !== 'versions' || result.nextFileName === null)) break;
      if (typeof result.nextFileId !== 'string' || !result.nextFileId ||
          (mode === 'versions' && (typeof result.nextFileName !== 'string' || !result.nextFileName.startsWith(backupPrefix)))) {
        throw new Error('Invalid backup inventory continuation.');
      }
      cursor = mode === 'versions' ? { startFileId:result.nextFileId, startFileName:result.nextFileName } : { startFileId:result.nextFileId };
      const key = JSON.stringify(cursor);
      if (cursors.has(key)) throw new Error('Backup inventory cursor did not advance.');
      cursors.add(key);
    }
  }
  const catalog = { versions, unfinished };
  return { formatVersion:1, mode:'review-only', executable:false, bucketId:backupBucketId, prefix:backupPrefix,
    generatedAt:new Date().toISOString(), listingComplete:true, atomicSnapshot:false,
    fingerprint:createHash('sha256').update(JSON.stringify(catalog)).digest('hex'), ...catalog };
}

// Save identifiers only in ignored private storage. Console output contains aggregate counts, never keys.
async function saveBackupVersionInventory() {
  const reader = await authorizeBackupRole('reader');
  const inventory = await inventoryBackupVersions((operation, parameters) => storageRequest(reader, operation, parameters));
  const directory = resolve(operationsDirectory, 'backup-version-inventories');
  await mkdir(directory, { recursive:true });
  await writeFile(resolve(directory, `${Date.now()}-${randomUUID()}.json`), JSON.stringify(inventory, null, 2), { flag:'wx', mode:0o600 });
  console.log(JSON.stringify({ status:'private-review-inventory-saved', versions:inventory.versions.length,
    unfinished:inventory.unfinished.length, executable:false }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await saveBackupVersionInventory(); }
  catch { console.error('Backup inventory failed; no complete inventory or deletion authority recorded.'); process.exitCode=1; }
}
