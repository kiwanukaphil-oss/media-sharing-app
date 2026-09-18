import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const hosted = process.argv.includes('--hosted');
const saved = hosted ? JSON.parse(await readFile('.sites-runtime/cloud-test-session.json', 'utf8')) : null;
const origin = saved?.origin || process.env.RELAY_TEST_ORIGIN || 'http://localhost:8787';
let cookie = saved?.cookie || '';
const api = (path, method = 'GET', body) => fetch(`${origin}/api/${path}`, { method, headers: { Cookie: cookie, Origin: origin, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000) });
if (!hosted) {
  assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
  const connected = await api('connect', 'POST', { name: 'Load fixture', spaceName: 'Isolated bounded load' });
  assert.equal(connected.status, 200); cookie = connected.headers.get('set-cookie').split(';')[0];
} else {
  const session = await api('session').then(response => response.json());
  assert.equal(session.space.name, 'Relay verification');
  assert.equal(session.role, 'owner', 'The verification credential must be an owner after migration.');
}
const latencies = [];
const concurrency = hosted ? 5 : 20;
const requests = hosted ? 50 : 200;
// Bound the test to metadata reads and one streamed fixture; never run an unbounded traffic generator.
async function readFeedBatch() {
  for (let n = 0; n < requests / concurrency; n++) {
    const start = performance.now(); const response = await api('feed');
    assert.equal(response.status, 200); assert.ok(Array.isArray((await response.json()).items));
    latencies.push(performance.now() - start);
  }
}
await Promise.all(Array.from({ length: concurrency }, readFeedBatch));
latencies.sort((a, b) => a - b);
console.log(`PASS ${hosted ? 'hosted' : 'local'} metadata: ${requests} requests, concurrency ${concurrency}, p95 ${Math.round(latencies[Math.floor(latencies.length * .95)])} ms, zero errors.`);

const size = (hosted ? 256 : 1024) * 1024 * 1024 + 123;
const chunk = Buffer.alloc(16 * 1024 * 1024, 0x7b);
const hash = createHash('sha256');
for (let offset = 0; offset < size; offset += chunk.length) hash.update(chunk.subarray(0, Math.min(chunk.length, size - offset)));
const sha256 = hash.digest('hex'); const id = randomUUID();
const file = { id, name: `bounded-load-${id}.raw`, mime: 'application/octet-stream', size, sha256, category: 'original' };
const initialization = await Promise.all([api('uploads', 'POST', file), api('uploads', 'POST', file)]);
for (const response of initialization) assert.equal(response.status, 200);
const sessions = await Promise.all(initialization.map(r => r.json()));
assert.equal(sessions[0].uploadId, sessions[1].uploadId, 'Concurrent initialization reuses the winning session');
const parts = [];
for (let offset = 0, number = 1; offset < size; offset += chunk.length, number++) {
  const { url } = await api(`uploads/${id}/part`, 'POST', { number }).then(r => r.json());
  const bytes = chunk.subarray(0, Math.min(chunk.length, size - offset));
  if (hosted && number === 1) {
    assert.match(new URL(url).searchParams.get('X-Amz-SignedHeaders'), /content-length/);
    const wrong = await fetch(url, { method: 'PUT', body: Buffer.alloc(1), signal: AbortSignal.timeout(60000) });
    assert.equal(wrong.status, 403, 'A signed part must reject bytes beyond/below its reservation');
  }
  const response = await fetch(new URL(url, origin), { method: 'PUT', headers: hosted ? { Origin: origin } : { Origin: origin, Cookie: cookie }, body: bytes, signal: AbortSignal.timeout(120000) });
  assert.equal(response.status, 200);
  parts.push({ partNumber: number, etag: response.headers.get('etag').replace(/^"|"$/g, '') });
  if (number % 8 === 0) console.log(`Uploaded ${number * 16} MiB of bounded fixture.`);
}
assert.equal((await api(`uploads/${id}/complete`, 'POST', { parts })).status, 200);
const downloaded = await api(`media/${id}/download`);
assert.equal(downloaded.status, 200); const downloadedHash = createHash('sha256'); let received = 0;
for await (const bytes of downloaded.body) { downloadedHash.update(bytes); received += bytes.length; }
assert.equal(received, size); assert.equal(downloadedHash.digest('hex'), sha256);
assert.equal((await api(`media/${id}/archive`, 'POST')).status, 200);
assert.equal((await api(`media/${id}`, 'DELETE')).status, 200);
console.log(`PASS ${hosted ? 'hosted' : 'local'} ${size}-byte multipart round trip with incremental hashing and explicit fixture cleanup.`);
