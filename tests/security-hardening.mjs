import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

// Run real Worker security boundaries directly in CI; standalone execution can still probe HTTP.
export async function verifySecurityHardening(origin, dispatch = fetch) {
  if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname)) throw new Error('Rate-limit stress probes run locally only.');
  const headers = { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': `test-${randomUUID()}` };
  // Consume every response. The CI dispatcher avoids the Windows HTTP reset on rejected upload bodies.
  // All real Worker status, size and rate-limit assertions remain strict, without retries.
  async function probeSecurityRoute(url, options = {}) {
    const response = await dispatch(url, { ...options, signal: AbortSignal.timeout(15000) });
    await response.arrayBuffer();
    return response;
  }
  const home = await probeSecurityRoute(origin);
  assert.equal(home.headers.get('x-frame-options'), 'DENY');
  assert.match(home.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.ok([403, 404].includes((await probeSecurityRoute(`${origin}/_next/image?url=https://example.com/photo.png&w=640&q=75`)).status));
  assert.equal((await probeSecurityRoute(origin, { method: 'POST', headers, body: '{}' })).status, 405);
  const unauthenticated = await probeSecurityRoute(`${origin}/api/feed`);
  assert.equal(unauthenticated.status, 401);
  assert.equal(unauthenticated.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(unauthenticated.headers.get('x-request-id'));
  assert.equal((await probeSecurityRoute(`${origin}/api/feed?q=${'x'.repeat(2050)}`)).status, 400);
  assert.equal((await probeSecurityRoute(`${origin}/api/connect`, { method: 'POST', headers, body: 'x'.repeat(1024 * 1024 + 1) })).status, 413);
  let limited = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    const response = await probeSecurityRoute(`${origin}/api/connect`, { method: 'POST', headers, body: JSON.stringify({ name: 'Rate limit fixture', invitation: 'f'.repeat(64) }) });
    if (response.status === 429) { assert.equal(response.headers.get('retry-after'), '60'); limited = true; break; }
    assert.equal(response.status, 410);
  }
  assert.ok(limited, 'Pairing rate limiter must reject sustained requests');
  console.log('PASS: security headers, unused endpoint protection, private errors, bounded requests, enforced pairing limit and Retry-After.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await verifySecurityHardening(process.env.RELAY_TEST_ORIGIN || 'http://localhost:5173');
}
