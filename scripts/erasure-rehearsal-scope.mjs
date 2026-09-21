export const rehearsalBucketId = 'ddc78f086527c63bae090c11';
export const rehearsalPrefix = 'relay/erasure-rehearsal/2026-09-21/';

// Dashboard roles include bucket settings, so this role is permitted only on the separate empty test bucket.
// It must never be used on the production bucket, even when file-name restrictions appear sufficient.
export function validateRehearsalAccess(allowed) {
  const permitted = new Set(['listBuckets','listFiles','readFiles','shareFiles','writeFiles','deleteFiles',
    'readBucketEncryption','readBucketLifecycleRules','readBucketLogging','readBucketNotifications','readBucketReplications','readBuckets',
    'writeBucketEncryption','writeBucketLifecycleRules','writeBucketLogging','writeBucketNotifications','writeBucketReplications','writeBuckets']);
  if (!allowed || allowed.buckets?.length !== 1 || allowed.buckets[0].id !== rehearsalBucketId ||
      allowed.namePrefix !== rehearsalPrefix || !Array.isArray(allowed.capabilities) ||
      allowed.capabilities.some(capability => !permitted.has(capability)) ||
      ['listFiles','readFiles','deleteFiles'].some(capability => !allowed.capabilities.includes(capability))) {
    throw new Error('Rehearsal credential exceeds or lacks the reviewed test scope.');
  }
}

// Delete only exact upload-version IDs produced by this generated fixture run. An unexpected catalog
// entry, missing version or changed checksum aborts the whole plan before any mutation is attempted.
export function planGeneratedVersionRemoval(generatedRecords, catalog) {
  if (!Array.isArray(generatedRecords) || !generatedRecords.length || !Array.isArray(catalog) ||
      catalog.length !== generatedRecords.length) throw new Error('Generated fixture catalog is incomplete.');
  const expected = new Map();
  for (const record of generatedRecords) {
    if (!record || !['obsolete-private','retained-shared','retained-snapshot'].includes(record.purpose) ||
        typeof record.fileName !== 'string' || !record.fileName.startsWith(rehearsalPrefix) ||
        typeof record.fileId !== 'string' || !record.fileId || expected.has(record.fileId) ||
        !/^[a-f0-9]{64}$/.test(record.sha256 ?? '') || !Number.isSafeInteger(record.size) || record.size < 0) {
      throw new Error('Invalid generated fixture manifest.');
    }
    expected.set(record.fileId,record);
  }
  const seen = new Set();
  for (const version of catalog) {
    const record = expected.get(version.fileId);
    if (!record || seen.has(version.fileId) || version.bucketId !== rehearsalBucketId || version.action !== 'upload' ||
        version.fileName !== record.fileName || version.contentLength !== record.size || version.fileInfo?.sha256 !== record.sha256) {
      throw new Error('Backup version differs from the generated fixture manifest.');
    }
    seen.add(version.fileId);
  }
  const remove = generatedRecords.filter(record => record.purpose === 'obsolete-private');
  const preserve = generatedRecords.filter(record => record.purpose !== 'obsolete-private');
  if (!remove.length || !preserve.some(record => record.purpose === 'retained-shared') ||
      !preserve.some(record => record.purpose === 'retained-snapshot')) throw new Error('Rehearsal preservation controls are missing.');
  return { remove, preserve };
}
