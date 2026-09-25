import assert from 'node:assert/strict';
import { LibraryMemory } from '../lib/library-memory.ts';

const page = id => ({ items: [{ id }], total: 1, nextCursor: null, role: 'owner', counts: { all: 1, original: 1, final: 0, trash: 0 } });
const memory = new LibraryMemory();
let calls = 0, finish;
const first = memory.readFeed('a', 1, () => { calls++; return new Promise(resolve => { finish = resolve; }); });
const shared = memory.readFeed('a', 1, () => { throw new Error('Duplicate read'); });
assert.equal(first, shared);
finish(page('one')); await first; assert.equal(calls, 1); assert.equal(memory.peek('a').page.items[0].id, 'one');
let finishStale;
const stale = memory.readFeed('b', 1, () => new Promise(resolve => { finishStale = resolve; }));
memory.invalidate(); finishStale(page('stale'));
await assert.rejects(stale, { name: 'AbortError' }); assert.equal(memory.peek('b'), undefined);
for (let index = 0; index < 14; index++) await memory.readFeed(String(index), 1, async () => page(String(index)));
assert.equal(memory.peek('0'), undefined); assert.ok(memory.peek('13'));
await memory.readFeed('13', 1, async () => page('updated'));
assert.equal(memory.peek('12'), undefined, 'Authoritative changes invalidate other cached views.');
const originalNow = Date.now;
Date.now = () => originalNow() + 31_000;
assert.equal(memory.peek('13'), undefined, 'Expired snapshots cannot serve a repeat visit.');
Date.now = originalNow;

const originalFetch = globalThis.fetch;
let downloads = 0, active = 0, maximum = 0;
globalThis.fetch = async () => {
  downloads++; active++; maximum = Math.max(maximum, active);
  await new Promise(resolve => setTimeout(resolve, 2)); active--;
  return new Response(new Blob(['thumbnail'], { type: 'image/jpeg' }));
};
try {
  const urls = await Promise.all([memory.loadThumbnail('/same'), memory.loadThumbnail('/same')]);
  assert.equal(urls[0], urls[1]); assert.equal(downloads, 1);
  memory.invalidate('lists'); assert.equal(await memory.loadThumbnail('/same'), urls[0], 'Metadata changes retain thumbnail bytes.');
  await Promise.all(Array.from({ length: 12 }, (_, index) => memory.loadThumbnail(`/image-${index}`)));
  assert.ok(maximum <= 4, 'Thumbnail concurrency is bounded.');
  await Promise.all(Array.from({ length: 165 }, (_, index) => memory.loadThumbnail(`/bounded-${index}`)));
  assert.equal(memory.thumbnail('/bounded-0'), undefined); assert.ok(memory.thumbnail('/bounded-164'));
  memory.albumPositions.set('album', { section: 'section', y: 800 });
  memory.invalidate('access');
  assert.equal(memory.thumbnail('/same'), undefined); assert.equal(memory.albumPositions.size, 0);
  assert.notEqual(await memory.loadThumbnail('/same'), urls[0], 'Revoked blobs are never reused.');
  memory.setIdentity('another-workspace'); assert.equal(memory.thumbnail('/same'), undefined);
  let releaseBlob;
  globalThis.fetch = () => new Promise(resolve => { releaseBlob = resolve; });
  const oldBlob = memory.loadThumbnail('/blocked'); memory.invalidate('access');
  releaseBlob(new Response(new Blob(['old private bytes'], { type: 'image/jpeg' })));
  await assert.rejects(oldBlob, { name: 'AbortError' }); assert.equal(memory.thumbnail('/blocked'), undefined);
  console.log('PASS: read deduplication, mutation races, authoritative invalidation, TTL/LRU, thumbnail reuse/concurrency and identity/access clearing.');
} finally { memory.invalidate('access'); globalThis.fetch = originalFetch; }
