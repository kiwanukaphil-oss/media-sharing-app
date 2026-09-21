import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['lib/auth0-transactions.ts'], bundle: true, write: false, platform: 'node', format: 'esm' });
const transactions = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const settings = { issuer: 'https://test.auth0.com/', clientId: 'test-client', clientSecret: 'test-secret',
  appOrigin: 'https://relay.example', callbackUrl: 'https://relay.example/api/auth/callback' };
const randomValue = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
const attempt = now => ({ state: randomValue(), browserBinding: randomValue(), nonce: randomValue(), verifier: randomValue(), expiresAt: now + 600000, sessionMode: 'temporary' });

// Use actual D1 atomic operations to verify callback races, browser/config isolation and expiry.
export async function verifyAuth0Transactions(database) {
  const now = Date.now();
  const first = attempt(now);
  await transactions.storeAuth0Transaction(database, settings, first, now);
  assert.equal(await transactions.consumeAuth0Transaction(database, { ...settings, allowedSubjects: ['pilot-person'] }, first.state, first.browserBinding, now), null);
  assert.equal(await transactions.consumeAuth0Transaction(database, settings, first.state, randomValue(), now), null);
  assert.equal(await transactions.consumeAuth0Transaction(database, { ...settings, clientId: 'other-client' }, first.state, first.browserBinding, now), null);
  const competing = await Promise.all(Array.from({ length: 5 }, () => transactions.consumeAuth0Transaction(database, settings, first.state, first.browserBinding, now)));
  assert.equal(competing.filter(Boolean).length, 1);
  assert.deepEqual(competing.find(Boolean), first);
  assert.equal(await transactions.consumeAuth0Transaction(database, settings, first.state, first.browserBinding, now), null);
  const expired = attempt(now);
  await transactions.storeAuth0Transaction(database, settings, expired, now);
  assert.equal(await transactions.consumeAuth0Transaction(database, settings, expired.state, expired.browserBinding, expired.expiresAt), null);
  const fresh = attempt(expired.expiresAt);
  await transactions.storeAuth0Transaction(database, settings, fresh, expired.expiresAt);
  assert.equal((await database.prepare('SELECT COUNT(*) AS n FROM auth_transactions').first()).n, 1);
  assert.equal(await transactions.consumeAuth0Transaction(database, settings, fresh.state, fresh.browserBinding, now - 1), null);
  assert.deepEqual(await transactions.consumeAuth0Transaction(database, settings, fresh.state, fresh.browserBinding, expired.expiresAt), fresh);
  await assert.rejects(transactions.storeAuth0Transaction(database, settings, { ...first, state: 'bad' }, now), /Invalid/);
  const cookie = transactions.auth0TransactionCookie(first.browserBinding);
  for (const attribute of ['__Host-relay_login=', 'HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=600']) assert.ok(cookie.includes(attribute));
  const request = value => new Request(settings.callbackUrl, { headers: { Cookie: value } });
  assert.equal(transactions.readAuth0BrowserBinding(request(cookie.split(';')[0])), first.browserBinding);
  assert.equal(transactions.readAuth0BrowserBinding(request(`${cookie.split(';')[0]}; ${cookie.split(';')[0]}`)), null);
  assert.equal(transactions.readAuth0BrowserBinding(request('__Host-relay_login=invalid')), null);
  assert.ok(transactions.clearAuth0TransactionCookie().includes('Max-Age=0'));
  console.log('PASS: Auth0 transaction replay/races, browser/config isolation, expiry/cleanup and host-bound cookies.');
}
