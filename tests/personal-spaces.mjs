import assert from 'node:assert/strict';
import { build } from 'esbuild';

const compiled = await build({ entryPoints: ['lib/personal-spaces.ts', 'lib/account-sessions.ts'], bundle: true,
  write: false, outdir: 'unused', platform: 'node', format: 'esm' });
const modules = await Promise.all(compiled.outputFiles.map(file => import(`data:text/javascript;base64,${Buffer.from(file.text).toString('base64')}`)));
const personal = modules.find(module => module.createPersonalSpace);
const accounts = modules.find(module => module.createAccountSession);
const settings = { issuer: 'https://access.auth0.com/', clientId: 'access-test', clientSecret: 'isolated-test-only', appOrigin: 'https://localhost' };

// Real D1 allocation races and production API probes cover privacy independently of UI navigation.
export async function verifyPersonalSpaces(database, dispatch) {
  const login = async subject => {
    const result = await accounts.createAccountSession(database, settings,
      { issuer: settings.issuer, subject, displayName: subject, verifiedEmail: `${subject}@example.test` }, null);
    return { ...result, ...await accounts.readAccountSession(database, settings, result.token) };
  };
  const alice = await login('personal-alice');
  const bob = await login('personal-bob');
  assert.equal(personal.personalStorageBudget({}), 0);
  assert.throws(() => personal.personalStorageBudget({ PERSONAL_STORAGE_BUDGET_BYTES: '-1' }));
  const before = (await database.prepare('SELECT COUNT(*) AS n FROM spaces').first()).n;
  await assert.rejects(personal.createPersonalSpace(database, alice, 0), /not available/);
  assert.equal((await database.prepare('SELECT COUNT(*) AS n FROM spaces').first()).n, before);
  const attempts = await Promise.allSettled([alice, bob].map(person => personal.createPersonalSpace(database, person, personal.PERSONAL_SPACE_BYTES)));
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
  const owner = attempts[0].status === 'fulfilled' ? alice : bob;
  const outsider = owner === alice ? bob : alice;
  const created = attempts.find(result => result.status === 'fulfilled').value.space;
  const retried = await personal.createPersonalSpace(database, owner, 0);
  assert.equal(retried.space.id, created.id, 'Lowering creation budget never removes an existing personal library');
  assert.equal((await database.prepare('SELECT COUNT(*) AS n FROM spaces').first()).n, before + 1);
  const request = async (person, path, method = 'GET', body, extra = {}) => {
    const response = await dispatch(`${settings.appOrigin}/api/${path}`, { method,
      headers: { Origin: settings.appOrigin, Cookie: `__Host-relay_account=${person.token}`, 'Content-Type': 'application/json', ...extra },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  const scoped = path => `${path}${path.includes('?') ? '&' : '?'}space=${created.id}`;
  assert.equal((await request(owner, scoped('session'))).data.space.kind, 'personal');
  assert.equal((await request(owner, scoped('storage'))).data.limit, personal.PERSONAL_SPACE_BYTES);
  // Even a wrongly provisioned shared-style membership must never override the personal owner boundary.
  await database.prepare('INSERT INTO space_memberships (id,person_id,space_id,role,created_at) VALUES (?,?,?,?,?)')
    .bind(crypto.randomUUID(), outsider.personId, created.id, 'owner', Date.now()).run();
  assert.equal((await request(outsider, 'auth/spaces')).data.spaces.some(space => space.id === created.id), false);
  for (const path of ['session', 'feed', 'feed?category=trash', 'storage', 'albums', 'media/missing/thumbnail', 'media/missing/link']) {
    assert.equal((await request(outsider, scoped(path))).status, 403, path);
  }
  const credential = 'c'.repeat(64);
  const digest = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(credential))).toString('hex');
  const deviceId = crypto.randomUUID();
  await database.prepare("INSERT INTO devices (id,space_id,name,token_hash,role,created_at,expires_at) VALUES (?,?,?,?,'owner',?,?)")
    .bind(deviceId, created.id, 'Invalid personal legacy device', digest, Date.now(), Date.now() + 60000).run();
  assert.equal((await request(owner, 'feed', 'GET', undefined, { Cookie: `relay_device=${credential}` })).status, 401);
  assert.equal((await request(owner, 'auth/owner-claim', 'POST', undefined,
    { Cookie: `__Host-relay_account=${owner.token}; relay_device=${credential}` })).status, 409);
  const invitation = 'd'.repeat(64);
  const invitationHash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(invitation))).toString('hex');
  await database.prepare('INSERT INTO invitations (token_hash,space_id,created_by,expires_at) VALUES (?,?,?,?)')
    .bind(invitationHash, created.id, deviceId, Date.now() + 60000).run();
  assert.equal((await request(owner, 'connect', 'POST', { name: 'Unwanted device', invitation })).status, 410);
  const upload = { id: crypto.randomUUID(), name: 'Quota reservation.bin', mime: 'application/octet-stream',
    size: personal.PERSONAL_SPACE_BYTES, sha256: 'a'.repeat(64), category: 'original' };
  assert.equal((await request(owner, scoped('uploads'), 'POST', upload)).status, 200);
  const exhausted = await request(owner, scoped('uploads'), 'POST', { ...upload, id: crypto.randomUUID(), size: 1 });
  assert.equal(exhausted.status, 507);
  assert.match(exhausted.data.error, /1\.0 GB/);
  assert.equal((await request(owner, scoped(`uploads/${upload.id}`), 'DELETE')).status, 200);
  assert.equal((await request(owner, 'auth/personal-space', 'POST')).data.space.id, created.id);
  assert.equal((await request(outsider, 'auth/personal-space', 'POST', undefined, { Origin: 'https://other.example' })).status, 403);
  const secondPersonal = await request(outsider, 'auth/personal-space', 'POST');
  assert.equal(secondPersonal.status, 200);
  assert.notEqual(secondPersonal.data.space.id, created.id);
  assert.equal((await request(outsider, scoped('feed'))).status, 403, 'Creating My space never grants another personal library');
  await database.prepare('UPDATE space_memberships SET revoked_at=? WHERE person_id=? AND space_id=?').bind(Date.now(), owner.personId, created.id).run();
  await assert.rejects(personal.createPersonalSpace(database, owner, personal.PERSONAL_SPACE_BYTES * 2), /not available/);
  assert.equal((await request(owner, scoped('feed'))).status, 403);
  console.log('PASS: bounded personal allocation races, idempotence, owner-only privacy, legacy/claim denial, quota reservations and revoked access.');
}
