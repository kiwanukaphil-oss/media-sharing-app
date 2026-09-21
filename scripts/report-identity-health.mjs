import { createHmac } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Success requires both checks from this job; cancellation, skipped steps and missing outcomes report failure.
export async function reportIdentityHealth(environment = process.env, request = fetch, now = Date.now()) {
  const secret = environment.RELAY_MONITOR_SECRET;
  if (!/^[a-f0-9]{64}$/.test(secret || '')) throw new Error('Dedicated monitoring report credential is missing.');
  const status = environment.IDENTITY_CHECK_OUTCOME === 'success' && environment.PROVIDER_CHECK_OUTCOME === 'success' ? 'success' : 'failure';
  const body = JSON.stringify({ status });
  const timestamp = String(now);
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  let response;
  try {
    response = await request('https://relayalbums.com/api/operations/health', { method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json', 'X-Relay-Monitor-Time': timestamp, 'X-Relay-Monitor-Signature': signature },
      body, signal: AbortSignal.timeout(15000) });
  } catch { throw new Error('Could not deliver identity monitoring status.'); }
  if (response.status !== 204) throw new Error(`Identity monitoring status was rejected (HTTP ${response.status}).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await reportIdentityHealth(); console.log('Identity monitoring status recorded.'); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
