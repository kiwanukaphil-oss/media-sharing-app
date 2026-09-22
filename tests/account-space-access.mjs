import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['lib/account-sessions.ts'], bundle: true, write: false, platform: 'node', format: 'esm' });
const accounts = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const settings = { issuer: 'https://access.auth0.com/', clientId: 'access-test', clientSecret: 'isolated-test-only', appOrigin: 'https://localhost' };

// Exercise production route modules against actual D1/R2, using isolated provider-identity fixtures.
export async function verifyAccountSpaceAccess(database, dispatch) {
  // Prototype coordination must stay unavailable on the ordinary production configuration.
  for (const method of ['GET','POST']) {
    const dormant=await dispatch('https://localhost/api/operations/backup-coordination',{method});
    assert.equal(dormant.status,404);
    assert.equal(dormant.headers.get('Cache-Control'),'no-store');
  }
  const now = Date.now();
  const createLogin = async subject => {
    const login = await accounts.createAccountSession(database, settings,
      { issuer: settings.issuer, subject, displayName: subject, authenticatedAt: Math.floor(Date.now() / 1000) * 1000, credentialsChangedAt: 0, verifiedEmail: subject + '@example.test' }, null);
    return { ...login, ...await accounts.readAccountSession(database, settings, login.token) };
  };
  const alice = await createLogin('alice');
  const aliceOtherBrowser = await createLogin('alice');
  const bob = await createLogin('bob');
  const space = crypto.randomUUID();
  const otherSpace = crypto.randomUUID();
  const membership = crypto.randomUUID();
  await database.batch([
    database.prepare('INSERT INTO spaces (id,name,created_at) VALUES (?,?,?)').bind(space, 'Shared fixture', now),
    database.prepare('INSERT INTO spaces (id,name,created_at) VALUES (?,?,?)').bind(otherSpace, 'Other fixture', now),
    database.prepare('INSERT INTO space_memberships (id,person_id,space_id,role,created_at) VALUES (?,?,?,?,?)')
      .bind(membership, alice.personId, space, 'owner', now),
    database.prepare('INSERT INTO space_memberships (id,person_id,space_id,role,created_at) VALUES (?,?,?,?,?)')
      .bind(crypto.randomUUID(), bob.personId, space, 'member', now),
  ]);
  // Every request carries immutable destination context; request options can deliberately probe CSRF.
  const request = async (person, path, method = 'GET', body, extra = {}) => {
    const response = await dispatch('https://localhost/api/' + path, { method,
      headers: { Cookie: `__Host-relay_account=${person.token}`, Origin: settings.appOrigin,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...extra },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  const scoped = path => `${path}${path.includes('?') ? '&' : '?'}space=${space}`;
  const [first, second] = await Promise.all([request(alice, scoped('session')), request(aliceOtherBrowser, scoped('session'))]);
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal(second.status, 200);
  assert.equal(first.data.authentication, 'account');
  assert.equal(first.data.deviceId, second.data.deviceId, 'Attribution is stable across browsers');
  assert.equal(first.data.role, 'owner');
  const actor = await database.prepare('SELECT * FROM devices WHERE id=?').bind(first.data.deviceId).first();
  assert.equal(actor.expires_at, 0);
  assert.equal(actor.role, 'member');
  assert.match(actor.token_hash, /^account-attribution:/);
  assert.equal((await database.prepare('SELECT COUNT(*) AS n FROM account_space_actors WHERE membership_id=?').bind(membership).first()).n, 1);
  assert.equal((await request(alice, `feed?space=${otherSpace}`)).status, 403);
  assert.equal((await request(alice, scoped('feed') + `&space=${space}`)).status, 400);
  assert.equal((await request(alice, scoped('feed'), 'GET', undefined, { 'X-Relay-Space': otherSpace })).status, 400);
  assert.equal((await request(alice, 'feed?space=')).status, 400);
  assert.equal((await request(alice, 'feed')).status, 401, 'Account alone cannot implicitly select a legacy library');
  assert.equal((await request(alice, scoped('feed'), 'GET', undefined,
    { Cookie: `__Host-relay_account=${alice.token}; __Host-relay_account=${alice.token}` })).status, 401);
  const legacyResponse = await dispatch('https://localhost/api/connect', { method: 'POST',
    headers: { Origin: settings.appOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Legacy fixture' }) });
  assert.equal(legacyResponse.status, 200);
  const legacyCookie = legacyResponse.headers.get('Set-Cookie').split(';')[0];
  assert.equal((await request({ token: 'b'.repeat(64) }, scoped('feed'), 'GET', undefined,
    { Cookie: `__Host-relay_account=${'b'.repeat(64)}; ${legacyCookie}` })).status, 401, 'No fallback to a valid legacy cookie');
  assert.equal((await request(alice, scoped('devices'))).status, 409);
  assert.equal((await request(alice, scoped('invitations'), 'POST', {})).status, 409);
  assert.equal((await request(alice, scoped('session'), 'DELETE')).status, 409);
  assert.equal((await request(alice, scoped('albums'), 'POST', { name: 'Denied' }, { Origin: '', Authorization: 'Bearer ' + 'a'.repeat(64) })).status, 403);
  const album = await request(alice, scoped('albums'), 'POST', { name: 'Account album' });
  assert.equal(album.status, 200, JSON.stringify(album.data));
  assert.equal((await request(bob, scoped('albums'), 'POST', { name: 'Not owner' })).status, 403);
  const bytes = new TextEncoder().encode('Account-owned original bytes');
  const upload = { id: crypto.randomUUID(), name: 'account.txt', mime: 'text/plain', size: bytes.length,
    sha256: Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex'), category: 'original' };
  assert.equal((await request(alice, scoped('uploads'), 'POST', upload)).status, 200);
  const resumed = await request(aliceOtherBrowser, scoped('uploads'), 'POST', upload);
  assert.equal(resumed.status, 200);
  assert.equal((await request(bob, scoped(`uploads/${upload.id}/part`), 'POST', { number: 1 })).status, 404);
  const part = await request(aliceOtherBrowser, scoped(`uploads/${upload.id}/part`), 'POST', { number: 1 });
  assert.equal(part.status, 200);
  assert.equal(new URL(part.data.url, settings.appOrigin).searchParams.get('space'), space);
  const uploaded = await dispatch(new URL(part.data.url, settings.appOrigin).href, { method: 'PUT', body: bytes,
    headers: { Cookie: `__Host-relay_account=${aliceOtherBrowser.token}`, Origin: settings.appOrigin, 'Content-Length': String(bytes.length) } });
  assert.equal(uploaded.status, 200);
  const uploadedPart = await uploaded.json();
  assert.equal((await request(alice, scoped(`uploads/${upload.id}/complete`), 'POST', { parts: [{ partNumber: 1, etag: uploadedPart.etag }] })).status, 200);
  const feed = await request(bob, scoped('feed'));
  assert.equal(feed.status, 200);
  assert.equal(feed.data.items[0].deviceName, 'alice');
  assert.equal(feed.data.items[0].id, upload.id);
  const download = await request(bob, scoped(`media/${upload.id}/link`));
  assert.equal(download.status, 200);
  assert.equal(new URL(download.data.url, settings.appOrigin).searchParams.get('space'), space);
  const original = await dispatch(new URL(download.data.url, settings.appOrigin).href,
    { headers: { Cookie: `__Host-relay_account=${bob.token}` } });
  assert.equal(original.status, 200);
  assert.deepEqual(new Uint8Array(await original.arrayBuffer()), bytes);
  await database.prepare('INSERT INTO space_memberships (id,person_id,space_id,role,created_at) VALUES (?,?,?,?,?)')
    .bind(crypto.randomUUID(), alice.personId, otherSpace, 'owner', now).run();
  assert.equal((await request(alice, `uploads?space=${otherSpace}`, 'POST', upload)).status, 409, 'Upload IDs cannot move between authorised spaces');
  assert.equal((await request(alice, `media/${upload.id}/link?space=${otherSpace}`)).status, 404);
  assert.equal((await request(alice, `feed?space=${otherSpace}`)).data.total, 0);
  assert.equal((await request(bob, scoped(`media/${upload.id}/archive`), 'POST')).status, 403);
  assert.equal((await request(alice, scoped(`media/${upload.id}/archive`), 'POST')).status, 200);
  assert.equal((await request(alice, scoped(`media/${upload.id}/restore`), 'POST')).status, 200);
  await database.prepare("UPDATE space_memberships SET role='member' WHERE id=?").bind(membership).run();
  assert.equal((await request(alice, scoped('session'))).data.role, 'member');
  assert.equal((await request(alice, scoped(`media/${upload.id}/archive`), 'POST')).status, 403);
  await database.prepare('UPDATE space_memberships SET revoked_at=? WHERE id=?').bind(now, membership).run();
  for (const path of ['feed', 'storage', 'albums', `media/${upload.id}/link`, `media/${upload.id}/thumbnail`, `uploads/${upload.id}/restart`]) {
    assert.equal((await request(alice, scoped(path), path.endsWith('restart') ? 'POST' : 'GET')).status, 403, path);
  }
  await accounts.revokeAccountSession(database, bob, bob.sessionId);
  assert.equal((await request(bob, scoped('feed'))).status, 401);
  const aliceFresh = await createLogin('alice');
  assert.equal((await request(aliceFresh, scoped('feed'))).status, 403, 'Signing in again cannot restore revoked membership');
  await database.prepare('UPDATE people SET disabled_at=? WHERE id=?').bind(now, alice.personId).run();
  assert.equal((await request(aliceFresh, `feed?space=${otherSpace}`)).status, 401);
  console.log('PASS: account-scoped production APIs, cross-space denial, stable upload ownership, original bytes, roles, CSRF and revocation.');
}
