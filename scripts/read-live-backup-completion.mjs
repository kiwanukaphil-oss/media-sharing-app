import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { backupCompletionQuery, inspectBackupCompletion } from './inspect-backup-completion.mjs';
import { queryReadOnlyDatabase } from './backup-d1-readonly.mjs';
import { inventoryBackupVersions } from './inventory-backup-versions.mjs';
import { authorizeBackupRole, downloadBackupFile, operationsDirectory, runPrivateCommand, storageRequest } from './backup-storage.mjs';
import { importSnapshot } from './relay-backup.mjs';
import { reviewRestoredBackupRuns } from './review-restored-backup-runs.mjs';

// Use existing independently scoped D1/B2 readers. No writer/coordinator secret is needed, and all
// downloaded evidence remains in ignored private storage. Do not print SQL, identity rows or tokens.
async function saveLiveBackupCompletion(snapshotId, restoredPath) {
  if (!restoredPath) backupCompletionQuery(snapshotId);
  const sealed = await readFile(resolve(operationsDirectory, 'hosted-d1.dpapi'), 'utf8');
  const raw = await runPrivateCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '$ErrorActionPreference="Stop"; $sealed=[Console]::In.ReadToEnd(); $value=ConvertTo-SecureString $sealed; $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($value); try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }'], sealed);
  const source = JSON.parse(await readFile('deploy/cloudflare.json', 'utf8')), token = JSON.parse(raw).token;
  const readCurrentRun = async requestedSnapshotId => {
    const rows = await queryReadOnlyDatabase(source, token, backupCompletionQuery(requestedSnapshotId));
    if (rows.length !== 1) throw new Error('Current completion record is missing or ambiguous.');
    return rows[0];
  };
  const reader = await authorizeBackupRole('reader');
  const catalog = await inventoryBackupVersions((operation, parameters) => storageRequest(reader, operation, parameters));
  const directory = resolve(operationsDirectory, 'backup-completion-reviews', randomUUID());
  await mkdir(directory, { recursive: true });
  const readReceipt = async version => {
    const path = join(directory, `${randomUUID()}.json`);
    await downloadBackupFile(reader, version, path);
    return readFile(path, 'utf8');
  };
  let report;
  if (restoredPath) {
    const sql = await readFile(restoredPath, 'utf8'), database = importSnapshot(sql);
    try {
      report = {...await reviewRestoredBackupRuns(database, readCurrentRun, catalog, readReceipt),
        sourceSnapshotDigest:createHash('sha256').update(sql).digest('hex')};
    } finally { database.close(); }
  } else report = await inspectBackupCompletion(snapshotId, readCurrentRun, catalog, readReceipt);
  await writeFile(join(directory, 'review.json'), JSON.stringify({ ...report, catalogFingerprint: catalog.fingerprint }, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ status: restoredPath ? 'restored-backup-runs-reviewed' : 'independent-backup-completion-verified', snapshotId,
    receiptVersions: report.verifiedReceiptVersions, restoredRuns:report.runs?.length, quiescenceProven: false, cutoverAllowed: false }));
}

try {
  if (process.argv[2] === '--restored-snapshot' && process.argv.length === 4) await saveLiveBackupCompletion(undefined, process.argv[3]);
  else if (process.argv.length === 3) await saveLiveBackupCompletion(process.argv[2]);
  else throw new Error('Provide one exact snapshot ID or --restored-snapshot with a local SQL path.');
}
catch { console.error('Independent backup completion review failed; no admission or storage state changed.'); process.exitCode = 1; }
