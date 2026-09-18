import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const { origin, cookie } = JSON.parse(await readFile('.sites-runtime/cloud-test-session.json', 'utf8'));
const web = (path, method = 'GET', body) => fetch(`${origin}/api/${path}`, { method, headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const native = (path, token, method = 'GET', body, extra = {}) => fetch(`${origin}/api/${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', ...extra }, body: body ? JSON.stringify(body) : undefined });

// Exercise native credential issuance, Origin enforcement, one-use invitations, and revocation.
async function verifyNativeAccess() {
  const verificationSession = await web('session').then(response => response.json());
  assert.equal(verificationSession.space?.name, 'Relay verification', 'Use only the isolated verification space.');
  assert.equal(verificationSession.role, 'owner', 'The verification credential must be an owner after migration.');
  assert.equal((await native('native/connect', '', 'POST', { name: 'Uninvited phone' })).status, 403);
  const invite = await web('invitations', 'POST').then(response => response.json());
  const payload = { name: 'Native API verification', invitation: invite.token };
  assert.equal((await native('native/connect', '', 'POST', payload, { Origin: 'https://untrusted.example' })).status, 403);
  const response = await native('native/connect', '', 'POST', payload);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('set-cookie'), null);
  const { token } = await response.json();
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal((await native('native/connect', '', 'POST', payload)).status, 410);
  const session = await native('session', token).then(response => response.json());
  assert.ok(session.deviceId);
  assert.equal((await native('feed', token)).status, 200);
  assert.equal((await native('invitations', token, 'POST')).status, 403, 'Invited native devices are members.');
  assert.equal((await native('invitations', token, 'POST', undefined, { Origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await native('feed', 'invalid', 'GET', undefined, { Cookie: cookie })).status, 401);
  assert.equal((await web(`devices/${session.deviceId}`, 'DELETE')).status, 200);
  assert.equal((await native('feed', token)).status, 401);
  console.log('PASS: native pairing, bearer access, Origin enforcement, invitation replay protection, invalid bearer rejection, revocation.');
}
await verifyNativeAccess();
