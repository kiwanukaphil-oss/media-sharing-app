import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

const result = await build({ entryPoints: ['lib/account-sessions.ts'], bundle: true, write: false, platform: 'node', format: 'esm' });
const accounts = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const settings = { issuer: 'https://access.auth0.com/', clientId: 'access-test', clientSecret: 'isolated-test-only', appOrigin: 'https://localhost' };

// Actual routes prove an account owner can retire legacy access without deleting media or stranding account access.
export async function verifyLegacyReconciliation(database, dispatch) {
  const now = Date.now();
  const space = crypto.randomUUID();
  const otherSpace = crypto.randomUUID();
  const login = async subject => {
    const created = await accounts.createAccountSession(database, settings, { issuer: settings.issuer, subject, displayName: subject,
      authenticatedAt: Math.floor(now / 1000) * 1000, credentialsChangedAt: 0, verifiedEmail: `${subject}@example.test` }, null);
    return { ...created, ...await accounts.readAccountSession(database, settings, created.token) };
  };
  const [owner, member] = await Promise.all(['legacy-review-owner', 'legacy-review-member'].map(login));
  const ownerMembership = crypto.randomUUID();
  await database.batch([
    database.prepare('INSERT INTO spaces(id,name,created_at) VALUES(?,?,?)').bind(space, 'Legacy review', now),
    database.prepare('INSERT INTO spaces(id,name,created_at) VALUES(?,?,?)').bind(otherSpace, 'Foreign legacy', now),
    database.prepare("INSERT INTO space_memberships(id,person_id,space_id,role,created_at) VALUES(?,?,?,'owner',?)").bind(ownerMembership, owner.personId, space, now),
    database.prepare("INSERT INTO space_memberships(id,person_id,space_id,role,created_at) VALUES(?,?,?,'member',?)").bind(crypto.randomUUID(), member.personId, space, now),
  ]);
  const makeDevice = async (destination, role) => {
    const id = crypto.randomUUID();
    const token = crypto.randomUUID().replaceAll('-', '').repeat(2);
    await database.prepare('INSERT INTO devices(id,space_id,name,token_hash,role,created_at,expires_at) VALUES(?,?,?,?,?,?,?)')
      .bind(id, destination, 'Paired ' + role, createHash('sha256').update(token).digest('hex'), role, now, now + 100000).run();
    return { id, token };
  };
  const pairedOwner = await makeDevice(space, 'owner');
  const pairedMember = await makeDevice(space, 'member');
  const foreign = await makeDevice(otherSpace, 'owner');
  await database.prepare('INSERT INTO legacy_owner_claims(device_id,membership_id,session_id,claimed_at) VALUES(?,?,?,?)')
    .bind(pairedOwner.id, ownerMembership, owner.sessionId, now).run();
  const invitationToken = 'b'.repeat(64);
  const invitationHash = createHash('sha256').update(invitationToken).digest('hex');
  await database.prepare('INSERT INTO invitations(token_hash,space_id,created_by,expires_at) VALUES(?,?,?,?)')
    .bind(invitationHash, space, pairedOwner.id, now + 100000).run();
  const request = (person, path = 'legacy-devices', method = 'GET', body, origin = settings.appOrigin) => dispatch(`${settings.appOrigin}/api/${path}?space=${space}`,
    { method, headers: { Cookie: `__Host-relay_account=${person.token}`, Origin: origin, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal((await request(member)).status, 403);
  const listing = await (await request(owner)).json();
  assert.equal(listing.total, 2);
  assert.equal(listing.devices.find(device => device.id === pairedOwner.id).linkedPerson, 'legacy-review-owner');
  assert.equal(listing.devices.find(device => device.id === pairedMember.id).linkedPerson, null);
  assert.ok(!listing.devices.some(device => device.id === foreign.id));
  assert.equal((await request(owner, `legacy-devices/${pairedMember.id}`, 'DELETE', { confirmed: false })).status, 400);
  assert.equal((await request(owner, `legacy-devices/${pairedMember.id}`, 'DELETE', { confirmed: true }, 'https://evil.example')).status, 403);
  assert.equal((await request(member, 'legacy-devices/all', 'DELETE', { confirmed: true })).status, 409);
  assert.equal((await request(owner, `legacy-devices/${foreign.id}`, 'DELETE', { confirmed: true })).status, 409);
  assert.equal((await request(owner, `legacy-devices/${pairedMember.id}`, 'DELETE', { confirmed: true })).status, 200);
  const native = await dispatch(`${settings.appOrigin}/api/feed`, { headers: { Authorization: `Bearer ${pairedMember.token}` } });
  assert.equal(native.status, 401);
  const attempts = await Promise.all([
    request(owner, 'legacy-devices/all', 'DELETE', { confirmed: true }),
    dispatch(`${settings.appOrigin}/api/native/connect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Racing device', invitation: invitationToken }) }),
  ]);
  assert.equal(attempts[0].status, 200, 'Account owner can disconnect the final legacy owner.');
  assert.ok([200, 410].includes(attempts[1].status));
  assert.equal((await (await request(owner)).json()).total, 0, 'A racing redemption cannot survive retirement.');
  const invitation = await database.prepare('SELECT expires_at, redeemed_at FROM invitations WHERE token_hash=?').bind(invitationHash).first();
  assert.ok(invitation.redeemed_at || invitation.expires_at === 0, 'Unused pairing links are invalidated; consumed links remain unusable.');
  assert.equal((await request(owner, 'feed')).status, 200, 'Account owner retains library access.');
  assert.equal((await request(member, 'feed')).status, 200, 'Other account members retain access.');
  assert.equal((await database.prepare('SELECT revoked_at FROM devices WHERE id=?').bind(foreign.id).first()).revoked_at, null);
  await accounts.revokeAccountSession(database, owner, owner.sessionId);
  assert.equal((await request(owner)).status, 401);
  console.log('PASS: owner-only legacy inventory, verified claim labels, explicit individual/all revocation, foreign/CSRF denial, last-device handover and pairing race.');
}
