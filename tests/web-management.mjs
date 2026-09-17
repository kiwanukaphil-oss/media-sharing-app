import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';

const origin = process.env.RELAY_TEST_ORIGIN || 'http://localhost:5173';
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname)) throw new Error('Management fixtures run only against a local test database.');
const api = (path, cookie, method = 'GET', body) => fetch(`${origin}/api/${path}`, { method, headers: { Origin: origin, Cookie: cookie || '', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
async function connect(name) {
  const response = await api('connect', '', 'POST', { name, spaceName: `Web release ${randomUUID()}` });
  assert.equal(response.status, 200); return response.headers.get('set-cookie').split(';')[0];
}
// Real local R2 and D1 calls exercise publication, paging, trash, preview isolation, and quota races.
async function verifyManagement() {
  const owner = await connect('Management owner'); const stranger = await connect('Other space');
  const bytes = Buffer.from('Original media fixture. Never transform these bytes.');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const published = [];
  for (let number = 0; number < 5; number++) {
    const id = randomUUID(); published.push(id);
    const original = { id, name: `release-${number}.raw`, mime: 'application/octet-stream', size: bytes.length, sha256: hash, category: number % 2 ? 'final' : 'original' };
    assert.equal((await api('uploads', owner, 'POST', original)).status, 200);
    const { url } = await api(`uploads/${id}/part`, owner, 'POST', { number: 1 }).then(response => response.json());
    const part = await fetch(new URL(url, origin), { method: 'PUT', headers: { Cookie: owner, Origin: origin }, body: bytes });
    assert.equal(part.status, 200);
    const parts = [{ partNumber: 1, etag: part.headers.get('etag').replace(/^"|"$/g, '') }];
    assert.equal((await api(`uploads/${id}/complete`, owner, 'POST', { parts })).status, 200);
  }
  let cursor = ''; const seen = [];
  do {
    const response = await api(`feed?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, owner).then(response => response.json());
    assert.equal(response.total, 5); assert.deepEqual(response.counts, { all: 5, original: 3, final: 2, trash: 0 });
    seen.push(...response.items.map(item => item.id)); cursor = response.nextCursor;
  } while (cursor);
  assert.equal(new Set(seen).size, 5); assert.equal(seen.length, 5);
  assert.equal((await api('feed?category=final', owner).then(response => response.json())).items.length, 2);
  assert.equal((await api('feed?q=release-3', owner).then(response => response.json())).items[0].id, published[3]);
  assert.equal((await api('feed?cursor=garbage', owner)).status, 400);
  assert.equal((await api('feed?category=unknown', owner)).status, 400);
  const id = published[0];
  assert.equal((await api(`media/${id}`, owner, 'DELETE')).status, 409, 'Active originals cannot be permanently deleted.');
  assert.equal((await api(`media/${id}/archive`, stranger, 'POST')).status, 404);
  const storageBefore = await api('storage', owner).then(response => response.json());
  assert.equal((await api(`media/${id}/archive`, owner, 'POST')).status, 200);
  const trash = await api('feed?category=trash', owner).then(response => response.json());
  assert.equal(trash.items[0].id, id); assert.equal(trash.counts.all, 4);
  assert.equal((await api('storage', owner).then(response => response.json())).used, storageBefore.used);
  assert.equal((await api(`media/${id}/restore`, owner, 'POST')).status, 200);
  assert.equal((await api(`media/${id}/download`, owner).then(response => response.arrayBuffer())).byteLength, bytes.length);
  const thumbnail = Buffer.from([255, 216, 255, 217]);
  const preview = (cookie, body, mime = 'image/jpeg') => fetch(`${origin}/api/media/${id}/thumbnail`, { method: 'PUT', headers: { Cookie: cookie, Origin: origin, 'Content-Type': mime }, body });
  assert.equal((await preview(stranger, thumbnail)).status, 404);
  assert.equal((await preview(owner, Buffer.from('<svg/>'), 'image/svg+xml')).status, 415);
  assert.equal((await preview(owner, Buffer.alloc(250001))).status, 413);
  assert.equal((await preview(owner, thumbnail)).status, 200);
  assert.equal((await api(`media/${id}/thumbnail`, stranger)).status, 404);
  assert.deepEqual(Buffer.from(await api(`media/${id}/thumbnail`, owner).then(response => response.arrayBuffer())), thumbnail);
  assert.deepEqual(Buffer.from(await api(`media/${id}/download`, owner).then(response => response.arrayBuffer())), bytes);
  assert.equal((await api('storage', owner).then(response => response.json())).used, storageBefore.used + thumbnail.length);
  await api(`media/${id}/archive`, owner, 'POST');
  assert.equal((await api(`media/${id}`, owner, 'DELETE')).status, 200);
  assert.equal((await api(`media/${id}/download`, owner)).status, 404);
  assert.equal((await api(`media/${id}/thumbnail`, owner)).status, 404);
  const quotaOwner = await connect('Quota race owner');
  const huge = size => ({ id: randomUUID(), name: 'quota-reservation.bin', mime: 'application/octet-stream', size, sha256: hash, category: 'original' });
  const first = huge(60 * 1024 ** 3); const second = huge(60 * 1024 ** 3);
  const raced = await Promise.all([first, second].map(file => api('uploads', quotaOwner, 'POST', file)));
  assert.deepEqual(raced.map(response => response.status).sort(), [200, 507]);
  const quota = await api('storage', quotaOwner).then(response => response.json());
  assert.equal(quota.reserved, 60 * 1024 ** 3); assert.equal(quota.limit, 100 * 1024 ** 3);
  const accepted = raced[0].ok ? first : second;
  const previous = await api('uploads', quotaOwner, 'POST', accepted).then(response => response.json());
  const restarted = await api(`uploads/${accepted.id}/restart`, quotaOwner, 'POST').then(response => response.json());
  assert.notEqual(restarted.uploadId, previous.uploadId);
  assert.equal((await api(`uploads/${accepted.id}`, quotaOwner, 'DELETE')).status, 200);
  assert.equal((await api('storage', quotaOwner).then(response => response.json())).used, 0);
  assert.equal((await api(`uploads/${accepted.id}/part`, quotaOwner, 'POST', { number: 1 })).status, 404);
  console.log('PASS: cursor pagination, search, category counts, trash/restore/delete, preview isolation and byte preservation, quota races, restart and cancellation.');
}
await verifyManagement();
