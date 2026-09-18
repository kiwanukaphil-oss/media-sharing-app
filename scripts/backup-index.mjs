import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { authorizeBackupRole, backupBucketId, storageRequest } from './backup-storage.mjs';

function indexKey() {
  if (!/^[a-f0-9]{64}$/i.test(process.env.BACKUP_INDEX_ENCRYPTION_KEY ?? '')) throw new Error('Backup index encryption key is missing or invalid.');
  return Buffer.from(process.env.BACKUP_INDEX_ENCRYPTION_KEY, 'hex');
}

export function sealBackupIndex(index, key, context) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(`relay-backup-index-v1:${context}`));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(index)), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]);
}

export function openBackupIndex(encrypted, key, context) {
  const decipher = createDecipheriv('aes-256-gcm', key, encrypted.subarray(0, 12));
  decipher.setAAD(Buffer.from(`relay-backup-index-v1:${context}`));
  decipher.setAuthTag(encrypted.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(28)), decipher.final()]).toString('utf8'));
}

// Validate an authenticated, run-bound inventory before reusing any pinned versions; final restoration still checks bytes.
export async function readEncryptedBackupIndex(path) {
  let index;
  try { index = openBackupIndex(await readFile(path), indexKey(), process.env.GITHUB_RUN_ID ?? 'local-validation'); }
  catch { throw new Error('Encrypted backup inventory failed authentication.'); }
  const age = Date.now() - Date.parse(index.generatedAt);
  if (index.formatVersion !== 1 || index.bucketId !== backupBucketId || !Number.isFinite(age) || age < 0 || age > 86400000) {
    throw new Error('Backup inventory is stale or belongs to another destination.');
  }
  const records = new Map();
  for (const record of index.objects) {
    if (!/^[a-f0-9]{64}$/.test(record.sha256) || record.fileName !== `relay/originals/${record.sha256}` ||
        !record.fileId || !Number.isSafeInteger(record.size) || record.size < 0) throw new Error('Invalid backup inventory record.');
    records.set(record.sha256, record);
  }
  return records;
}

// The read-only inventory job hands the upload job encrypted metadata, never its read credential or original data.
export async function exportEncryptedBackupIndex(destination) {
  const key = indexKey();
  const reader = await authorizeBackupRole('reader');
  const objects = [];
  let startFileName;
  do {
    const page = await storageRequest(reader, 'b2_list_file_names', {
      bucketId: backupBucketId, prefix: 'relay/originals/', maxFileCount: 1000, ...(startFileName ? { startFileName } : {}),
    });
    for (const file of page.files) {
      const sha256 = file.fileInfo?.sha256;
      if (file.action !== 'upload' || !/^[a-f0-9]{64}$/.test(sha256 ?? '') ||
          file.fileName !== `relay/originals/${sha256}` || file.serverSideEncryption?.mode !== 'SSE-B2') {
        throw new Error('Destination inventory contains an unexpected object.');
      }
      objects.push({ fileId: file.fileId, fileName: file.fileName, size: Number(file.contentLength), sha256 });
    }
    if (page.nextFileName && page.nextFileName === startFileName) throw new Error('Backup inventory pagination did not advance.');
    startFileName = page.nextFileName;
  } while (startFileName);
  await writeFile(destination, sealBackupIndex({ formatVersion: 1, bucketId: backupBucketId,
    generatedAt: new Date().toISOString(), objects }, key, process.env.GITHUB_RUN_ID ?? 'local-validation'), { flag: 'wx', mode: 0o600 });
  console.log('Encrypted backup inventory prepared.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await exportEncryptedBackupIndex(process.argv[2]); }
  catch { console.error('Backup inventory could not be prepared; no success recorded.'); process.exitCode = 1; }
}
