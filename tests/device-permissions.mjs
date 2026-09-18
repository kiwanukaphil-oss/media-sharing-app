import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

const origin = process.env.RELAY_TEST_ORIGIN || 'http://localhost:5173';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname), 'Permission fixtures must stay local.');
const requestPermissionApi = (path, cookie, method = 'GET', body, extra = {}) => fetch(`${origin}/api/${path}`, {
  method, headers: { Origin: origin, Cookie: cookie || '', 'Content-Type': 'application/json', ...extra },
  body: body ? JSON.stringify(body) : undefined,
});
const cookieFrom = response => response.headers.get('set-cookie').split(';')[0];
async function createOwner() {
  const response = await requestPermissionApi('connect', '', 'POST', { name: 'Permission owner', spaceName: `Permissions ${randomUUID()}` });
  assert.equal(response.status, 200);
  return cookieFrom(response);
}
async function inviteMember(owner) {
  const invitation = await requestPermissionApi('invitations', owner, 'POST').then(response => response.json());
  const response = await requestPermissionApi('connect', '', 'POST', { name: 'Permission member', invitation: invitation.token, role: 'owner' });
  assert.equal(response.status, 200);
  const cookie = cookieFrom(response);
  const session = await requestPermissionApi('session', cookie).then(response => response.json());
  assert.equal(session.role, 'member', 'Caller-supplied roles cannot elevate an invitation.');
  return { cookie, ...session };
}

