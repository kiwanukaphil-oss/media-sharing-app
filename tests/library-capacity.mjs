import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';

// Seed metadata only in disposable D1; original-byte integrity is covered by the transfer suites.
export async function verifyLibraryCapacity(database, origin) {
  assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
  const clients = [];
  const now = Date.now();
  for (let spaceNumber = 0; spaceNumber < 4; spaceNumber++) {
    const spaceId = randomUUID();
    await database.prepare('INSERT INTO spaces (id,name,created_at) VALUES (?,?,?)').bind(spaceId, 'Capacity fixture', now).run();
    let uploaderId;
    for (let number = 0; number < 3; number++) {
      const token = randomBytes(32).toString('hex');
      const id = randomUUID(); uploaderId ||= id;
      await database.prepare('INSERT INTO devices (id,space_id,name,token_hash,role,created_at,expires_at) VALUES (?,?,?,?,?,?,?)')
        .bind(id, spaceId, 'Capacity device', createHash('sha256').update(token).digest('hex'), number ? 'member' : 'owner', now, now + 600000).run();
      clients.push({ cookie: `relay_device=${token}`, spaceId });
    }
    for (let offset = 0; offset < 1000; offset += 25) {
      const inserts = [];
      for (let number = offset; number < offset + 25; number++) {
        const id = randomUUID();
        inserts.push(database.prepare(`INSERT INTO media (id,space_id,device_id,name,mime,size,sha256,category,object_key,upload_id,part_size,status,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, spaceId, uploaderId, `capacity-${String(number).padStart(4, '0')}.raw`,
          'application/octet-stream', 1024, '0'.repeat(64), number % 2 ? 'final' : 'original', `${spaceId}/${id}`, 'metadata-fixture', 16777216, 'ready', now - number));
      }
      await database.batch(inserts);
    }
    console.log(`Prepared capacity space ${spaceNumber + 1}/4 with 1,000 metadata records.`);
  }
  const durations = [];
  await Promise.all(clients.map(async client => {
    let cursor;
    for (let request = 0; request < 10; request++) {
      const query = request % 3 === 0 ? 'q=capacity-0999' : cursor ? `cursor=${encodeURIComponent(cursor)}` : '';
      const start = performance.now();
      const response = await fetch(`${origin}/api/feed?${query}`, { headers: { Cookie: client.cookie }, signal: AbortSignal.timeout(15000) });
      assert.equal(response.status, 200);
      const page = await response.json();
      assert.equal(page.counts.all, 1000);
      assert.equal(page.total, request % 3 === 0 ? 1 : 1000);
      assert.equal(page.items.length, request % 3 === 0 ? 1 : 48);
      if (request % 3 !== 0) cursor = page.nextCursor;
      durations.push(performance.now() - start);
    }
  }));
  durations.sort((left, right) => left - right);
  console.log(`PASS local metadata capacity: 4 spaces × 1,000 files, 12 concurrent devices, ${durations.length} search/paged-feed requests, zero errors; p50 ${Math.round(durations[Math.floor(durations.length * .5)])} ms, p95 ${Math.round(durations[Math.floor(durations.length * .95)])} ms. Not a hosted capacity guarantee.`);
}
