import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const origin = process.env.RELAY_TEST_ORIGIN || 'http://localhost:5173';
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname)) throw new Error('Rate-limit stress probes run locally only.');
const headers = { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': `test-${randomUUID()}` };
const home = await fetch(origin);
assert.equal(home.headers.get('x-frame-options'), 'DENY');
assert.match(home.headers.get('content-security-policy'), /frame-ancestors 'none'/);
assert.ok([403, 404].includes((await fetch(`${origin}/_next/image?url=https://example.com/photo.png&w=640&q=75`)).status));
assert.equal((await fetch(origin, { method: 'POST', headers, body: '{}' })).status, 405);
const unauthenticated = await fetch(`${origin}/api/feed`);
assert.equal(unauthenticated.status, 401);
assert.equal(unauthenticated.headers.get('x-content-type-options'), 'nosniff');
assert.ok(unauthenticated.headers.get('x-request-id'));
assert.equal((await fetch(`${origin}/api/feed?q=${'x'.repeat(2050)}`)).status, 400);
assert.equal((await fetch(`${origin}/api/connect`, { method: 'POST', headers, body: 'x'.repeat(1024 * 1024 + 1) })).status, 413);
let limited = false;
for (let attempt = 0; attempt < 40; attempt++) {
  const response = await fetch(`${origin}/api/connect`, { method: 'POST', headers, body: JSON.stringify({ name: 'Rate limit fixture', invitation: 'f'.repeat(64) }) });
  if (response.status === 429) { assert.equal(response.headers.get('retry-after'), '60'); limited = true; break; }
  assert.equal(response.status, 410);
}
assert.ok(limited, 'Pairing rate limiter must reject sustained requests');
console.log('PASS: security headers, unused endpoint protection, private errors, bounded requests, enforced pairing limit and Retry-After.');
