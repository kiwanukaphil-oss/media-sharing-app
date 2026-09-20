import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['lib/space-memberships.ts', 'lib/account-sessions.ts'], bundle: true, write: false,
  outdir: 'unused', platform: 'node', format: 'esm' });
const modules = await Promise.all(bundle.outputFiles.map(file => import(`data:text/javascript;base64,${Buffer.from(file.text).toString('base64')}`)));
const claims = modules.find(module => module.prepareOwnerClaim);
const accounts = modules.find(module => module.createAccountSession);
const settings = { issuer: 'https://claims.auth0.com/', clientId: 'claims-client', clientSecret: 'fixture', appOrigin: 'https://relay.example' };
const token = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex');
const hash = value => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)).then(bytes => Buffer.from(bytes).toString('hex'));

// Real D1 races verify that preview authority cannot survive revocation or create duplicate claims.
export async function verifySpaceMemberships(database) {
  const now = Date.now();
  const spaceId = crypto.randomUUID();
  await database.prepare('INSERT INTO spaces (id,name,created_at) VALUES (?, ?, ?)').bind(spaceId, 'Claim fixture', now).run();
  const person = async subject => {
    const login = await accounts.createAccountSession(database, settings,
      { issuer: settings.issuer, subject, displayName: subject, verifiedEmail: subject + '@example.test' }, null, now);
    return accounts.readAccountSession(database, settings, login.token, now);
  };
  const device = async (role = 'owner') => {
    const credential = token();
    const id = crypto.randomUUID();
    await database.prepare('INSERT INTO devices (id,space_id,name,token_hash,role,created_at,expires_at) VALUES (?,?,?,?,?,?,?)')
      .bind(id, spaceId, 'Claim device', await hash(credential), role, now, now + 86400000).run();
    return { id, credential };
  };
  const alice = await person('claim-alice');
  const bob = await person('claim-bob');
  const owner = await device();
  const member = await device('member');
  assert.deepEqual(await claims.listPersonSpaces(database, alice), []);
  await assert.rejects(claims.prepareOwnerClaim(database, alice, member.credential, now), /cannot connect/);
  await assert.rejects(claims.prepareOwnerClaim(database, { ...alice, createdAt: now - 600001 }, owner.credential, now), /Sign in again/);
  const alicePreview = await claims.prepareOwnerClaim(database, alice, owner.credential, now);
  const bobPreview = await claims.prepareOwnerClaim(database, bob, owner.credential, now);
  assert.equal(alicePreview.accountEmail, 'claim-alice@example.test');
  assert.equal(alicePreview.spaceName, 'Claim fixture');
  assert.deepEqual(await claims.listPersonSpaces(database, alice), [], 'Preview grants no access');
  await assert.rejects(claims.confirmOwnerClaim(database, bob, owner.credential, alicePreview.token, now), /Access changed/);
  await assert.rejects(claims.confirmOwnerClaim(database, alice, member.credential, alicePreview.token, now), /Access changed/);
  const competing = await Promise.allSettled([
    claims.confirmOwnerClaim(database, alice, owner.credential, alicePreview.token, now),
    claims.confirmOwnerClaim(database, bob, owner.credential, bobPreview.token, now),
  ]);
  assert.equal(competing.filter(result => result.status === 'fulfilled').length, 1);
  const winner = competing[0].status === 'fulfilled' ? alice : bob;
  const winningPreview = winner === alice ? alicePreview : bobPreview;
  const membership = (await claims.listPersonSpaces(database, winner))[0];
  assert.equal(membership.id, spaceId);
  assert.equal(membership.role, 'owner');
  await assert.rejects(claims.confirmOwnerClaim(database, winner, owner.credential, winningPreview.token, now), /Access changed/);
  assert.equal((await database.prepare('SELECT COUNT(*) AS n FROM space_memberships WHERE space_id=?').bind(spaceId).first()).n, 1);
  const original = await database.prepare('SELECT revoked_at,role FROM devices WHERE id=?').bind(owner.id).first();
  assert.equal(original.revoked_at, null);
  assert.equal(original.role, 'owner');
  await database.prepare('UPDATE space_memberships SET revoked_at=? WHERE person_id=? AND space_id=?').bind(now, winner.personId, spaceId).run();
  assert.deepEqual(await claims.listPersonSpaces(database, winner), []);
  const replacementOwner = await device();
  await assert.rejects(claims.prepareOwnerClaim(database, winner, replacementOwner.credential, now), /cannot connect/);
  // Every authority change after preview must be checked inside the committing write.
  for (const scenario of ['demote', 'revoke-device', 'expire-device', 'revoke-session', 'disable-person', 'expire-claim']) {
    const account = await person('claim-' + scenario);
    const proof = await device();
    const preview = await claims.prepareOwnerClaim(database, account, proof.credential, now);
    if (scenario === 'demote') await database.prepare("UPDATE devices SET role='member' WHERE id=?").bind(proof.id).run();
    if (scenario === 'revoke-device') await database.prepare('UPDATE devices SET revoked_at=? WHERE id=?').bind(now, proof.id).run();
    if (scenario === 'expire-device') await database.prepare('UPDATE devices SET expires_at=? WHERE id=?').bind(now, proof.id).run();
    if (scenario === 'revoke-session') await database.prepare('UPDATE account_sessions SET revoked_at=? WHERE id=?').bind(now, account.sessionId).run();
    if (scenario === 'disable-person') await database.prepare('UPDATE people SET disabled_at=? WHERE id=?').bind(now, account.personId).run();
    await assert.rejects(claims.confirmOwnerClaim(database, account, proof.credential, preview.token,
      scenario === 'expire-claim' ? preview.expiresAt : now), /Access changed/);
    assert.deepEqual(await claims.listPersonSpaces(database, account), []);
  }
  const duplicate = new Request('https://relay.example', { headers: { Cookie: `relay_device=${owner.credential}; relay_device=${owner.credential}` } });
  assert.equal(claims.readLegacyClaimCredential(duplicate), null);
  console.log('PASS: explicit owner claims, competing identities, replay, changed authority, expiry, revoked-membership denial and unchanged legacy access.');
}
