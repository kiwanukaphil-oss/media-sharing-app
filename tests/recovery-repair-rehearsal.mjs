import assert from 'node:assert/strict';
import { createHmac, createHash } from 'node:crypto';
import { build } from 'esbuild';
import { inspectAuth0Recovery, providerOrigin, recoveryPeopleQuery } from '../scripts/check-auth0-recovery.mjs';

const compiled = await build({ entryPoints: ['lib/account-recovery.ts', 'lib/account-sessions.ts'], bundle: true,
  write: false, outdir: 'unused', platform: 'node', format: 'esm' });
const modules = await Promise.all(compiled.outputFiles.map(file => import(`data:text/javascript;base64,${Buffer.from(file.text).toString('base64')}`)));
const recovery = modules.find(module => module.acceptRecoveryEvent);
const sessions = modules.find(module => module.createAccountSession);
const settings = { issuer: `${providerOrigin}/`, clientId: 'repair-rehearsal', clientSecret: 'isolated-only', appOrigin: 'https://localhost' };
const secret = 'b'.repeat(64); // Disposable signing key; this rehearsal never reads production credentials.

// Rehearse detection, verified timestamp replay and independent readback in disposable actual-schema D1.
// Provider responses are explicit fixtures; no provider account, remote database or real session is changed.
export async function verifyRecoveryRepair(database) {
  const now = Date.now();
  const resetAt = now - 60000;
  const subject = 'auth0|repair-rehearsal';
  const otherSubject = 'auth0|repair-unaffected';
  const identity = (id, authenticatedAt) => ({ issuer: settings.issuer, subject: id, displayName: 'Synthetic repair',
    verifiedEmail: `${id}@example.test`, authenticatedAt, credentialsChangedAt: 0 });
  const old = await sessions.createAccountSession(database, settings, identity(subject, resetAt - 10000), null, now);
  const newer = await sessions.createAccountSession(database, settings, identity(subject, resetAt + 10000), null, now);
  const other = await sessions.createAccountSession(database, settings, identity(otherSubject, resetAt - 10000), null, now);
  const owner = await sessions.readAccountSession(database, settings, newer.token, now);
  const space = crypto.randomUUID();
  await database.batch([
    database.prepare('INSERT INTO spaces (id,name,created_at) VALUES (?,?,?)').bind(space, 'Repair rehearsal', now),
    database.prepare('INSERT INTO space_memberships (id,person_id,space_id,role,created_at) VALUES (?,?,?,?,?)')
      .bind(crypto.randomUUID(), owner.personId, space, 'owner', now),
  ]);
  const protectedTables = ['spaces', 'space_memberships', 'devices', 'media', 'albums', 'album_media', 'album_sections'];
  const fingerprints = async () => Promise.all(protectedTables.map(async table => {
    const { results } = await database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
    return createHash('sha256').update(JSON.stringify(results)).digest('hex');
  }));
  const before = await fingerprints();
  let retainedFailure = false;
  // Every request terminates here; assert the production monitor's exact destination and requested identity.
  const providerFixture = async (destination, options) => {
    const url = new URL(destination);
    assert.equal(url.origin, providerOrigin);
    assert.equal(options.redirect, 'error');
    if (url.pathname === '/oauth/token') return Response.json({ access_token: 'isolated-token', token_type: 'Bearer' });
    if (url.pathname === '/api/v2/logs') return Response.json(retainedFailure
      ? [{ type: 'actions_execution_failed', date: new Date(resetAt).toISOString() }] : []);
    const requestedSubject = decodeURIComponent(url.pathname.slice('/api/v2/users/'.length));
    assert.ok([subject, otherSubject].includes(requestedSubject));
    return Response.json({ user_id: requestedSubject, ...(requestedSubject === subject
      ? { last_password_reset: new Date(resetAt).toISOString() } : {}) });
  };
  const inspect = async () => inspectAuth0Recovery((await database.prepare(recoveryPeopleQuery).all()).results,
    { clientId: 'isolated-monitor', clientSecret: 'isolated-secret' }, providerFixture, now);
  assert.equal((await inspect()).length, 1, 'Missing delivery must be detected even before another sign-in reconciles it.');
  assert.ok(await sessions.readAccountSession(database, settings, old.token, now));
  const replay = async changedAt => {
    const body = JSON.stringify({ issuer: settings.issuer, subject, changedAt });
    const signature = createHmac('sha256', secret).update(`${now}.${body}`).digest('hex');
    return recovery.acceptRecoveryEvent(new Request(`${settings.appOrigin}/api/auth/recovery-event`, {
      method: 'POST', headers: { 'X-Relay-Recovery-Time': String(now), 'X-Relay-Recovery-Signature': signature }, body,
    }), database, settings, secret, now);
  };
  assert.equal((await replay(resetAt)).status, 204);
  assert.equal(await sessions.readAccountSession(database, settings, old.token, now), null);
  assert.ok(await sessions.readAccountSession(database, settings, newer.token, now));
  assert.ok(await sessions.readAccountSession(database, settings, other.token, now));
  const evidence = await database.prepare(recoveryPeopleQuery).all();
  const repaired = evidence.results.find(person => person.subject === subject);
  assert.equal(repaired.credentials_changed_at, resetAt);
  assert.equal(repaired.delivered_changed_at, resetAt);
  assert.deepEqual(await inspect(), []);
  for (const timestamp of [resetAt, resetAt - 1000]) assert.equal((await replay(timestamp)).status, 204);
  assert.deepEqual(await inspect(), []);
  assert.ok(await sessions.readAccountSession(database, settings, newer.token, now));
  assert.deepEqual(await fingerprints(), before, 'Repair must preserve library content, devices and membership.');
  retainedFailure = true;
  assert.equal((await inspect()).length, 1, 'Repair does not suppress retained provider failure logs.');
  console.log('PASS: isolated operator repair detects missed reset, replays verified evidence, preserves newer/unrelated sessions and library state.');
}
