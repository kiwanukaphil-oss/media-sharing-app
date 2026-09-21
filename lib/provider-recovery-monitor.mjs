import { MonitorResponseLimitError, readBoundedMonitorJson } from './monitor-json.mjs';

export const providerOrigin = 'https://dev-q1z0b44pcvdxwni6.us.auth0.com';
// Auth0 rejects last_password_reset in its inclusion allowlist; exclude unrelated supported fields instead.
const excludedProfileFields = 'phone_number,email,email_verified,picture,username,name,nickname,created_at,identities,app_metadata,user_metadata,last_ip,last_login,logins_count,updated_at,family_name,given_name';
export const recoveryPeopleQuery = `SELECT p.subject, p.credentials_changed_at,
  COALESCE(w.changed_at,0) AS delivered_changed_at FROM people p
  LEFT JOIN recovery_watermarks w ON w.issuer=p.issuer AND w.subject=p.subject
  WHERE p.issuer='${providerOrigin}/' AND p.disabled_at IS NULL ORDER BY p.id LIMIT 201`;
export class RecoveryMonitorError extends Error {}
const fail = message => { throw new RecoveryMonitorError(message); };

// Network and provider payload errors never propagate URLs, tokens, identities or response bodies into CI logs.
async function readProviderJson(request, path, options) {
  let response;
  try {
    response = await request(`${providerOrigin}${path}`, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000) });
  } catch { fail('Auth0 monitoring request could not complete.'); }
  const stage = path === '/oauth/token' ? 'token' : path.startsWith('/api/v2/logs?') ? 'logs' : 'profile';
  if (!response.ok) fail(`Auth0 monitoring request was rejected (${stage}, HTTP ${response.status}); review credentials, rate limits or provider availability.`);
  try {
    return await readBoundedMonitorJson(response);
  } catch (error) {
    if (error instanceof MonitorResponseLimitError) fail('Auth0 monitoring response exceeded its safe bound.');
    if (error instanceof RecoveryMonitorError) throw error;
    fail('Auth0 monitoring response could not be read.');
  }
}

// Limit reconciliation to existing active Relay identities, never infer memberships or import new people.
export async function inspectAuth0Recovery(people, credentials, request = fetch, now = Date.now()) {
  if (!Array.isArray(people) || people.length > 200 || people.some(person =>
    typeof person.subject !== 'string' || !person.subject || person.subject.length > 255 ||
    !Number.isSafeInteger(person.credentials_changed_at) || person.credentials_changed_at < 0 ||
    !Number.isSafeInteger(person.delivered_changed_at) || person.delivered_changed_at < 0)) fail('Recovery monitoring inventory is incomplete or exceeds the reviewed capacity.');
  if (!credentials.clientId || !credentials.clientSecret) fail('Dedicated Auth0 read-only monitoring credential is missing.');
  const token = await readProviderJson(request, '/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: credentials.clientId,
      client_secret: credentials.clientSecret, audience: `${providerOrigin}/api/v2/`, scope: 'read:logs read:users' }) });
  if (typeof token.access_token !== 'string' || !token.access_token || token.token_type?.toLowerCase() !== 'bearer') fail('Auth0 monitoring token response is invalid.');
  const options = { headers: { Authorization: `Bearer ${token.access_token}` } };
  const since = new Date(now - 20 * 60 * 60 * 1000).toISOString();
  const logsQuery = new URLSearchParams({ q: `date:[${since} TO *] AND type:(actions_execution_failed OR fcp OR fcpr)`,
    fields: 'type,date', include_fields: 'true', per_page: '1', sort: 'date:-1' });
  const logs = await readProviderJson(request, `/api/v2/logs?${logsQuery}`, options);
  if (!Array.isArray(logs) || logs.some(log => !['actions_execution_failed', 'fcp', 'fcpr'].includes(log.type) || !Number.isFinite(Date.parse(log.date)))) fail('Auth0 failure-log response is invalid.');
  const issues = new Set();
  if (logs.length) issues.add('Auth0 reports an Action or password-recovery failure in the review window; inspect tenant logs privately.');
  for (const person of people) {
    const fields = new URLSearchParams({ fields: excludedProfileFields, include_fields: 'false' });
    const { user_id, last_password_reset, blocked } = await readProviderJson(request, `/api/v2/users/${encodeURIComponent(person.subject)}?${fields}`, options);
    const profile = { user_id, last_password_reset, blocked };
    if (profile?.user_id !== person.subject) fail('Auth0 returned an unexpected identity.');
    if (profile.blocked === true) issues.add('An active Relay identity is blocked at Auth0; review access privately.');
    const changedAt = profile.last_password_reset === undefined ? 0 : Date.parse(profile.last_password_reset);
    if (!Number.isSafeInteger(changedAt) || changedAt < 0 || changedAt > now) fail('Provider password-change time needs operator review.');
    if (changedAt > person.credentials_changed_at || changedAt > person.delivered_changed_at) {
      issues.add('A provider password change is newer than Relay recovery evidence; reconcile before treating account recovery as healthy.');
    }
  }
  return [...issues];
}

