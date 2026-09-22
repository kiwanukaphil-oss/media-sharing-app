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
  assert.equal((await request(aliceOtherBrowser, scoped('feed?uploader=me'))).data.total, 1);
  assert.equal((await request(bob, scoped('feed?uploader=me'))).data.total, 0);
  await database.prepare("UPDATE space_memberships SET role='contributor' WHERE person_id=? AND space_id=?").bind(alice.personId,space).run();
  assert.equal((await request(aliceOtherBrowser,scoped('feed'))).data.items[0].canEdit,1,'Own attribution survives a different signed-in browser.');
  await database.prepare("UPDATE space_memberships SET role='contributor' WHERE person_id=? AND space_id=?").bind(bob.personId,space).run();
  assert.equal((await request(bob,scoped('feed'))).data.items[0].canEdit,0,'Contributor cannot edit another member original.');
  assert.equal((await request(bob,scoped('albums'),'POST',{name:'Denied Contributor album'})).status,403);
  await database.prepare("UPDATE space_memberships SET role='owner' WHERE person_id=? AND space_id=?").bind(alice.personId,space).run();
  await database.prepare("UPDATE space_memberships SET role='member' WHERE person_id=? AND space_id=?").bind(bob.personId,space).run();
  assert.equal((await request(bob,scoped(`favorites/${upload.id}`),'PUT',{favorite:true})).status,200);
  assert.equal((await request(bob,scoped('feed?favorites=1'))).data.total,1);
  assert.equal((await request(alice,scoped('feed?favorites=1'))).data.total,0,'An owner cannot see another person bookmarks.');
  assert.equal((await request(alice,scoped('feed'))).data.items[0].isFavorite,0);
  assert.equal((await request(alice,scoped(`favorites/${upload.id}`),'PUT',{favorite:true})).status,200);
  assert.equal((await request(aliceOtherBrowser,scoped('feed?favorites=1'))).data.total,1,'Bookmarks follow the signed-in person.');
  assert.equal((await request(alice,`favorites/${upload.id}?space=${otherSpace}`,'PUT',{favorite:true})).status,403,'A bookmark cannot be created through an unauthorised space.');
  assert.equal((await request(alice,scoped('feed?favorites=invalid'))).status,400);
  // A recorded claim attributes older uploads to this exact membership without guessing from names.
  const legacyId = crypto.randomUUID();
  await database.prepare("INSERT INTO devices (id,space_id,name,token_hash,role,created_at,expires_at) VALUES (?,?,'alice',?,'owner',?,?)")
    .bind(legacyId,space,crypto.randomUUID(),now,now+60000).run();
  await database.prepare('UPDATE media SET device_id=? WHERE id=?').bind(legacyId,upload.id).run();
  assert.equal((await request(alice, scoped('feed?uploader=me'))).data.total, 0, 'Matching device name is not attribution.');
  await database.prepare('INSERT INTO legacy_owner_claims (device_id,membership_id,session_id,claimed_at) VALUES (?,?,?,?)')
    .bind(legacyId,membership,alice.sessionId,now).run();
  assert.equal((await request(aliceOtherBrowser, scoped('feed?uploader=me'))).data.total, 1);
  assert.equal((await request(bob, scoped('feed?uploader=me'))).data.total, 0);
  await database.prepare('UPDATE media SET device_id=? WHERE id=?').bind(first.data.deviceId,upload.id).run();
  const download = await request(bob, scoped(`media/${upload.id}/link`));
  assert.equal(download.status, 200);
  assert.equal(new URL(download.data.url, settings.appOrigin).searchParams.get('space'), space);
  const original = await dispatch(new URL(download.data.url, settings.appOrigin).href,
    { headers: { Cookie: `__Host-relay_account=${bob.token}` } });
  assert.equal(original.status, 200);
  assert.deepEqual(new Uint8Array(await original.arrayBuffer()), bytes);
  await database.prepare('INSERT INTO space_memberships (id,person_id,space_id,role,created_at) VALUES (?,?,?,?,?)')
    .bind(crypto.randomUUID(), alice.personId, otherSpace, 'owner', now).run();
  assert.equal((await request(alice,`favorites/${upload.id}?space=${otherSpace}`,'PUT',{favorite:true})).status,409,'An authorised second space still cannot address the wrong file.');
  assert.equal((await request(alice, `uploads?space=${otherSpace}`, 'POST', upload)).status, 409, 'Upload IDs cannot move between authorised spaces');
  assert.equal((await request(alice, `media/${upload.id}/link?space=${otherSpace}`)).status, 404);
  assert.equal((await request(alice, `feed?space=${otherSpace}`)).data.total, 0);
  // An account Editor organises another contributor's original without receiving access administration
  // or the ability to replace bytes. All requests still cross the actual built Worker boundary.
  await database.prepare("UPDATE space_memberships SET role='editor' WHERE person_id=? AND space_id=?").bind(bob.personId,space).run();
  assert.equal((await request(bob,scoped('session'))).data.role,'editor');
  assert.equal((await request(bob,scoped('albums'),'POST',{name:'Editor organised album'})).status,200);
  assert.equal((await request(bob,scoped(`media/${upload.id}/archive`),'POST')).status,200);
  assert.equal((await request(bob,scoped(`media/${upload.id}`),'DELETE')).status,403);
  assert.equal((await request(bob,scoped(`media/${upload.id}/restore`),'POST')).status,200);
  assert.equal((await request(bob,scoped('person-invitations'),'POST',{email:'editor-cannot-invite@example.test'})).status,409);
  assert.equal((await request(bob,scoped(`people/${membership}`),'PUT',{action:'remove',revision:0})).status,409);
  assert.equal((await request(bob,scoped(`uploads/${upload.id}/part`),'POST',{number:1})).status,404);
  assert.equal((await request(bob,scoped(`media/${upload.id}/thumbnail`),'PUT',{})).status,404);
  // Viewer retains original reads but cannot create, continue, preview or cancel even their own upload.
  const viewerUpload={...upload,id:crypto.randomUUID(),name:'Viewer unfinished.txt'};
  assert.equal((await request(bob,scoped('uploads'),'POST',viewerUpload)).status,200);
  await database.prepare("UPDATE space_memberships SET role='viewer' WHERE person_id=? AND space_id=?").bind(bob.personId,space).run();
  assert.equal((await request(bob,scoped('session'))).data.role,'viewer');
  assert.equal((await request(bob,scoped(`favorites/${upload.id}`),'PUT',{favorite:false})).status,200,'Viewer can manage personal bookmarks.');
  const exportRevision=(await database.prepare('SELECT revision FROM media WHERE id=?').bind(upload.id).first()).revision;
  const metadata=await request(bob,scoped('metadata-export'),'POST',{files:[{id:upload.id,expectedRevision:exportRevision}]});
  assert.equal(metadata.status,200,'Viewer can export currently readable metadata.');
  assert.equal(metadata.data.includesOriginalBytes,false);
  assert.equal(metadata.data.files[0].id,upload.id);
  assert.equal((await request(bob,scoped('metadata-export'),'POST',{files:[{id:upload.id,expectedRevision:exportRevision+1}]})).status,409);
  assert.equal((await request(bob,scoped('feed?favorites=1'))).data.total,0);
  assert.equal((await request(aliceOtherBrowser,scoped('feed?favorites=1'))).data.total,1,'Removing a bookmark affects only its owner.');
  assert.equal((await request(bob,scoped('feed'))).status,200);
  assert.equal((await request(bob,scoped(`media/${upload.id}/link`))).status,200);
  assert.equal((await request(bob,scoped('uploads'),'POST',{...upload,id:crypto.randomUUID()})).status,403);
  assert.equal((await request(bob,scoped('uploads'),'POST',viewerUpload)).status,403);
  for(const [path,method,body] of [
    [`uploads/${viewerUpload.id}/part`,'POST',{number:1}],
    [`uploads/${viewerUpload.id}/bytes/1`,'PUT',{}],
    [`uploads/${viewerUpload.id}/complete`,'POST',{parts:[]}],
    [`uploads/${viewerUpload.id}/restart`,'POST',{}],
    [`media/${viewerUpload.id}/thumbnail`,'PUT',{}],
    ['albums','POST',{name:'Viewer cannot organise'}],
    [`media/${upload.id}/archive`,'POST',{}],
  ]) assert.equal((await request(bob,scoped(path),method,body)).status,403,path);
  assert.equal((await request(bob,scoped(`uploads/${viewerUpload.id}`),'DELETE')).status,409);
  assert.equal((await request(bob,scoped('storage'))).data.uploads.find(row=>row.id===viewerUpload.id).canCancel,0);
  assert.equal((await database.prepare('SELECT status FROM media WHERE id=?').bind(viewerUpload.id).first()).status,'uploading');
  await database.prepare("UPDATE space_memberships SET role='unrecognised-role' WHERE person_id=? AND space_id=?").bind(bob.personId,space).run();
  assert.equal((await request(bob,scoped('feed'))).status,403);
  await database.prepare("UPDATE space_memberships SET role='member' WHERE person_id=? AND space_id=?").bind(bob.personId,space).run();
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
