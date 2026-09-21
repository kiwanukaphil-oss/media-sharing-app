// Auth0 runs this asynchronously: failure must be observable and must never be described as synchronous revocation.
// Await bounded delivery attempts; the signed Post Login claim also reconciles missed resets on the next sign-in.
exports.onExecutePostChangePassword = async (event) => {
  const crypto = require('node:crypto');
  const secret = event.secrets.RELAY_RECOVERY_SECRET;
  const issuer = event.secrets.RELAY_ISSUER;
  const origin = event.secrets.RELAY_ORIGIN;
  const changedAt = Date.parse(event.user.last_password_reset);
  if (!/^[a-f0-9]{64}$/.test(secret || '') || !/^https:\/\/[a-z0-9.-]+\.auth0\.com\/$/.test(issuer || '') ||
      origin !== 'https://relayalbums.com' || !Number.isSafeInteger(changedAt) || changedAt <= 0 || changedAt > Date.now()) {
    throw new Error('Relay recovery configuration is invalid.');
  }
  const body = JSON.stringify({ issuer, subject: event.user.user_id, changedAt });
  for (let attempt = 0; attempt < 2; attempt++) {
    const timestamp = String(Date.now());
    const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
    try {
      const response = await fetch(`${origin}/api/auth/recovery-event`, { method: 'POST', redirect: 'error',
        headers: { 'Content-Type': 'application/json', 'X-Relay-Recovery-Time': timestamp, 'X-Relay-Recovery-Signature': signature },
        body, signal: AbortSignal.timeout(4000) });
      await response.body?.cancel();
      if (response.status === 204) return;
    } catch { /* Retry without logging credentials, identity, request body or provider errors. */ }
  }
  throw new Error('Relay recovery delivery failed. Operator reconciliation required.');
};
