import assert from 'node:assert/strict';
import { inspectAuth0Recovery, providerOrigin } from '../scripts/check-auth0-recovery.mjs';

const now = Date.parse('2026-09-21T08:00:00Z');
const reset = now - 60000;
const credentials = { clientId: 'monitor', clientSecret: 'private-secret' };
const person = { subject: 'auth0|private-person', credentials_changed_at: reset, delivered_changed_at: reset };
const requests = [];
let logs = [];
let profile = { user_id: person.subject, last_password_reset: new Date(reset).toISOString() };
// Mock the actual protocol boundaries and inspect each outgoing request without reaching a provider.
const request = async (url, options) => {
  requests.push({ url, options });
  assert.equal(new URL(url).origin, providerOrigin);
  assert.equal(options.redirect, 'error');
  if (url.endsWith('/oauth/token')) {
    const body = JSON.parse(options.body);
    assert.equal(body.scope, 'read:logs read:users');
    assert.equal(body.audience, `${providerOrigin}/api/v2/`);
    return Response.json({ access_token: 'private-token', token_type: 'Bearer' });
  }
  assert.equal(options.headers.Authorization, 'Bearer private-token');
  if (url.includes('/logs?')) {
    assert.equal(new URL(url).searchParams.get('fields'), 'type,date');
    assert.match(new URL(url).searchParams.get('q'), /actions_execution_failed OR fcp OR fcpr/);
    return Response.json(logs);
  }
  assert.match(url, /users\/auth0%7Cprivate-person\?/);
  assert.equal(new URL(url).searchParams.get('include_fields'), 'false');
  assert.match(new URL(url).searchParams.get('fields'), /identities,app_metadata,user_metadata/);
  assert.ok(!new URL(url).searchParams.get('fields').includes('last_password_reset'));
  return Response.json(profile);
};
assert.deepEqual(await inspectAuth0Recovery([person], credentials, request, now), []);
assert.equal(requests.length, 3);
assert.equal((await inspectAuth0Recovery([{ ...person, delivered_changed_at: 0 }], credentials, request, now)).length, 1);
assert.equal((await inspectAuth0Recovery([{ ...person, credentials_changed_at: 0 }], credentials, request, now)).length, 1);
logs = [{ type: 'actions_execution_failed', date: new Date(now - 1000).toISOString() }];
profile.blocked = true;
assert.equal((await inspectAuth0Recovery([person], credentials, request, now)).length, 2);
assert.doesNotMatch(JSON.stringify(await inspectAuth0Recovery([person], credentials, request, now)), /private-person|private-token|private-secret/);
profile.user_id = 'different-person';
await assert.rejects(inspectAuth0Recovery([person], credentials, request, now), /unexpected identity/);
profile = { user_id: person.subject, last_password_reset: new Date(now + 10000).toISOString() };
await assert.rejects(inspectAuth0Recovery([person], credentials, request, now), /time needs operator review/);
profile.last_password_reset = 'invalid';
await assert.rejects(inspectAuth0Recovery([person], credentials, request, now), /time needs operator review/);
profile = { user_id: person.subject };
logs = [];
assert.deepEqual(await inspectAuth0Recovery([{ ...person, credentials_changed_at: 0, delivered_changed_at: 0 }], credentials, request, now), []);
await assert.rejects(inspectAuth0Recovery(Array(201).fill(person), credentials, request, now), /capacity/);
await assert.rejects(inspectAuth0Recovery([person], {}, request, now), /credential is missing/);
await assert.rejects(inspectAuth0Recovery([person], credentials, async () => { throw new Error('private-secret'); }, now),
  error => /could not complete/.test(error.message) && !error.message.includes('private-secret'));
await assert.rejects(inspectAuth0Recovery([person], credentials, async () => new Response('private-error', {status:429}), now), /request was rejected/);
await assert.rejects(inspectAuth0Recovery([person], credentials, async () => new Response('x'.repeat(128*1024+1)), now), /safe bound/);
console.log('PASS: provider reconciliation, minimal scopes/fields, pinned destinations, reset mismatches, capacity and redacted errors.');
