import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ entryPoints: ['lib/account-sessions.ts', 'lib/account-deletion.ts'], bundle: true, write: false,
  outdir: 'unused', platform: 'node', format: 'esm' });
const modules = await Promise.all(output.outputFiles.map(file => import(`data:text/javascript;base64,${Buffer.from(file.text).toString('base64')}`)));
const accounts = modules.find(module => module.createAccountSession);
const deletion = modules.find(module => module.requestAccountDeletion);
const settings = { issuer: 'https://access.auth0.com/', clientId: 'access-test', clientSecret: 'isolated-test-only', appOrigin: 'https://localhost' };

// A deletion request is constrained, reversible intent: no queue operation may disable access or erase data.
export async function verifyAccountDeletion(database, dispatch) {
  const now = Date.now();
  const signIn = async (subject, authenticatedAt = now) => {
    const result = await accounts.createAccountSession(database, settings, { issuer: settings.issuer, subject, displayName: subject,
      verifiedEmail: subject + '@example.test', authenticatedAt, credentialsChangedAt: 0 }, null, now);
    return { ...result, ...await accounts.readAccountSession(database, settings, result.token, now) };
  };
  const [owner, other, stale] = await Promise.all([signIn('deletion-owner'), signIn('deletion-other'), signIn('deletion-stale', now - 301000)]);
  const space = crypto.randomUUID();
  await database.batch([
    database.prepare('INSERT INTO spaces(id,name,created_at) VALUES(?,?,?)').bind(space, 'Handover first', now),
    database.prepare("INSERT INTO space_memberships(id,person_id,space_id,role,created_at) VALUES(?,?,?,'owner',?)").bind(crypto.randomUUID(), owner.personId, space, now),
  ]);
  const preview = await deletion.previewAccountDeletion(database, owner, now);
  assert.equal(preview.ownershipBlockers[0].id, space);
  await assert.rejects(deletion.requestAccountDeletion(database, owner, now), /hand over/);
  await assert.rejects(deletion.requestAccountDeletion(database, stale, now), /Sign in again/);
  await database.prepare("INSERT INTO space_memberships(id,person_id,space_id,role,created_at) VALUES(?,?,?,'owner',?)")
    .bind(crypto.randomUUID(), other.personId, space, now).run();
  const parallel = await Promise.all(Array.from({ length: 3 }, () => deletion.requestAccountDeletion(database, owner, now)));
  assert.equal(new Set(parallel.map(result => result.request.id)).size, 1);
  const request = parallel[0].request;
  assert.equal(request.status, 'pending');
  assert.ok(await accounts.readAccountSession(database, settings, owner.token, now));
  assert.equal((await database.prepare('SELECT COUNT(*) AS n FROM space_memberships WHERE space_id=? AND revoked_at IS NULL').bind(space).first()).n, 2);
  await assert.rejects(deletion.withdrawAccountDeletion(database, other, request.id, now), /changed/);
  const withdrawn = await deletion.withdrawAccountDeletion(database, owner, request.id, now + 1);
  assert.equal(withdrawn.request.status, 'withdrawn');
  const renewed = await deletion.requestAccountDeletion(database, owner, now + 2);
  assert.notEqual(renewed.request.id, request.id);
  const route = (path, method = 'GET', headers = {}) => dispatch(`${settings.appOrigin}/api/auth/${path}`, { method,
    headers: { Cookie: `__Host-relay_account=${owner.token}`, Origin: settings.appOrigin, ...headers } });
  assert.equal((await route('deletion', 'POST')).status, 400);
  assert.equal((await route('deletion', 'POST', { 'X-Relay-Confirm': 'request-account-deletion', Origin: 'https://evil.example' })).status, 403);
  assert.equal((await route('deletion', 'POST', { 'X-Relay-Confirm': 'request-account-deletion' })).status, 200);
  assert.equal((await route(`deletion/${renewed.request.id}`, 'DELETE')).status, 200);
  await accounts.revokeAccountSession(database, owner, owner.sessionId, now);
  assert.equal((await route('deletion')).status, 401);
  console.log('PASS: deletion-request handover, recent authentication, concurrent idempotence, withdrawal/isolation, CSRF and preserved access.');
}
