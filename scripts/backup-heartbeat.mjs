import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function validateHeartbeatUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Backup heartbeat URL is missing or invalid.'); }
  if (url.origin !== 'https://uptime.betterstack.com' || url.username || url.password || url.search || url.hash ||
      !/^\/api\/v1\/heartbeat\/[a-zA-Z0-9_-]+$/.test(url.pathname)) throw new Error('Unexpected backup heartbeat destination.');
  return url;
}

// A copied snapshot, stale verification, or failed integrity check must never reset the missed-backup timer.
export function requireFreshVerification(report, snapshotId, now = Date.now()) {
  const age = now - Date.parse(report.verifiedAt);
  const incremental=report.status==='incremental-verified'&&report.verificationMode==='incremental';
  const fullAge=now-Date.parse(report.fullVerifiedAt);
  if(incremental&&(!Number.isFinite(fullAge)||fullAge<0||fullAge>35*86400000||![report.downloadedBytes,report.carriedBytes].every(value=>Number.isSafeInteger(value)&&value>=0)))throw new Error('Incremental backup evidence is incomplete or full verification is overdue.');
  if ((!incremental && report.status !== 'verified') || report.snapshotId !== snapshotId || !Number.isFinite(age) || age < 0 || age > 3600000 ||
      report.databaseIntegrity !== 'ok' || report.foreignKeyViolations !== 0 ||
      report.oldDeviceSessionsRevoked !== true || report.oldInvitationsInvalidated !== true ||
      !Number.isSafeInteger(report.originals) || report.originals < 0 || !/^[a-f0-9]{64}$/.test(report.manifestDigest?.sha256 ?? '')) {
    throw new Error('A fresh, successful restore verification is required before reporting backup success.');
  }
}

// Send only a status signal, never SQL, filenames, keys, or diagnostic output; keep the secret URL out of errors.
export async function sendBackupHeartbeat(status, verification, snapshotId, request = fetch) {
  if (!['success', 'failure'].includes(status)) throw new Error('Invalid heartbeat status.');
  if (status === 'success') requireFreshVerification(verification, snapshotId);
  const url = validateHeartbeatUrl(process.env.BETTER_STACK_BACKUP_HEARTBEAT_URL);
  if (status === 'failure') url.pathname += '/fail';
  let response;
  try { response = await request(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000) }); }
  catch { throw new Error('Could not deliver backup status to Better Stack.'); }
  if (!response.ok) throw new Error(`Better Stack rejected backup status (HTTP ${response.status}).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [status, reportPath, snapshotId] = process.argv.slice(2);
    const verification = status === 'success' ? JSON.parse(await readFile(reportPath, 'utf8')) : null;
    await sendBackupHeartbeat(status, verification, snapshotId);
    console.log('Backup status delivered to Better Stack.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
