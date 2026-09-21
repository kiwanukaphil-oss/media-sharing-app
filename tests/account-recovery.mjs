import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { build } from 'esbuild';

const compiled = await build({ entryPoints: ['lib/account-recovery.ts', 'lib/account-sessions.ts'], bundle: true, write: false,
  outdir: 'unused', platform: 'node', format: 'esm' });
const modules = await Promise.all(compiled.outputFiles.map(file => import(`data:text/javascript;base64,${Buffer.from(file.text).toString('base64')}`)));
const recovery = modules.find(module => module.acceptRecoveryEvent);
const sessions = modules.find(module => module.createAccountSession);
const secret = 'a'.repeat(64); // Isolated test configuration, never a deployment credential.
const settings = { issuer: 'https://access.auth0.com/', clientId: 'access-test', clientSecret: 'isolated-test-only',
  appOrigin: 'https://localhost', callbackUrl: 'https://localhost/api/auth/callback' };

// Real D1 transactions verify event authenticity, ordering, callback races and account isolation.
export async function verifyAccountRecovery(database, dispatch) {
  const now = Date.now();
  const changedAt = now - 5000;
  const identity = (subject, authenticatedAt, credentialsChangedAt = 0) => ({ issuer: settings.issuer, subject,
    displayName: subject, verifiedEmail: subject + '@example.test', authenticatedAt, credentialsChangedAt });
  const request = (subject, at = changedAt, timestamp = now, signingSecret = secret, overrides = {}) => {
    const body = JSON.stringify({ issuer: settings.issuer, subject, changedAt: at, ...overrides });
    return new Request(`${settings.appOrigin}/api/auth/recovery-event`, { method: 'POST', body,
      headers: { 'X-Relay-Recovery-Time': String(timestamp),
        'X-Relay-Recovery-Signature': createHmac('sha256', signingSecret).update(`${timestamp}.${body}`).digest('hex') } });
  };
  const old = await sessions.createAccountSession(database, settings, identity('recover', now - 10000), null, now);
  const other = await sessions.createAccountSession(database, settings, identity('unaffected', now - 10000), null, now);
  for (const invalid of [request('recover', changedAt, now, 'wrong'), request('recover', changedAt, now - 300001),
    request('recover', now + 1), request('recover', changedAt, now, secret, { issuer: 'https://evil.auth0.com/' })]) {
    await assert.rejects(recovery.acceptRecoveryEvent(invalid, database, settings, secret, now), /verified/);
  }
  assert.ok(await sessions.readAccountSession(database, settings, old.token, now));
  assert.equal((await recovery.acceptRecoveryEvent(request('recover'), database, settings, secret, now)).status, 204);
  assert.equal(await sessions.readAccountSession(database, settings, old.token, now), null);
  assert.ok(await sessions.readAccountSession(database, settings, other.token, now));
  await assert.rejects(sessions.createAccountSession(database, settings, identity('recover', now - 10000), null, now), /unavailable/);
  const fresh = await sessions.createAccountSession(database, settings, identity('recover', now, changedAt), null, now);
  for (const epoch of [changedAt, changedAt - 1000]) await recovery.acceptRecoveryEvent(request('recover', epoch), database, settings, secret, now);
  assert.ok(await sessions.readAccountSession(database, settings, fresh.token, now), 'Delayed/replayed events preserve newer authentication.');
  await recovery.acceptRecoveryEvent(request('before-signup'), database, settings, secret, now);
  await assert.rejects(sessions.createAccountSession(database, settings, identity('before-signup', now - 10000), null, now), /unavailable/);
  const fallbackOld = await sessions.createAccountSession(database, settings, identity('claim-fallback', now - 10000), null, now);
  await sessions.createAccountSession(database, settings, identity('claim-fallback', now, changedAt), null, now);
  assert.equal(await sessions.readAccountSession(database, settings, fallbackOld.token, now), null, 'Signed claim covers missed webhook delivery.');
  const raced = await Promise.allSettled([
    sessions.createAccountSession(database, settings, identity('race-reset', now - 10000), null, now),
    recovery.acceptRecoveryEvent(request('race-reset'), database, settings, secret, now),
  ]);
  if (raced[0].status === 'fulfilled') assert.equal(await sessions.readAccountSession(database, settings, raced[0].value.token, now), null);
  assert.equal(raced[1].status, 'fulfilled');
  const oversized = request('oversize', changedAt, now, secret, { padding: 'x'.repeat(4096) });
  await assert.rejects(recovery.acceptRecoveryEvent(oversized, database, settings, secret, now), /verified/);
  if (dispatch) {
    const valid = request('routed-event');
    const result = await dispatch(valid.url, { method: 'POST', headers: Object.fromEntries(valid.headers), body: await valid.text() });
    assert.equal(result.status, 204, 'Server webhook works without weakening browser Origin checks.');
    const invalid = await dispatch(valid.url, { method: 'POST', body: '{}' });
    assert.equal(invalid.status, 403);
    const browser = await dispatch(`${settings.appOrigin}/api/auth/logout`, { method: 'POST' });
    assert.equal(browser.status, 403, 'Ordinary account mutations still require exact browser Origin.');
  }
  console.log('PASS: signed bounded recovery events, revocation, isolation, replay/order/race safety and signed-claim fallback.');
}
