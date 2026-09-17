import assert from 'node:assert/strict';

const origin = process.env.RELAY_TEST_ORIGIN || 'https://relay-media-exchange.kiwanukaphil.workers.dev';
// Public probes check dependencies and fail closed; responses never expose credentials or media metadata.
async function probeProduction() {
  const home = await fetch(origin, { signal: AbortSignal.timeout(15000) });
  assert.equal(home.status, 200, 'App entry point unavailable');
  assert.equal(home.headers.get('x-frame-options'), 'DENY');
  const health = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(15000) });
  assert.equal(health.status, 200, 'Database/storage health probe failed');
  assert.equal((await health.json()).status, 'ok');
  assert.equal(health.headers.get('cache-control'), 'no-store');
  const privateFeed = await fetch(`${origin}/api/feed`, { signal: AbortSignal.timeout(15000) });
  assert.equal(privateFeed.status, 401, 'Anonymous feed protection failed');
}
for (let attempt = 1; attempt <= 3; attempt++) {
  try { await probeProduction(); console.log('PASS: production entry, headers, database/storage readiness, private feed.'); break; }
  catch (error) {
    if (attempt === 3) { console.error(`Production probe failed: ${error.message}`); process.exitCode = 1; }
    else await new Promise(resolve => setTimeout(resolve, 2000));
  }
}
