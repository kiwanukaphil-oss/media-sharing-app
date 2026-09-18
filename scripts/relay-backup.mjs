import './sites-env.mjs';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, appendFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { authorizeBackupRole, downloadBackupFile, hashFile, operationsDirectory,
  runPrivateCommand, storageRequest, uploadBackupFile, validateFileDigest, backupBucketId } from './backup-storage.mjs';
import { readEncryptedBackupIndex } from './backup-index.mjs';
import { exportReadOnlyDatabase } from './backup-d1-readonly.mjs';

const backupRoot = resolve(operationsDirectory, 'backups');
const source = JSON.parse(await readFile('deploy/cloudflare.json', 'utf8'));
const wranglerArguments = ['--import', './scripts/sites-env.mjs', 'node_modules/wrangler/bin/wrangler.js'];

export function checkDatabase(database) {
  if (database.prepare('PRAGMA integrity_check').all().some(row => row.integrity_check !== 'ok') ||
      database.prepare('PRAGMA foreign_key_check').all().length !== 0) throw new Error('Database integrity or relationship check failed.');
}

// Import into an isolated SQLite database with ordering constraints deferred, then validate every relationship.
export function importSnapshot(sql, destination = ':memory:') {
  const database = new DatabaseSync(destination, { enableForeignKeyConstraints: false });
  try {
    database.exec(sql);
    database.exec('PRAGMA foreign_keys=ON');
    checkDatabase(database);
    for (const table of ['spaces', 'devices', 'invitations', 'media']) {
      if (!database.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name=?").get(table)) {
        throw new Error('Snapshot is missing an application table.');
      }
    }
    return database;
  } catch (error) { database.close(); throw error; }
}

export function completedOriginals(database) {
  const rows = database.prepare("SELECT id, object_key, size, sha256 FROM media WHERE status='ready' ORDER BY id").all();
  for (const row of rows) {
    if (!/^[a-f0-9]{64}$/i.test(row.sha256) || !Number.isSafeInteger(row.size) || row.size < 0 || !row.object_key) {
      throw new Error('Completed media has invalid backup metadata.');
    }
    row.sha256 = row.sha256.toLowerCase();
  }
  return rows;
}

// Retain records for audit, but invalidate every old session/invitation before any restored app can use them.
export function sanitizeRestoredAccess(database, now = Date.now()) {
  database.exec('BEGIN');
  try {
    database.prepare('UPDATE devices SET revoked_at=?, expires_at=0').run(now);
    database.prepare('UPDATE invitations SET expires_at=0, redeemed_at=COALESCE(redeemed_at, ?)').run(now);
    database.exec("UPDATE media SET preview_ready=0, preview_size=0; UPDATE media SET status='cancelling' WHERE status<>'ready'");
    checkDatabase(database);
    if (database.prepare('SELECT COUNT(*) AS n FROM devices WHERE revoked_at IS NULL OR expires_at>0').get().n ||
        database.prepare('SELECT COUNT(*) AS n FROM invitations WHERE expires_at>0 OR redeemed_at IS NULL').get().n) {
      throw new Error('Restored access was not fully revoked.');
    }
    database.exec('COMMIT');
  } catch (error) { database.exec('ROLLBACK'); throw error; }
}

function tableCounts(database) {
  return Object.fromEntries(['spaces', 'devices', 'invitations', 'media'].map(table =>
    [table, database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n]));
}

function validateSnapshotId(id) {
  if (!/^\d{4}-\d{2}-\d{2}T[\d-]+Z-[a-f0-9-]{36}$/.test(id ?? '')) throw new Error('A valid local snapshot ID is required.');
  return id;
}

