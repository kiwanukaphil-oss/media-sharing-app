import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['lib/account-sessions.ts', 'lib/publications.ts'], outdir: 'unused', bundle: true, write: false, platform: 'node', format: 'esm' });
const modules = await Promise.all(bundle.outputFiles.map(file => import(`data:text/javascript;base64,${Buffer.from(file.text).toString('base64')}`)));
const accounts = modules.find(module => module.createAccountSession);
const publications = modules.find(module => module.reservePublication);
const settings = { issuer: 'https://access.auth0.com/', clientId: 'access-test', clientSecret: 'isolated-test-only', appOrigin: 'https://localhost' };

// Use actual D1/R2 and production routes. Inject races only at storage completion, before the real publication commit.
export async function verifyPublications(database, bucket, dispatch) {
  const identity = { issuer: settings.issuer, subject: 'publisher', displayName: 'Publisher', authenticatedAt: Math.floor(Date.now() / 1000) * 1000, credentialsChangedAt: 0, verifiedEmail: 'publisher@example.test' };
  const login = await accounts.createAccountSession(database, settings, identity, null);
  const account = await accounts.readAccountSession(database, settings, login.token);
  const personal = crypto.randomUUID();
  const shared = crypto.randomUUID();
  const destinationMembership = crypto.randomUUID();
  await database.batch([
    database.prepare('INSERT INTO spaces(id,name,created_at) VALUES(?,?,?)').bind(personal, 'Publication personal', Date.now()),
    database.prepare('INSERT INTO spaces(id,name,created_at) VALUES(?,?,?)').bind(shared, 'Publication shared', Date.now()),
    database.prepare('INSERT INTO personal_spaces(space_id,person_id,quota_bytes) VALUES(?,?,?)').bind(personal, account.personId, 1073741824),
    database.prepare("INSERT INTO space_memberships(id,person_id,space_id,role,created_at) VALUES(?,?,?,'owner',?)").bind(crypto.randomUUID(), account.personId, personal, Date.now()),
    database.prepare("INSERT INTO space_memberships(id,person_id,space_id,role,created_at) VALUES(?,?,?,'owner',?)").bind(destinationMembership, account.personId, shared, Date.now()),
  ]);
  const request = async (space, path, method = 'GET', body, headers = {}) => {
    const response = await dispatch(`${settings.appOrigin}/api/${path}${path.includes('?') ? '&' : '?'}space=${space}`, { method,
      headers: { Cookie: `__Host-relay_account=${login.token}`, Origin: settings.appOrigin, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json() };
  };
  const ownSession = (await request(personal, 'session')).data;
  const destinationSession = (await request(shared, 'session')).data;
  const access = (session, kind) => ({ id: session.deviceId, space_id: session.space.id, space_name: session.space.name, name: 'Publisher',
    role: 'owner', authentication: 'account', space_kind: kind, sessionId: account.sessionId, personId: account.personId });
  const sourceAccess = access(ownSession, 'personal');
  const destinationAccess = access(destinationSession, 'shared');
  const originalBytes = Buffer.from('Original publication bytes. Location and metadata remain intact.');
  const originalHash = createHash('sha256').update(originalBytes).digest('hex');
  const previewBytes = Buffer.from([255, 216, 1, 2, 3, 255, 217]);
  // Seed tiny immutable originals and derivatives with actual storage bytes for checksum and copy assertions.
  const createOriginal = async (hash = originalHash) => {
    const id = crypto.randomUUID();
    const key = `${personal}/${id}/original`;
    await bucket.put(key, originalBytes, { httpMetadata: { contentType: 'image/jpeg' } });
    await bucket.put(`${key}.preview.jpg`, previewBytes, { httpMetadata: { contentType: 'image/jpeg' } });
    await database.prepare(`INSERT INTO media(id,space_id,device_id,name,mime,size,sha256,category,object_key,upload_id,part_size,status,created_at,preview_ready,preview_size,original_name,captured_at)
      VALUES(?,?,?,'Personal photo.jpg','image/jpeg',?,?,'original',?,'fixture',16,'ready',?,1,?,'Camera original.jpg','2026-09-01T12:00:00')`)
      .bind(id, personal, ownSession.deviceId, originalBytes.length, hash, key, Date.now(), previewBytes.length).run();
    return { id, key };
  };
  const original = await createOriginal();
  const album = (await request(shared, 'albums', 'POST', { name: 'Published selection', description: '' })).data;
  assert.ok(album?.id);
  const section = (await request(shared, 'sections', 'POST', { albumId: album.id, expectedRevision: 0, name: 'Ready to share' })).data;
  assert.ok(section?.id);
  const input = { id: crypto.randomUUID(), sourceId: original.id, sourceRevision: 0, destinationSpaceId: shared, albumId: album.id, sectionId: section.id, confirmed: true };
  assert.equal((await request(personal, 'publications', 'POST', { ...input, confirmed: false })).status, 400);
  assert.equal((await request(personal, 'publications', 'POST', input, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await request(personal, 'publications', 'POST', { ...input, destinationSpaceId: personal })).status, 403);
  assert.equal((await request(shared, 'publications', 'POST', input)).status, 403);
  await database.prepare("UPDATE space_memberships SET role='member' WHERE id=?").bind(destinationMembership).run();
  const copied = await request(personal, 'publications', 'POST', input);
  assert.equal(copied.status, 200, JSON.stringify(copied.data));
  const media = await database.prepare('SELECT * FROM media WHERE id=?').bind(input.id).first();
  assert.equal(media.status, 'ready');
  assert.notEqual(media.object_key, original.key);
  assert.equal(media.sha256, originalHash);
  assert.equal(media.original_name, 'Camera original.jpg');
  assert.equal(media.captured_at, '2026-09-01T12:00:00');
  assert.equal(media.preview_ready, 1);
  assert.deepEqual(Buffer.from(await (await bucket.get(media.object_key)).arrayBuffer()), originalBytes);
  assert.deepEqual(Buffer.from(await (await bucket.get(`${media.object_key}.preview.jpg`)).arrayBuffer()), previewBytes);
  assert.deepEqual(Buffer.from(await (await bucket.get(original.key)).arrayBuffer()), originalBytes);
  assert.equal((await database.prepare('SELECT section_id FROM album_media WHERE media_id=?').bind(input.id).first()).section_id, section.id);
  assert.equal((await request(personal, 'publications', 'POST', input)).status, 200, 'Retry is idempotent');
  const arrivals = await database.prepare("SELECT actor_id,space_id,resources FROM library_events WHERE action='file.arrive' AND resources LIKE ?")
    .bind(`%${input.id}%`).all();
  assert.equal(arrivals.results.length,1,'Publication retry records one shared arrival.');
  assert.equal(arrivals.results[0].actor_id,destinationMembership);
  assert.equal(arrivals.results[0].space_id,shared);
  assert.equal(arrivals.results[0].resources.includes(original.id),false,'Shared history never reveals the private source reference.');
  assert.equal((await request(personal, `publications/${input.id}`, 'DELETE')).status, 409, 'Cancel cannot remove a published copy');
  assert.equal((await request(personal, 'publications', 'POST', { ...input, sourceRevision: 1 })).status, 409);
  await database.prepare('DELETE FROM media WHERE id=?').bind(original.id).run();
  await bucket.delete(original.key);
  assert.deepEqual(Buffer.from(await (await bucket.get(media.object_key)).arrayBuffer()), originalBytes, 'Source deletion cannot recall the shared copy');

  // A corrupt advertised fingerprint cannot become a visible shared original or release its reserved space early.
  const corrupt = await createOriginal('0'.repeat(64));
  const corruptInput = { id: crypto.randomUUID(), sourceId: corrupt.id, sourceRevision: 0, destinationSpaceId: shared, confirmed: true };
  const rejected = await request(personal, 'publications', 'POST', corruptInput);
  assert.equal(rejected.status, 503, JSON.stringify(rejected.data));
  assert.equal((await database.prepare('SELECT status FROM media WHERE id=?').bind(corruptInput.id).first()).status, 'publishing');
  assert.ok(!(await request(shared, 'feed')).data.items.some(item => item.id === corruptInput.id));
  assert.ok((await request(shared, 'storage')).data.uploads.some(item => item.id === corruptInput.id && item.publication));
  assert.equal((await request(shared, `uploads/${corruptInput.id}/complete`, 'POST', { parts: [] })).status, 409, 'Upload completion cannot bypass publication verification');
  assert.equal((await request(shared, `uploads/${corruptInput.id}`, 'DELETE')).status, 200);
  assert.equal(await database.prepare('SELECT id FROM media WHERE id=?').bind(corruptInput.id).first(), null);
  assert.equal((await request(personal, 'publications', 'POST', corruptInput)).status, 409, 'Cancelled operation identifiers cannot restart');

  await database.prepare("UPDATE space_memberships SET role='viewer' WHERE id=?").bind(destinationMembership).run();
  assert.equal((await request(personal,'publications','POST',{...input,id:crypto.randomUUID()})).status,403);
  await assert.rejects(publications.reservePublication(database,sourceAccess,destinationAccess,{...input,id:crypto.randomUUID()},100*1024**3));
  await database.prepare("UPDATE space_memberships SET role='member' WHERE id=?").bind(destinationMembership).run();

  // Membership changes, source changes and explicit cancellation must win before a copied object becomes visible.
  for (const scenario of ['revoke-destination', 'viewer-destination', 'change-source', 'cancel', 'password-recovery']) {
    const source = await createOriginal();
    const intent = { id: crypto.randomUUID(), sourceId: source.id, sourceRevision: 0, destinationSpaceId: shared };
    const job = await publications.reservePublication(database, sourceAccess, destinationAccess, intent, 100 * 1024 ** 3);
    let changed = false;
    const racingBucket = new Proxy(bucket, { get(target, property) {
      if (property === 'put') return async (...args) => {
        // The test-only Node/Miniflare bridge loses stream length metadata; fixtures are deliberately tiny.
        if (args[1] instanceof ReadableStream) args[1] = await new Response(args[1]).arrayBuffer();
        const result = await target.put(...args);
        if (!changed) {
          changed = true;
          if (scenario === 'revoke-destination') await database.prepare('UPDATE space_memberships SET revoked_at=? WHERE id=?').bind(Date.now(), destinationMembership).run();
          if (scenario === 'viewer-destination') await database.prepare("UPDATE space_memberships SET role='viewer' WHERE id=?").bind(destinationMembership).run();
          if (scenario === 'change-source') await database.prepare('UPDATE media SET revision=revision+1 WHERE id=?').bind(source.id).run();
          if (scenario === 'cancel') await publications.cancelPublication(database, bucket, sourceAccess, intent.id);
          if (scenario === 'password-recovery') await database.prepare('UPDATE people SET credentials_changed_at=? WHERE id=?')
            .bind(identity.authenticatedAt + 1000, account.personId).run();
        }
        return result;
      };
      return typeof target[property] === 'function' ? target[property].bind(target) : target[property];
    } });
    await assert.rejects(publications.finishPublication(database, racingBucket, sourceAccess, job), /changed|published/);
    assert.equal(await database.prepare("SELECT id FROM media WHERE id=? AND status='ready'").bind(intent.id).first(), null);
    const attempts = (await database.prepare('SELECT object_key FROM publication_attempts WHERE publication_id=?').bind(intent.id).all()).results;
    for (const attempt of attempts) assert.equal(await bucket.head(attempt.object_key), null);
    if (scenario === 'password-recovery') await database.prepare('UPDATE people SET credentials_changed_at=0 WHERE id=?').bind(account.personId).run();
    await publications.cancelPublication(database, bucket, sourceAccess, intent.id);
    await database.prepare("UPDATE space_memberships SET revoked_at=NULL,role='member' WHERE id=?").bind(destinationMembership).run();
  }
  // A cached principal cannot reserve new storage or initiate destructive cancellation after recovery.
  const recoverySource = await createOriginal();
  const recoveryIntent = { id: crypto.randomUUID(), sourceId: recoverySource.id, sourceRevision: 0, destinationSpaceId: shared };
  const recoveryJob = await publications.reservePublication(database, sourceAccess, destinationAccess, recoveryIntent, 100 * 1024 ** 3);
  await database.prepare('UPDATE people SET credentials_changed_at=? WHERE id=?').bind(identity.authenticatedAt + 1000, account.personId).run();
  const deniedIntent = { ...recoveryIntent, id: crypto.randomUUID() };
  await assert.rejects(publications.reservePublication(database, sourceAccess, destinationAccess, deniedIntent, 100 * 1024 ** 3));
  assert.equal(await database.prepare('SELECT id FROM publications WHERE id=?').bind(deniedIntent.id).first(), null);
  let storageDispatched = false;
  const deniedStorage = new Proxy(bucket, { get(target, property) {
    if (['put', 'delete'].includes(property)) return async () => { storageDispatched = true; throw new Error('Unexpected storage dispatch'); };
    return typeof target[property] === 'function' ? target[property].bind(target) : target[property];
  } });
  await assert.rejects(publications.finishPublication(database, deniedStorage, sourceAccess, recoveryJob), /access changed/);
  await assert.rejects(publications.cancelPublication(database, deniedStorage, sourceAccess, recoveryIntent.id), /access changed/);
  assert.equal(storageDispatched, false);
  assert.equal((await database.prepare('SELECT phase FROM publications WHERE id=?').bind(recoveryIntent.id).first()).phase, 'pending');
  await database.prepare('UPDATE people SET credentials_changed_at=0 WHERE id=?').bind(account.personId).run();
  await database.prepare('UPDATE account_sessions SET revoked_at=? WHERE id=?').bind(Date.now(), account.sessionId).run();
  await assert.rejects(publications.cancelPublication(database, deniedStorage, sourceAccess, recoveryIntent.id), /access changed/);
  assert.equal(storageDispatched, false);
  await database.prepare('UPDATE account_sessions SET revoked_at=NULL WHERE id=?').bind(account.sessionId).run();
  await publications.cancelPublication(database, bucket, sourceAccess, recoveryIntent.id);
  assert.equal((await publications.cancelPublication(database, bucket, sourceAccess, recoveryIntent.id)).cancelled, true);
  // Original and preview reservations share the same quota as uploads; concurrent copies cannot overbook it.
  const quotaSource = await createOriginal();
  const usage = (await database.prepare('SELECT SUM(size+preview_size) AS n FROM media WHERE space_id=?').bind(shared).first()).n;
  const boundedLimit = usage + originalBytes.length + previewBytes.length;
  const quotaIntents = Array.from({ length: 3 }, () => ({ id: crypto.randomUUID(), sourceId: quotaSource.id, sourceRevision: 0, destinationSpaceId: shared }));
  const reservations = await Promise.allSettled(quotaIntents.map(intent => publications.reservePublication(database, sourceAccess, destinationAccess, intent, boundedLimit)));
  assert.equal(reservations.filter(result => result.status === 'fulfilled').length, 1);
  for (const result of reservations) if (result.status === 'fulfilled') await publications.cancelPublication(database, bucket, sourceAccess, result.value.id);
  // A thumbnail created after the reservation must not make publication silently exceed its reserved quota.
  const latePreview = await createOriginal();
  await database.prepare('UPDATE media SET preview_ready=0,preview_size=0 WHERE id=?').bind(latePreview.id).run();
  const lateIntent = { id: crypto.randomUUID(), sourceId: latePreview.id, sourceRevision: 0, destinationSpaceId: shared };
  const lateJob = await publications.reservePublication(database, sourceAccess, destinationAccess, lateIntent, usage + originalBytes.length);
  await database.prepare('UPDATE media SET preview_ready=1,preview_size=? WHERE id=?').bind(previewBytes.length, latePreview.id).run();
  const bridgeBucket = new Proxy(bucket, { get(target, property) {
    if (property === 'put') return async (key, bytes, options) => target.put(key, bytes instanceof ReadableStream ? await new Response(bytes).arrayBuffer() : bytes, options);
    return typeof target[property] === 'function' ? target[property].bind(target) : target[property];
  } });
  await publications.finishPublication(database, bridgeBucket, sourceAccess, lateJob);
  assert.equal((await database.prepare('SELECT preview_size FROM media WHERE id=?').bind(lateIntent.id).first()).preview_size, 0);
  // A separate destination Editor may cancel an unfinished publication through either route;
  // cached Editor authority must fail before storage dispatch after demotion.
  const editorLogin=await accounts.createAccountSession(database,settings,{...identity,subject:'publication-editor',displayName:'Editor',verifiedEmail:'editor@example.test'},null);
  const editorAccount=await accounts.readAccountSession(database,settings,editorLogin.token);
  const editorMembership=crypto.randomUUID();
  await database.prepare("INSERT INTO space_memberships(id,person_id,space_id,role,created_at) VALUES(?,?,?,'editor',?)").bind(editorMembership,editorAccount.personId,shared,Date.now()).run();
  const editorRequest=async(path,method='GET')=>dispatch(`${settings.appOrigin}/api/${path}?space=${shared}`,{method,headers:{Cookie:`__Host-relay_account=${editorLogin.token}`,Origin:settings.appOrigin}});
  const editorSession=await (await editorRequest('session')).json();
  const editorAccess={id:editorSession.deviceId,space_id:shared,role:'editor',authentication:'account',personId:editorAccount.personId,sessionId:editorAccount.sessionId};
  for(const route of ['publications','uploads']) {
    const original=await createOriginal();
    const intent={id:crypto.randomUUID(),sourceId:original.id,sourceRevision:0,destinationSpaceId:shared};
    await publications.reservePublication(database,sourceAccess,destinationAccess,intent,100*1024**3);
    await database.prepare("UPDATE space_memberships SET role='member' WHERE id=?").bind(editorMembership).run();
    let touched=false;
    const guardedStorage={delete:async()=>{touched=true;}};
    await assert.rejects(publications.cancelPublication(database,guardedStorage,editorAccess,intent.id),error=>error.status===409);
    assert.equal(touched,false);
    await database.prepare("UPDATE space_memberships SET role='editor' WHERE id=?").bind(editorMembership).run();
    const cancelled=await editorRequest(`${route}/${intent.id}`,'DELETE');
    assert.equal(cancelled.status,200,await cancelled.clone().text());
    assert.equal((await database.prepare('SELECT phase FROM publications WHERE id=?').bind(intent.id).first()).phase,'cancelled');
    assert.ok(await bucket.head(original.key),'Cancelling a shared copy preserves the personal original.');
  }
  console.log('PASS: checksum-verified independent publication, previews/metadata/sections, idempotence, source deletion independence, corrupt bytes, quota races, cancellation and authority/source changes before visibility.');
}
