import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import login from '../deploy/auth0/post-login.cjs';
import recovery from '../deploy/auth0/post-change-password.cjs';

const changedAt = Date.now() - 5000;
const event = { client: { client_id: 'relay' }, user: { user_id: 'auth0|fixture', last_password_reset: new Date(changedAt).toISOString() },
  secrets: { RELAY_CLIENT_ID: 'relay', RELAY_RECOVERY_SECRET: 'a'.repeat(64), RELAY_ISSUER: 'https://access.auth0.com/', RELAY_ORIGIN: 'https://relayalbums.com' } };
let claim;
let denied = false;
const api = { access: { deny() { denied = true; } }, idToken: { setCustomClaim(name, value) { claim = { name, value }; } } };
await login.onExecutePostLogin(event, api);
assert.deepEqual(claim, { name: 'https://relayalbums.com/credentials_changed_at', value: changedAt });
await login.onExecutePostLogin({ ...event, user: {} }, api);
assert.equal(claim.value, 0, 'A new database account has no reset timestamp.');
await login.onExecutePostLogin({ ...event, user: { last_password_reset: 'malformed' } }, api);
assert.equal(denied, true);
claim = undefined;
await login.onExecutePostLogin({ ...event, client: { client_id: 'unrelated' } }, api);
assert.equal(claim, undefined);
const originalFetch = globalThis.fetch;
let attempts = 0;
try {
  globalThis.fetch = async (url, options) => {
    attempts++;
    assert.equal(url, 'https://relayalbums.com/api/auth/recovery-event');
    assert.equal(options.redirect, 'error');
    const time = options.headers['X-Relay-Recovery-Time'];
    assert.equal(options.headers['X-Relay-Recovery-Signature'], createHmac('sha256', event.secrets.RELAY_RECOVERY_SECRET).update(`${time}.${options.body}`).digest('hex'));
    assert.deepEqual(JSON.parse(options.body), { issuer: event.secrets.RELAY_ISSUER, subject: event.user.user_id, changedAt });
    if (attempts === 1) throw new Error('isolated network failure');
    return new Response(null, { status: 204 });
  };
  await recovery.onExecutePostChangePassword(event);
  assert.equal(attempts, 2);
  attempts = 0;
  globalThis.fetch = async () => { attempts++; return new Response(null, { status: 503 }); };
  await assert.rejects(recovery.onExecutePostChangePassword(event), /Operator reconciliation/);
  assert.equal(attempts, 2, 'Retry duration is bounded within the Action lifetime.');
  await assert.rejects(recovery.onExecutePostChangePassword({ ...event, secrets: { ...event.secrets, RELAY_ORIGIN: 'https://evil.example' } }), /configuration/);
  assert.equal(attempts, 2, 'Invalid configuration makes no outbound request.');
} finally { globalThis.fetch = originalFetch; }
console.log('PASS: Auth0 signed recovery claim, malformed timestamps, scoped application, authenticated webhook and bounded retry.');
