import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['lib/account-api.ts', 'lib/account-sessions.ts'], bundle: true, write: false,
  outdir: 'unused', platform: 'node', format: 'esm' });
const modules = await Promise.all(bundle.outputFiles.map(file => import(`data:text/javascript;base64,${Buffer.from(file.text).toString('base64')}`)));
const api = modules.find(module => module.accountAction);
const sessions = modules.find(module => module.createAccountSession);
const settings = { issuer: 'https://test.auth0.com/', clientId: 'test-client', clientSecret: 'test-secret',
  appOrigin: 'https://relay.example', callbackUrl: 'https://relay.example/api/auth/callback' };
const randomValue = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
const identity = subject => ({ issuer: settings.issuer, subject, displayName: 'Test account', verifiedEmail: 'same@example.test' });
const request = (action, cookie = '', method = 'GET', origin = settings.appOrigin) => new Request(`${settings.appOrigin}/api/auth/${action}`,
  { method, headers: { Cookie: cookie, Origin: origin } });

// Exercise actual D1 uniqueness, revocation, identity isolation and complete route orchestration.
// Provider cryptography is separately verified with signed tokens in auth0-client.mjs.
export async function verifyAccountSessions(database) {
  const now = Date.now();
  const first = await sessions.createAccountSession(database, settings, identity('alice'), null, now);
  const alice = await sessions.readAccountSession(database, settings, first.token, now);
  assert.ok(alice);
  assert.equal(alice.sessionMode, 'temporary');
  assert.equal(alice.expiresAt - alice.createdAt, 8 * 60 * 60 * 1000);
  assert.ok(!sessions.accountCookie(first.token).includes('Max-Age'));
  assert.ok(sessions.accountCookie(first.token, 'trusted').includes('Max-Age=604800'));
  assert.throws(() => sessions.accountCookie(first.token, 'forever'), /Invalid browser/);
  const trusted = await sessions.createAccountSession(database, settings, identity('trusted'), null, now, 'trusted');
  const trustedSession = await sessions.readAccountSession(database, settings, trusted.token, now);
  assert.equal(trustedSession.sessionMode, 'trusted');
  assert.equal(trustedSession.expiresAt - now, 604800000);
  assert.equal(await sessions.readAccountSession(database, settings, trusted.token, trustedSession.expiresAt), null);
  const second = await sessions.createAccountSession(database, settings, identity('bob'), null, now);
  const bob = await sessions.readAccountSession(database, settings, second.token, now);
  assert.notEqual(alice.personId, bob.personId, 'Identical emails must not merge people');
  const sameAlice = await Promise.all(Array.from({ length: 3 }, () => sessions.createAccountSession(database, settings, identity('alice'), null, now)));
  for (const login of sameAlice) assert.equal((await sessions.readAccountSession(database, settings, login.token, now)).personId, alice.personId);
  assert.equal((await database.prepare("SELECT COUNT(*) AS n FROM people WHERE subject='alice'").first()).n, 1);
  assert.equal(await sessions.readAccountSession(database, { ...settings, clientId: 'another' }, first.token, now), null);
  assert.equal(await sessions.readAccountSession(database, settings, first.token, alice.expiresAt), null);
  await sessions.revokeAccountSession(database, alice, bob.sessionId, now);
  assert.ok(await sessions.readAccountSession(database, settings, second.token, now), 'Alice cannot revoke Bob');
  const cookie = sessions.accountCookie(first.token).split(';')[0];
  assert.equal(sessions.readAccountToken(request('session', `${cookie}; ${cookie}`)), null);
  assert.equal(sessions.readAccountToken(request('session', `relay_device=${first.token}`)), null);
  const stored = await database.prepare('SELECT token_hash FROM account_sessions WHERE id = ?').bind(first.sessionId).first();
  assert.notEqual(stored.token_hash, first.token);
  for (const attribute of ['__Host-relay_account=', 'HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) assert.ok(sessions.accountCookie(first.token).includes(attribute));
  const renewed = await sessions.createAccountSession(database, settings, identity('alice'), first.token, now);
  assert.equal(await sessions.readAccountSession(database, settings, first.token, now), null, 'Login rotates the browser credential');
  const renewedCookie = sessions.accountCookie(renewed.token).split(';')[0];
  await assert.rejects(api.accountAction(request('logout', renewedCookie, 'POST', 'https://evil.example'), database, settings), /from Relay/);
  const hostile = request('logout', renewedCookie, 'POST', 'https://evil.example');
  hostile.headers.set('Authorization', 'Bearer forged');
  await assert.rejects(api.accountAction(hostile, database, settings), /from Relay/);
  const list = await (await api.accountAction(request('sessions', renewedCookie), database, settings)).json();
  assert.ok(list.sessions.every(session => session.id !== bob.sessionId));
  await api.accountAction(request(`sessions/${bob.sessionId}`, renewedCookie, 'DELETE'), database, settings);
  assert.ok(await sessions.readAccountSession(database, settings, second.token, now));
  await api.accountAction(request('logout', renewedCookie, 'POST'), database, settings);
  assert.equal(await sessions.readAccountSession(database, settings, renewed.token, now), null);
  await database.prepare('UPDATE people SET disabled_at = ? WHERE id = ?').bind(now, bob.personId).run();
  assert.equal(await sessions.readAccountSession(database, settings, second.token, now), null);
  await assert.rejects(sessions.createAccountSession(database, settings, identity('bob'), null, now), /unavailable/);
  await assert.rejects(sessions.createAccountSession(database, settings, { ...identity('unverified'), verifiedEmail: null }, null, now), /Verify/);
  assert.deepEqual(await (await api.accountAction(request('session'), database, null)).json(), { enabled: false, account: null });
  await assert.rejects(api.accountAction(request('login'), database, null), /not available/);
  await verifyCallbackOrchestration(database);
  await verifySessionChoicesAndLogout(database);
  console.log('PASS: account identity isolation, concurrent sign-in, cookie rotation, expiry/revocation, CSRF and callback replay.');
}

// The stored login choice, never a callback parameter, controls duration and cookie persistence.
// Provider logout cannot redirect to user-supplied URLs or affect another browser's provider cookie.
async function verifySessionChoicesAndLogout(database) {
  for (const mode of ['temporary', 'trusted']) {
    const transaction = { state: randomValue(), nonce: randomValue(), verifier: randomValue(), browserBinding: randomValue(), expiresAt: Date.now() + 600000 };
    const provider = {
      async prepare() { return { url: 'https://test.auth0.com/authorize', transaction }; },
      async complete() { return { ...identity('choice-' + mode), providerSessionId: 'verified-provider-session' }; },
    };
    const login = await api.accountAction(request(`login?session=${mode}`), database, settings, provider);
    const callback = await api.accountAction(request(`callback?state=${transaction.state}&code=test&session=${mode === 'trusted' ? 'temporary' : 'trusted'}`,
      login.headers.get('Set-Cookie').split(';')[0]), database, settings, provider);
    const token = /__Host-relay_account=([a-f0-9]{64})/.exec(callback.headers.get('Set-Cookie'))[1];
    const cookie = sessions.accountCookie(token).split(';')[0];
    const account = await (await api.accountAction(request('session', cookie), database, settings)).json();
    assert.equal(account.account.sessionMode, mode);
    assert.equal(account.account.expiresAt - account.account.createdAt, mode === 'trusted' ? 604800000 : 28800000);
    assert.equal(callback.headers.get('Set-Cookie').includes('Max-Age=604800'), mode === 'trusted');
    assert.ok(!JSON.stringify(account).includes('verified-provider-session'));
    const signOut = await api.accountAction(request('logout?returnTo=https://evil.example', cookie, 'POST'), database, settings);
    const destination = new URL((await signOut.json()).providerLogoutUrl);
    assert.equal(destination.origin, new URL(settings.issuer).origin);
    assert.equal(destination.pathname, '/oidc/logout');
    assert.equal(destination.searchParams.get('logout_hint'), 'verified-provider-session');
    assert.equal(destination.searchParams.get('post_logout_redirect_uri'), settings.appOrigin + '/');
    assert.equal(destination.searchParams.get('client_id'), settings.clientId);
    assert.equal(destination.searchParams.has('federated'), false);
    assert.ok(signOut.headers.get('Set-Cookie').includes('Max-Age=0'));
    assert.equal(await sessions.readAccountSession(database, settings, token), null);
  }
  for (const query of ['session=forever', 'session=temporary&session=trusted', 'session=']) {
    await assert.rejects(api.accountAction(request('login?' + query), database, settings), /Choose a temporary/);
  }
}

// Drive the same route handler used in production with a deterministic provider at the protocol boundary.
async function verifyCallbackOrchestration(database) {
  let exchanges = 0;
  const transaction = { state: randomValue(), nonce: randomValue(), verifier: randomValue(), browserBinding: randomValue(), expiresAt: Date.now() + 600000 };
  const provider = {
    async prepare() { return { url: 'https://test.auth0.com/authorize', transaction }; },
    async complete() { exchanges++; return identity('callback-user'); },
  };
  const before = await database.prepare('SELECT COUNT(*) AS n FROM spaces').first();
  const login = await api.accountAction(request('login'), database, settings, provider);
  assert.equal(login.status, 303);
  const bindingCookie = login.headers.get('Set-Cookie').split(';')[0];
  const callback = `callback?state=${transaction.state}&code=test-code`;
  const wrongBrowser = await api.accountAction(request(callback, '__Host-relay_login=' + randomValue()), database, settings, provider);
  assert.equal(wrongBrowser.headers.get('Location'), settings.appOrigin + '/account?signin=failed');
  assert.equal(exchanges, 0);
  const duplicated = await api.accountAction(request(`${callback}&state=${transaction.state}`, bindingCookie), database, settings, provider);
  assert.equal(duplicated.headers.get('Location'), settings.appOrigin + '/account?signin=failed');
  const results = await Promise.all(Array.from({ length: 3 }, () => api.accountAction(request(callback, bindingCookie), database, settings, provider)));
  assert.equal(results.filter(result => result.headers.get('Location') === settings.appOrigin + '/account').length, 1);
  assert.equal(exchanges, 1);
  const success = results.find(result => result.headers.get('Location') === settings.appOrigin + '/account');
  assert.equal(success.headers.get('Location'), settings.appOrigin + '/account');
  assert.equal(success.headers.get('Cache-Control'), 'no-store');
  assert.ok(success.headers.get('Set-Cookie').includes('__Host-relay_account='));
  assert.ok(success.headers.get('Set-Cookie').includes('Max-Age=0'));
  assert.deepEqual(await database.prepare('SELECT COUNT(*) AS n FROM spaces').first(), before, 'Login cannot allocate storage or grant space access');
}
