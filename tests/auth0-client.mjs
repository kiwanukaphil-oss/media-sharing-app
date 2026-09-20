import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { build } from 'esbuild';

const compile = async path => {
  const result = await build({ entryPoints: [path], bundle: true, platform: 'node', format: 'esm', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
};
const { readAuth0Settings, auth0ApplicationSetup } = await compile('lib/auth0-config.ts');
const { discoverAuth0Client, prepareAuth0Login, completeAuth0Login, AUTH0_TRANSACTION_LIFETIME_MS } = await compile('lib/auth0-client.ts');
const environment = { AUTH0_ENABLED: 'true', AUTH0_DOMAIN: 'relay-test.eu.auth0.com', AUTH0_CLIENT_ID: 'fixture-client',
  AUTH0_CLIENT_SECRET: 'test-only-client-secret', RELAY_APP_ORIGIN: 'https://relay.example' };
const settings = readAuth0Settings(environment);
assert.equal(readAuth0Settings({}), null);
assert.equal(readAuth0Settings({ AUTH0_ENABLED: 'false' }), null);
assert.throws(() => readAuth0Settings({ AUTH0_ENABLED: 'true' }), /incomplete/);
for (const domain of ['https://tenant.auth0.com', 'tenant.auth0.com/elsewhere', 'tenant.auth0.com.evil.example', 'localhost', 'user@tenant.auth0.com']) {
  assert.throws(() => readAuth0Settings({ ...environment, AUTH0_DOMAIN: domain }));
}
for (const origin of ['http://relay.example', 'https://relay.example/path', 'https://user:secret@relay.example', 'https://relay.example/?next=elsewhere']) {
  assert.throws(() => readAuth0Settings({ ...environment, RELAY_APP_ORIGIN: origin }));
}
assert.throws(() => readAuth0Settings({ ...environment, RELAY_APP_ORIGIN: 'http://localhost:8794' }));
assert.equal(readAuth0Settings({ ...environment, RELAY_APP_ORIGIN: 'http://localhost:8794' }, true).callbackUrl, 'http://localhost:8794/api/auth/callback');
assert.deepEqual(auth0ApplicationSetup('https://relay.example').allowedCallbackUrls, ['https://relay.example/api/auth/callback']);

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const secondSigner = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'fixture-key', alg: 'RS256', use: 'sig' };
let activeTransaction;
let claimOverrides = {};
let signingKey = privateKey;
let tokenRequests = 0;
let omitIdToken = false;
let endpointOverride = null;
const usedCodes = new Set();

// Mock only the transport: the real OIDC library verifies real RSA signatures and protocol claims.
async function providerTransport(input, options) {
  const url = new URL(String(input));
  assert.equal(url.origin, new URL(settings.issuer).origin, 'No request may escape the pinned provider.');
  if (url.pathname === '/.well-known/openid-configuration') return Response.json({
    issuer: settings.issuer, authorization_endpoint: `${settings.issuer}authorize`, token_endpoint: endpointOverride || `${settings.issuer}oauth/token`,
    jwks_uri: `${settings.issuer}.well-known/jwks.json`, response_types_supported: ['code'], subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'], token_endpoint_auth_methods_supported: ['client_secret_post'], code_challenge_methods_supported: ['S256'],
  });
  if (url.pathname === '/.well-known/jwks.json') return Response.json({ keys: [jwk] });
  assert.equal(url.pathname, '/oauth/token');
  tokenRequests++;
  const body = new URLSearchParams(String(options.body));
  assert.equal(body.get('client_id'), settings.clientId);
  assert.equal(body.get('client_secret'), settings.clientSecret);
  assert.equal(body.get('redirect_uri'), settings.callbackUrl);
  assert.equal(body.get('code_verifier'), activeTransaction.verifier);
  const code = body.get('code');
  if (usedCodes.has(code)) return Response.json({ error: 'invalid_grant' }, { status: 400 });
  usedCodes.add(code);
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: settings.issuer, aud: settings.clientId, sub: 'auth0|fixture-person', iat: now, exp: now + 300,
    nonce: activeTransaction.nonce, name: 'Test Person', email: 'person@example.test', email_verified: true, ...claimOverrides };
  const encoded = `${Buffer.from(JSON.stringify({ alg: 'RS256', kid: jwk.kid })).toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
  const idToken = `${encoded}.${sign('RSA-SHA256', Buffer.from(encoded), signingKey).toString('base64url')}`;
  return Response.json({ access_token: 'test-access-token-never-returned', token_type: 'Bearer', expires_in: 300, ...(omitIdToken ? {} : { id_token: idToken }) });
}

const client = await discoverAuth0Client(settings, providerTransport);
const first = await prepareAuth0Login(settings, client);
const second = await prepareAuth0Login(settings, client);
assert.notEqual(first.transaction.state, second.transaction.state);
assert.notEqual(first.transaction.nonce, second.transaction.nonce);
assert.notEqual(first.transaction.verifier, second.transaction.verifier);
assert.notEqual(first.transaction.browserBinding, second.transaction.browserBinding);
const authorization = new URL(first.url);
assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
assert.equal(authorization.searchParams.get('redirect_uri'), settings.callbackUrl);
assert.equal(authorization.searchParams.get('scope'), 'openid profile email');
assert.ok(!first.url.includes(settings.clientSecret));
assert.ok(!first.url.includes(first.transaction.verifier));
assert.ok(!first.url.includes(first.transaction.browserBinding));
activeTransaction = first.transaction;
let codeCounter = 0;
const callback = () => new URL(`${settings.callbackUrl}?code=fixture-${++codeCounter}&state=${activeTransaction.state}`);
const verified = await completeAuth0Login(settings, client, callback(), activeTransaction, activeTransaction.browserBinding);
assert.deepEqual(verified, { issuer: settings.issuer, subject: 'auth0|fixture-person', displayName: 'Test Person', verifiedEmail: 'person@example.test' });
assert.ok(!JSON.stringify(verified).includes('token'));
for (const claims of [{ iss: 'https://other.auth0.com/' }, { aud: 'other-client' }, { exp: 1 }, { nonce: 'wrong-nonce' }, { sub: '' }]) {
  claimOverrides = claims;
  await assert.rejects(completeAuth0Login(settings, client, callback(), activeTransaction, activeTransaction.browserBinding));
}
claimOverrides = { email_verified: false };
assert.equal((await completeAuth0Login(settings, client, callback(), activeTransaction, activeTransaction.browserBinding)).verifiedEmail, null);
claimOverrides = {};
signingKey = secondSigner.privateKey;
await assert.rejects(completeAuth0Login(settings, client, callback(), activeTransaction, activeTransaction.browserBinding));
signingKey = privateKey;
omitIdToken = true;
await assert.rejects(completeAuth0Login(settings, client, callback(), activeTransaction, activeTransaction.browserBinding));
omitIdToken = false;
const beforeInvalid = tokenRequests;
await assert.rejects(completeAuth0Login(settings, client, callback(), activeTransaction, 'another-browser'));
await assert.rejects(completeAuth0Login(settings, client, callback(), { ...activeTransaction, expiresAt: Date.now() - 1 }, activeTransaction.browserBinding));
await assert.rejects(completeAuth0Login(settings, client, callback(), { ...activeTransaction, expiresAt: Date.now() + AUTH0_TRANSACTION_LIFETIME_MS * 2 }, activeTransaction.browserBinding));
await assert.rejects(completeAuth0Login(settings, client, new URL('https://evil.example/api/auth/callback'), activeTransaction, activeTransaction.browserBinding));
await assert.rejects(completeAuth0Login(settings, client, new URL(`${settings.callbackUrl}?code=wrong-state&state=wrong`), activeTransaction, activeTransaction.browserBinding));
assert.equal(tokenRequests, beforeInvalid, 'Invalid browser, state, expiry or destination must fail before code exchange.');
const replayed = callback();
await completeAuth0Login(settings, client, replayed, activeTransaction, activeTransaction.browserBinding);
await assert.rejects(completeAuth0Login(settings, client, replayed, activeTransaction, activeTransaction.browserBinding));
endpointOverride = 'https://evil.example/oauth/token';
await assert.rejects(discoverAuth0Client(settings, providerTransport), /unexpected endpoint/);
console.log('PASS: disabled configuration, pinned origins, PKCE/state/nonce, browser binding, expiry, real signature/issuer/audience checks, unverified-email handling and provider code-replay rejection.');
console.log('Account/session routes still require end-to-end integration tests before activation; D1 transaction tests run in the API integration suite.');
