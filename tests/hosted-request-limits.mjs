import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const { origin, cookie } = JSON.parse(await readFile('.sites-runtime/cloud-test-session.json', 'utf8'));
const headers = { Origin: origin, Cookie: cookie };
const api = (path, method = 'GET', body) => fetch(`${origin}/api/${path}`, {
  method, headers: { ...headers, 'Content-Type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000),
});
assert.equal((await api('session').then(response => response.json())).space.name, 'Relay verification');
const bytes = Buffer.from('Isolated production request-limit fixture.');
const id = randomUUID();
let published = false;
assert.equal((await api('uploads', 'POST', {
  id, name: `request-limit-${id}.raw`, mime: 'application/octet-stream', size: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'), category: 'original',
})).status, 200);
try {
  const { url } = await api(`uploads/${id}/part`, 'POST', { number: 1 }).then(response => response.json());
  const part = await fetch(url, { method: 'PUT', body: bytes, signal: AbortSignal.timeout(30000) });
  assert.equal(part.status, 200);
  assert.equal((await api(`uploads/${id}/complete`, 'POST', {
    parts: [{ partNumber: 1, etag: part.headers.get('etag').replace(/^"|"$/g, '') }],
  })).status, 200);
  published = true;
  const preview = body => fetch(`${origin}/api/media/${id}/thumbnail`, {
    method: 'PUT', headers: { ...headers, 'Content-Type': 'image/jpeg' }, body, signal: AbortSignal.timeout(30000),
  });
  const rejected = await preview(Buffer.alloc(250001));
  assert.equal(rejected.status, 413); await rejected.arrayBuffer();
  assert.equal((await preview(Buffer.from([255, 216, 255, 217]))).status, 200);
  const metadata = await fetch(`${origin}/api/connect`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: 'x'.repeat(1024 * 1024 + 1), signal: AbortSignal.timeout(30000),
  });
  assert.equal(metadata.status, 413); await metadata.arrayBuffer();
  assert.equal((await api('feed')).status, 200);
  assert.deepEqual(Buffer.from(await api(`media/${id}/download`).then(response => response.arrayBuffer())), bytes);
  console.log('PASS: hosted oversized previews and metadata rejected cleanly; following requests and original bytes remain intact.');
} finally {
  if (published) {
    assert.equal((await api(`media/${id}/archive`, 'POST')).status, 200);
    assert.equal((await api(`media/${id}`, 'DELETE')).status, 200);
  } else assert.equal((await api(`uploads/${id}`, 'DELETE')).status, 200);
}
