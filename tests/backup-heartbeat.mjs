import test from 'node:test';
import assert from 'node:assert/strict';
import { requireFreshVerification, sendBackupHeartbeat, validateHeartbeatUrl } from '../scripts/backup-heartbeat.mjs';

const verifiedAt = '2026-09-18T00:10:00.000Z';
const report = { status: 'verified', snapshotId: 'snapshot', verifiedAt, databaseIntegrity: 'ok',
  foreignKeyViolations: 0, oldDeviceSessionsRevoked: true, oldInvitationsInvalidated: true,
  originals: 5, manifestDigest: { sha256: 'a'.repeat(64) } };

test('a recent matching restore permits a success heartbeat', () => {
  assert.doesNotThrow(() => requireFreshVerification(report, 'snapshot', Date.parse(verifiedAt) + 1000));
});

test('stale, failed, or unrelated recovery points cannot mask a missed backup', () => {
  assert.throws(() => requireFreshVerification(report, 'snapshot', Date.parse(verifiedAt) + 3600001));
  assert.throws(() => requireFreshVerification(report, 'different', Date.parse(verifiedAt)));
  assert.throws(() => requireFreshVerification({ ...report, status: 'copied-awaiting-restore' }, 'snapshot', Date.parse(verifiedAt)));
  assert.throws(() => requireFreshVerification({ ...report, foreignKeyViolations: 1 }, 'snapshot', Date.parse(verifiedAt)));
});

test('heartbeat cannot send secrets to another host or an insecure URL', () => {
  assert.throws(() => validateHeartbeatUrl('https://example.com/api/v1/heartbeat/token'));
  assert.throws(() => validateHeartbeatUrl('http://uptime.betterstack.com/api/v1/heartbeat/token'));
  assert.throws(() => validateHeartbeatUrl('https://user:password@uptime.betterstack.com/api/v1/heartbeat/token'));
});

test('failed verification produces no outbound success request', async () => {
  let requests = 0;
  await assert.rejects(sendBackupHeartbeat('success', { ...report, status: 'failed' }, 'snapshot', async () => {
    requests++; return { ok: true };
  }));
  assert.equal(requests, 0);
});

test('incremental heartbeat requires explicit mode and a recent full verification',()=>{
 const incremental={...report,status:'incremental-verified',verificationMode:'incremental',fullVerifiedAt:verifiedAt,downloadedBytes:10,carriedBytes:100};
 assert.doesNotThrow(()=>requireFreshVerification(incremental,'snapshot',Date.parse(verifiedAt)+1000));
 assert.throws(()=>requireFreshVerification({...incremental,verificationMode:'full'},'snapshot',Date.parse(verifiedAt)));
 assert.throws(()=>requireFreshVerification({...incremental,fullVerifiedAt:'2026-01-01'},'snapshot',Date.parse(verifiedAt)));
 assert.throws(()=>requireFreshVerification({...incremental,downloadedBytes:-1},'snapshot',Date.parse(verifiedAt)));
});