// Publish tiny original bytes through the same upload protocol members use in production.
async function publishPermissionFixture(cookie) {
  const bytes = Buffer.from('Role verification original');
  const id = randomUUID();
  const manifest = { id, name: 'permissions.raw', mime: 'application/octet-stream', size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'), category: 'original' };
  assert.equal((await requestPermissionApi('uploads', cookie, 'POST', manifest)).status, 200);
  const { url } = await requestPermissionApi(`uploads/${id}/part`, cookie, 'POST', { number: 1 }).then(response => response.json());
  const part = await fetch(new URL(url, origin), { method: 'PUT', headers: { Origin: origin, Cookie: cookie }, body: bytes });
  assert.equal(part.status, 200);
  const parts = [{ partNumber: 1, etag: part.headers.get('etag').replaceAll('"', '') }];
  assert.equal((await requestPermissionApi(`uploads/${id}/complete`, cookie, 'POST', { parts })).status, 200);
  return { id, bytes, manifest };
}

// Validate privileges, invitation lineage, logout and the atomic last-owner guard against real D1/R2.
async function verifyDevicePermissions() {
  const owner = await createOwner();
  const ownerSession = await requestPermissionApi('session', owner).then(response => response.json());
  assert.equal(ownerSession.role, 'owner');
  const member = await inviteMember(owner);
  const stranger = await createOwner();
  assert.equal((await requestPermissionApi('feed', member.cookie).then(response => response.json())).role, 'member');
  assert.equal((await requestPermissionApi('invitations', member.cookie, 'POST')).status, 403);
  assert.equal((await requestPermissionApi(`devices/${ownerSession.deviceId}`, member.cookie, 'DELETE')).status, 403);
  assert.equal((await requestPermissionApi(`devices/${member.deviceId}/role`, member.cookie, 'PUT', { role: 'owner' })).status, 403);
  assert.equal((await requestPermissionApi(`devices/${member.deviceId}/role`, stranger, 'PUT', { role: 'owner' })).status, 404);
  assert.equal((await requestPermissionApi(`devices/${member.deviceId}/role`, owner, 'PUT', { role: 'admin' })).status, 400);
  assert.equal((await requestPermissionApi('session', owner, 'DELETE')).status, 409, 'The sole owner cannot leave.');
  assert.equal((await requestPermissionApi(`devices/${ownerSession.deviceId}/role`, owner, 'PUT', { role: 'member' })).status, 409);
  const fixture = await publishPermissionFixture(member.cookie);
  const download = await requestPermissionApi(`media/${fixture.id}/download`, member.cookie);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), fixture.bytes);
  assert.equal((await requestPermissionApi(`media/${fixture.id}/archive`, member.cookie, 'POST')).status, 403);
  assert.equal((await requestPermissionApi(`media/${fixture.id}/archive`, owner, 'POST')).status, 200);
  assert.equal((await requestPermissionApi(`media/${fixture.id}/restore`, member.cookie, 'POST')).status, 403);
  assert.equal((await requestPermissionApi(`media/${fixture.id}`, member.cookie, 'DELETE')).status, 403);
  assert.equal((await requestPermissionApi(`media/${fixture.id}/restore`, owner, 'POST')).status, 200);
  const unfinished = { ...fixture.manifest, id: randomUUID() };
  assert.equal((await requestPermissionApi('uploads', member.cookie, 'POST', unfinished)).status, 200);
  const otherMember = await inviteMember(owner);
  assert.equal((await requestPermissionApi(`uploads/${unfinished.id}`, otherMember.cookie, 'DELETE')).status, 403);
  assert.equal((await requestPermissionApi(`uploads/${unfinished.id}`, member.cookie, 'DELETE')).status, 200);
  assert.equal((await requestPermissionApi(`devices/${member.deviceId}/role`, owner, 'PUT', { role: 'owner' })).status, 200);
  const invitation = await requestPermissionApi('invitations', member.cookie, 'POST').then(response => response.json());
  assert.equal((await requestPermissionApi(`devices/${member.deviceId}/role`, owner, 'PUT', { role: 'member' })).status, 200);
  assert.equal((await requestPermissionApi('connect', '', 'POST', { name: 'Stale invite', invitation: invitation.token })).status, 410);
  assert.equal((await requestPermissionApi(`devices/${member.deviceId}/role`, owner, 'PUT', { role: 'owner' })).status, 200);
  assert.equal((await requestPermissionApi('connect', '', 'POST', { name: 'Still stale invite', invitation: invitation.token })).status, 410, 'Promotion cannot revive an invalidated invitation.');
  assert.equal((await requestPermissionApi('session', member.cookie, 'DELETE', undefined, { Origin: 'https://untrusted.example' })).status, 403);
  const disconnected = await requestPermissionApi('session', member.cookie, 'DELETE');
  assert.equal(disconnected.status, 200);
  assert.match(disconnected.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await requestPermissionApi('feed', member.cookie)).status, 401, 'A copied old cookie must also fail.');
  assert.equal((await requestPermissionApi(`media/${fixture.id}/download`, owner)).status, 200, 'Logout preserves originals.');
  assert.equal((await requestPermissionApi(`devices/${otherMember.deviceId}/role`, owner, 'PUT', { role: 'owner' })).status, 200);
  const raced = await Promise.all([
    requestPermissionApi(`devices/${ownerSession.deviceId}/role`, otherMember.cookie, 'PUT', { role: 'member' }),
    requestPermissionApi(`devices/${otherMember.deviceId}/role`, owner, 'PUT', { role: 'member' }),
  ]);
  assert.equal(raced.filter(response => response.status === 200).length, 1, 'Only one competing demotion may succeed.');
  assert.ok(raced.every(response => [200, 403, 409].includes(response.status)), 'The loser sees changed privileges or the last-owner guard.');
  const remainingOwner = raced[0].ok ? otherMember.cookie : owner;
  const remainingSession = await requestPermissionApi('session', remainingOwner).then(response => response.json());
  assert.equal(remainingSession.role, 'owner');
  assert.equal((await requestPermissionApi('session', remainingOwner, 'DELETE')).status, 409);

  // Native bearer sessions inherit member restrictions and can revoke their own credential.
  const nativeInvite = await requestPermissionApi('invitations', remainingOwner, 'POST').then(response => response.json());
  const nativeResponse = await requestPermissionApi('native/connect', '', 'POST', { name: 'Native member', invitation: nativeInvite.token });
  const { token } = await nativeResponse.json();
  assert.ok(token);
  assert.equal((await requestPermissionApi('invitations', '', 'POST', undefined, { Authorization: `Bearer ${token}` })).status, 403);
  assert.equal((await requestPermissionApi('session', '', 'DELETE', undefined, { Authorization: `Bearer ${token}` })).status, 200);
  assert.equal((await requestPermissionApi('feed', '', 'GET', undefined, { Authorization: `Bearer ${token}` })).status, 401);
  console.log('PASS: owner/member privileges, upload/download preservation, foreign-space denial, invitation invalidation, cookie/bearer logout, CSRF and concurrent last-owner protection.');
}
await verifyDevicePermissions();
