import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['lib/account-sessions.ts', 'lib/space-people.ts'], outdir: 'unused', bundle: true, write: false, platform: 'node', format: 'esm' });
const modules = await Promise.all(bundle.outputFiles.map(file => import(`data:text/javascript;base64,${Buffer.from(file.text).toString('base64')}`)));
const accounts = modules.find(module => module.createAccountSession);
const people = modules.find(module => module.acceptPersonInvitation);
const settings = { issuer: 'https://access.auth0.com/', clientId: 'access-test', clientSecret: 'isolated-test-only', appOrigin: 'https://localhost' };

// Production routes and actual D1 transactions must agree on membership, recipient and last-owner boundaries.
export async function verifySpacePeople(database, dispatch) {
  const now = Date.now();
  const login = async subject => {
    const created = await accounts.createAccountSession(database, settings, { issuer: settings.issuer, subject,
      displayName: subject, authenticatedAt: Math.floor(Date.now() / 1000) * 1000, credentialsChangedAt: 0, verifiedEmail: `${subject}@example.test` }, null);
    return { ...created, ...await accounts.readAccountSession(database, settings, created.token) };
  };
  const [owner, guest, stranger] = await Promise.all(['people-owner', 'people-guest', 'people-stranger'].map(login));
  const space = crypto.randomUUID();
  const ownerMembership = crypto.randomUUID();
  await database.batch([
    database.prepare('INSERT INTO spaces(id,name,created_at) VALUES(?,?,?)').bind(space, 'People fixture', now),
    database.prepare("INSERT INTO space_memberships(id,person_id,space_id,role,created_at) VALUES(?,?,?,'owner',?)").bind(ownerMembership, owner.personId, space, now),
  ]);
  const request = async (person, path, method = 'GET', body, headers = {}) => {
    const result = await dispatch(`${settings.appOrigin}/api/${path}`, { method, headers: {
      Cookie: `__Host-relay_account=${person.token}`, Origin: settings.appOrigin, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: result.status, data: await result.json() };
  };
  const scoped = path => `${path}?space=${space}`;
  assert.equal((await request(stranger, scoped('people'))).status, 403);
  const invite = await request(owner, scoped('person-invitations'), 'POST', { email: 'PEOPLE-GUEST@example.test' });
  assert.equal(invite.status, 200, JSON.stringify(invite.data));
  assert.equal(invite.data.email, guest.verifiedEmail);
  assert.equal((await request(owner, scoped('person-invitations'), 'POST', { email: guest.verifiedEmail })).status, 409);
  const header = { 'X-Relay-Invitation': invite.data.token };
  assert.equal((await request(stranger, 'auth/invitation-preview', 'POST', undefined, header)).status, 404);
  assert.equal((await request(guest, 'auth/invitation-preview', 'POST', undefined, { ...header, Origin: 'https://evil.example' })).status, 403);
  const preview = await request(guest, 'auth/invitation-preview', 'POST', undefined, header);
  assert.equal(preview.data.spaceName, 'People fixture');
  assert.equal((await request(guest, scoped('feed'))).status, 403, 'Preview cannot grant access');
  const joined = await Promise.allSettled(Array.from({ length: 3 }, () => people.acceptPersonInvitation(database, guest, invite.data.token, now + 100)));
  assert.equal(joined.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await database.prepare("SELECT COUNT(*) AS n FROM membership_events WHERE space_id=? AND action='join'").bind(space).first()).n, 1);
  const roster = await request(guest, scoped('people'));
  assert.equal(roster.status, 200);
  assert.equal(roster.data.members.find(member => member.id === ownerMembership).email, null, 'Members do not receive others email addresses');
  assert.equal((await request(guest, scoped('feed'))).status, 200);
  assert.equal((await request(guest, scoped('person-invitations'), 'POST', { email: stranger.verifiedEmail })).status, 409);
  assert.equal((await request(guest, scoped(`people/${ownerMembership}`), 'PUT', { action: 'remove', revision: 0 })).status, 409);
  assert.equal((await request(owner, scoped(`people/${ownerMembership}`), 'PUT', { action: 'leave', revision: 0 })).status, 409);
  assert.equal((await request(owner,scoped(`people/${ownerMembership}`),'PUT',{action:'editor',revision:0})).status,409,'The last owner cannot demote themselves to Editor.');
  const guestMembership = roster.data.members.find(member => member.id !== ownerMembership);
  assert.equal((await request(owner, scoped(`people/${guestMembership.id}`), 'PUT', { action: 'owner', revision: 0 })).status, 200);
  assert.equal((await request(owner, scoped(`people/${guestMembership.id}`), 'PUT', { action: 'remove', revision: 0 })).status, 409, 'Stale actions cannot overwrite role changes');
  const competingLeaves = await Promise.all([
    request(owner, scoped(`people/${ownerMembership}`), 'PUT', { action: 'leave', revision: 0 }),
    request(guest, scoped(`people/${guestMembership.id}`), 'PUT', { action: 'leave', revision: 1 }),
  ]);
  assert.equal(competingLeaves.filter(result => result.status === 200).length, 1, 'At least one owner survives a race');
  const remaining = competingLeaves[0].status === 200 ? guest : owner;
  const departed = remaining === guest ? owner : guest;
  const remainingMembership = remaining === guest ? guestMembership.id : ownerMembership;
  const otherInvite = await request(remaining, scoped('person-invitations'), 'POST', { email: stranger.verifiedEmail });
  assert.equal(otherInvite.status, 200);
  await request(remaining, scoped(`person-invitations/${otherInvite.data.id}`), 'DELETE');
  assert.equal((await request(stranger, 'auth/invitation-accept', 'POST', undefined, { 'X-Relay-Invitation': otherInvite.data.token })).status, 409);
  assert.equal((await request(departed, scoped('feed'))).status, 403);

  // Explicit new invitation reactivates a former member without restoring ownership or losing attribution.
  const returnInvite = await people.createPersonInvitation(database, remaining, space, departed.verifiedEmail, Date.now() + 1000);
  await people.acceptPersonInvitation(database, departed, returnInvite.token, Date.now() + 1100);
  const restored = await database.prepare('SELECT id,role,revision FROM space_memberships WHERE person_id=? AND space_id=?').bind(departed.personId, space).first();
  assert.equal(restored.role, 'member');
  const legacyId = crypto.randomUUID();
  const credential = 'f'.repeat(64);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(credential))), byte => byte.toString(16).padStart(2, '0')).join('');
  await database.batch([
    database.prepare("INSERT INTO devices(id,space_id,name,token_hash,role,created_at,expires_at) VALUES(?,?,?,?,'owner',?,?)").bind(legacyId, space, 'Claimed old browser', hash, now, now + 604800000),
    database.prepare('INSERT INTO legacy_owner_claims(device_id,membership_id,session_id,claimed_at) VALUES(?,?,?,?)').bind(legacyId, restored.id, departed.sessionId, now),
    database.prepare('INSERT INTO invitations(token_hash,space_id,created_by,expires_at) VALUES(?,?,?,?)').bind('e'.repeat(64), space, legacyId, now + 604800000),
  ]);
  assert.equal((await request(remaining,scoped(`people/${restored.id}`),'PUT',{action:'editor',revision:restored.revision})).status,200);
  restored.revision++;
  assert.equal((await database.prepare('SELECT role FROM devices WHERE id=?').bind(legacyId).first()).role,'member','Account Editor must never become a legacy Owner.');
  assert.equal((await request(departed,'feed','GET',undefined,{Cookie:`relay_device=${credential}`})).status,200);
  assert.equal((await request(departed,'invitations','POST',undefined,{Cookie:`relay_device=${credential}`})).status,403);
  assert.equal((await request(remaining,scoped(`people/${restored.id}`),'PUT',{action:'viewer',revision:restored.revision})).status,200);
  restored.revision++;
  assert.equal((await request(departed,'feed','GET',undefined,{Cookie:`relay_device=${credential}`})).status,401,'Viewer cannot retain upload-capable paired credentials.');
  assert.equal((await request(departed,scoped('feed'))).status,200,'Viewer can still browse by signing in.');
  assert.equal((await request(remaining,scoped(`people/${restored.id}`),'PUT',{action:'member',revision:restored.revision})).status,200);
  restored.revision++;
  assert.equal((await request(departed,'feed','GET',undefined,{Cookie:`relay_device=${credential}`})).status,401,'Promotion does not revive a revoked credential.');
  const mediaBefore = await database.prepare('SELECT COUNT(*) AS n FROM media').first();
  assert.equal((await request(remaining, scoped(`people/${restored.id}`), 'PUT', { action: 'remove', revision: restored.revision })).status, 200);
  assert.equal((await request(departed, 'feed', 'GET', undefined, { Cookie: `relay_device=${credential}` })).status, 401, 'Claimed legacy cookie must not bypass removal');
  assert.equal((await database.prepare('SELECT expires_at FROM invitations WHERE created_by=?').bind(legacyId).first()).expires_at, 0);
  assert.deepEqual(await database.prepare('SELECT COUNT(*) AS n FROM media').first(), mediaBefore);

  // A personal space cannot acquire a shared roster or invitations, even for its legitimate owner.
  const personalSpace = crypto.randomUUID();
  await database.batch([
    database.prepare('INSERT INTO spaces(id,name,created_at) VALUES(?,?,?)').bind(personalSpace, 'Private fixture', now),
    database.prepare('INSERT INTO personal_spaces(space_id,person_id,quota_bytes) VALUES(?,?,?)').bind(personalSpace, stranger.personId, 1073741824),
    database.prepare("INSERT INTO space_memberships(id,person_id,space_id,role,created_at) VALUES(?,?,?,'owner',?)").bind(crypto.randomUUID(), stranger.personId, personalSpace, now),
  ]);
  assert.equal((await request(stranger, `people?space=${personalSpace}`)).status, 403);
  assert.equal((await request(stranger, `person-invitations?space=${personalSpace}`, 'POST', { email: guest.verifiedEmail })).status, 409);
  for (const scenario of ['expired', 'disabled-recipient', 'revoked-session']) {
    const recipient = await login('people-' + scenario);
    const created = await people.createPersonInvitation(database, remaining, space, recipient.verifiedEmail);
    if (scenario === 'expired') await database.prepare('UPDATE person_invitations SET expires_at=0 WHERE id=?').bind(created.id).run();
    if (scenario === 'disabled-recipient') await database.prepare('UPDATE people SET disabled_at=? WHERE id=?').bind(Date.now(), recipient.personId).run();
    if (scenario === 'revoked-session') await database.prepare('UPDATE account_sessions SET revoked_at=? WHERE id=?').bind(Date.now(), recipient.sessionId).run();
    await assert.rejects(people.previewPersonInvitation(database, recipient, created.token));
    await assert.rejects(people.acceptPersonInvitation(database, recipient, created.token));
    assert.equal((await database.prepare('SELECT COUNT(*) AS n FROM space_memberships WHERE person_id=? AND space_id=?').bind(recipient.personId, space).first()).n, 0);
  }
  // Even a malformed restored invitation cannot use an owner of another space to reveal a private name.
  const malformed = await people.createPersonInvitation(database, remaining, space, stranger.verifiedEmail);
  await database.prepare('UPDATE person_invitations SET space_id=? WHERE id=?').bind(personalSpace, malformed.id).run();
  await assert.rejects(people.previewPersonInvitation(database, stranger, malformed.token));
  await assert.rejects(people.acceptPersonInvitation(database, stranger, malformed.token));
  const pending = await people.createPersonInvitation(database, remaining, space, 'future@example.test');
  const capacityNow = Date.now();
  const existingInvites = (await database.prepare('SELECT COUNT(*) AS n FROM person_invitations WHERE space_id=? AND revoked_at IS NULL AND accepted_at IS NULL AND expires_at>?').bind(space, capacityNow).first()).n;
  const invitationRace = await Promise.allSettled(Array.from({ length: 25 }, (_, index) => people.createPersonInvitation(database, remaining, space, `capacity-${index}@example.test`, capacityNow)));
  assert.equal(invitationRace.filter(result => result.status === 'fulfilled').length, 20 - existingInvites, 'Concurrent issuance cannot exceed the invitation budget');
  await database.prepare('UPDATE space_memberships SET revoked_at=? WHERE id=?').bind(Date.now(), remainingMembership).run();
  const future = await login('future');
  await assert.rejects(people.acceptPersonInvitation(database, future, pending.token), /no longer available/);
  console.log('PASS: email-bound invitation preview/acceptance, races/replay/revocation, ownership handover, last-owner protection, stale revisions, linked legacy revocation, retained files and personal isolation.');
}