// Only reuse immutable object versions referenced by a locally verified recovery point; never mirror deletions.
async function loadVerifiedObjectIndex() {
  if (process.env.RELAY_BACKUP_INDEX_FILE) return readEncryptedBackupIndex(process.env.RELAY_BACKUP_INDEX_FILE);
  if (process.env.GITHUB_ACTIONS === 'true') throw new Error('Hosted backup requires the encrypted inventory.');
  const index = new Map();
  for (const entry of await readdir(backupRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d{4}-/.test(entry.name)) continue;
    try {
      const directory = join(backupRoot, validateSnapshotId(entry.name));
      const verification = JSON.parse(await readFile(join(directory, 'restore-verification.json'), 'utf8'));
      const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
      if (verification.status !== 'verified' || verification.snapshotId !== manifest.snapshotId) continue;
      validateFileDigest(await hashFile(join(directory, 'manifest.json')), verification.manifestDigest);
      for (const object of manifest.objects) index.set(object.sha256, object.backup);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return index;
}

// Hosted source access uses a bucket-scoped S3 reader; operator CLI fallback is limited to local runs.
async function downloadSourceOriginal(objectKey, destination) {
  const accessKeyId = process.env.R2_READ_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_READ_SECRET_ACCESS_KEY;
  if (accessKeyId && secretAccessKey) {
    const { AwsClient } = await import('aws4fetch');
    const client = new AwsClient({ accessKeyId, secretAccessKey, region: 'auto', service: 's3' });
    const encodedKey = objectKey.split('/').map(encodeURIComponent).join('/');
    const url = `https://${source.account_id}.r2.cloudflarestorage.com/${source.bucket_name}/${encodedKey}`;
    const request = await client.sign(url, { method: 'GET' });
    const response = await fetch(request, { redirect: 'error', signal: AbortSignal.timeout(900000) });
    if (!response.ok) throw new Error(`Source original download failed (HTTP ${response.status}).`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
    return;
  }
  if (process.env.GITHUB_ACTIONS === 'true' || accessKeyId || secretAccessKey) throw new Error('Source-read credentials are incomplete.');
  await runPrivateCommand(process.execPath, [...wranglerArguments, 'r2', 'object', 'get',
    `${source.bucket_name}/${objectKey}`, '--remote', '--file', destination, '--config', 'deploy/backup-source.json']);
}

// Export metadata first, copy every referenced ready original including Trash, and publish the manifest last.
async function createRecoverySnapshot() {
  if (process.env.GITHUB_ACTIONS === 'true' && !process.env.CLOUDFLARE_API_TOKEN) throw new Error('Database export credential is missing.');
  await mkdir(backupRoot, { recursive: true });
  const snapshotId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
  const directory = join(backupRoot, snapshotId);
  await mkdir(join(directory, 'source'), { recursive: true });
  const databasePath = join(directory, 'database.sql');
  const exportStartedAt = new Date().toISOString();
  console.log(`Starting recovery snapshot ${snapshotId}.`);
  if (process.env.CLOUDFLARE_API_TOKEN) await exportReadOnlyDatabase(source, databasePath);
  else await runPrivateCommand(process.execPath, [...wranglerArguments, 'd1', 'export', source.database_name,
    '--config', 'deploy/backup-source.json', '--remote', '--output', databasePath, '--skip-confirmation']);
  const exportFinishedAt = new Date().toISOString();
  const database = importSnapshot(await readFile(databasePath, 'utf8'));
  const originals = completedOriginals(database);
  console.log(`Database export validated; ${originals.length} completed originals to protect.`);
  const counts = tableCounts(database);
  const incompleteMedia = database.prepare("SELECT COUNT(*) AS n FROM media WHERE status<>'ready'").get().n;
  database.close();
  const index = await loadVerifiedObjectIndex();
  const writer = await authorizeBackupRole('writer');
  const objects = [];
  let uploadedOriginals = 0;
  let reusedOriginals = 0;
  for (let position = 0; position < originals.length; position++) {
    const original = originals[position];
    const originalPath = join(directory, 'source', `${position}.bin`);
    await downloadSourceOriginal(original.object_key, originalPath);
    validateFileDigest(await hashFile(originalPath), original);
    let backup = index.get(original.sha256);
    if (backup) {
      validateFileDigest(backup, original);
      if (backup.fileName !== `relay/originals/${original.sha256}`) throw new Error('Cached object destination mismatch.');
      reusedOriginals++;
    } else {
      backup = await uploadBackupFile(writer, originalPath, `relay/originals/${original.sha256}`);
      index.set(original.sha256, backup);
      uploadedOriginals++;
    }
    objects.push({ ...original, backup });
    console.log(`Original ${position + 1}/${originals.length} copied or reused after source hash verification.`);
  }
  const databaseBackup = await uploadBackupFile(writer, databasePath, `relay/snapshots/${snapshotId}/database.sql`);
  const manifest = { formatVersion: 1, snapshotId, exportStartedAt, exportFinishedAt,
    sourceDatabaseId: source.database_id, sourceBucket: source.bucket_name, retentionDays: 30,
    database: databaseBackup, tableCounts: counts, incompleteMedia, objects };
  const manifestPath = join(directory, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
  const manifestBackup = await uploadBackupFile(writer, manifestPath, `relay/snapshots/${snapshotId}/manifest.json`);
  await writeFile(join(directory, 'copy-receipt.json'), JSON.stringify({ snapshotId, status: 'copied-awaiting-restore',
    manifest: manifestBackup, uploadedOriginals, reusedOriginals, copiedAt: new Date().toISOString() }, null, 2), { flag: 'wx', mode: 0o600 });
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `snapshot_id=${snapshotId}\n`);
  console.log(JSON.stringify({ snapshotId, status: 'copied-awaiting-restore', originals: objects.length,
    bytes: objects.reduce((sum, object) => sum + object.size, 0), uploadedOriginals, reusedOriginals }));
}

// Fetch the cloud manifest, SQL, and every pinned original into a new directory; use no source files as restore input.
async function verifyRecoverySnapshot(snapshotId) {
  const started = Date.now();
  const directory = join(backupRoot, validateSnapshotId(snapshotId));
  const restoreDirectory = join(directory, `restore-${randomUUID()}`);
  await mkdir(restoreDirectory, { recursive: true });
  const reader = await authorizeBackupRole('reader');
  const manifestName = `relay/snapshots/${snapshotId}/manifest.json`;
  const catalog = await storageRequest(reader, 'b2_list_file_names', {
    bucketId: backupBucketId, prefix: manifestName, maxFileCount: 2,
  });
  const remoteManifest = catalog.files.find(file => file.fileName === manifestName && file.action === 'upload');
  if (!remoteManifest || !/^[a-f0-9]{64}$/.test(remoteManifest.fileInfo?.sha256 ?? '')) {
    throw new Error('Recovery manifest is missing from the independent backup catalog.');
  }
  const manifestPath = join(restoreDirectory, 'manifest.json');
  await downloadBackupFile(reader, { fileId: remoteManifest.fileId, fileName: manifestName,
    size: Number(remoteManifest.contentLength), sha256: remoteManifest.fileInfo.sha256 }, manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.snapshotId !== snapshotId || manifest.formatVersion !== 1) throw new Error('Unexpected recovery manifest.');
  const sqlPath = join(restoreDirectory, 'database.sql');
  await downloadBackupFile(reader, manifest.database, sqlPath);
  const database = importSnapshot(await readFile(sqlPath, 'utf8'), join(restoreDirectory, 'restored.sqlite'));
  try {
    const originals = completedOriginals(database);
    if (JSON.stringify(tableCounts(database)) !== JSON.stringify(manifest.tableCounts) || originals.length !== manifest.objects.length) {
      throw new Error('Restored database counts do not match the manifest.');
    }
    for (let position = 0; position < originals.length; position++) {
      const original = originals[position];
      const object = manifest.objects[position];
      if (JSON.stringify(original) !== JSON.stringify({ id: object.id, object_key: object.object_key, size: object.size, sha256: object.sha256 })) {
        throw new Error('Database and original-file manifest disagree.');
      }
      validateFileDigest(object.backup, original);
      await downloadBackupFile(reader, object.backup, join(restoreDirectory, `${position}.bin`));
      console.log(`Restored original ${position + 1}/${originals.length}: SHA-256 and size match.`);
    }
    sanitizeRestoredAccess(database);
    const report = { status: 'verified', snapshotId, verifiedAt: new Date().toISOString(),
      originals: originals.length, originalBytes: originals.reduce((sum, original) => sum + original.size, 0),
      tableCounts: tableCounts(database), databaseIntegrity: 'ok', foreignKeyViolations: 0,
      oldDeviceSessionsRevoked: true, oldInvitationsInvalidated: true, previewReferencesReset: true,
      durationSeconds: Math.round((Date.now() - started) / 1000), manifestDigest: await hashFile(manifestPath),
      restoreDirectory, localCleanupCandidates: ['source files and restore copies; retain until operator approves cleanup'] };
    await writeFile(join(directory, 'restore-verification.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
    if (process.env.GITHUB_ACTIONS === 'true') console.log('Independent backup restoration and access revocation verified.');
    else console.log(JSON.stringify(report));
  } finally { database.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv[2] === 'create') await createRecoverySnapshot();
    else if (process.argv[2] === 'verify') await verifyRecoverySnapshot(process.argv[3]);
    else throw new Error('Usage: node scripts/relay-backup.mjs create | verify <snapshot-id>');
  } catch (error) {
    console.error(`Backup operation stopped: ${error.message}`);
    process.exitCode = 1;
  }
}
