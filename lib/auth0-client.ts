import * as oidc from "openid-client";
import type { Auth0Settings } from "./auth0-config";
import type { AccountSessionMode } from "./account-session-policy";

export const AUTH0_TRANSACTION_LIFETIME_MS = 10 * 60 * 1000;
export type Auth0LoginTransaction = {
  state: string; nonce: string; verifier: string; browserBinding: string; expiresAt: number; sessionMode?: AccountSessionMode;
};
export type VerifiedAuth0Identity = { issuer: string; subject: string; displayName: string; verifiedEmail: string | null; providerSessionId?: string };

// Use the maintained OIDC implementation and require signed ID tokens as well as TLS, issuer and audience checks.
export async function discoverAuth0Client(settings: Auth0Settings, transport?: oidc.CustomFetch) {
  const configuration = await oidc.discovery(new URL(settings.issuer), settings.clientId, {
    client_secret: settings.clientSecret, id_token_signed_response_alg: "RS256",
  }, oidc.ClientSecretPost(settings.clientSecret), {
    timeout: 10, execute: [oidc.enableNonRepudiationChecks], ...(transport ? { [oidc.customFetch]: transport } : {}),
  });
  // Do not send credentials to a different host advertised by compromised or incorrect discovery metadata.
  const metadata = configuration.serverMetadata();
  for (const endpoint of [metadata.authorization_endpoint, metadata.token_endpoint, metadata.jwks_uri]) {
    if (!endpoint || new URL(endpoint).origin !== new URL(settings.issuer).origin || new URL(endpoint).username || new URL(endpoint).password) {
      throw new Error("Auth0 discovery returned an unexpected endpoint.");
    }
  }
  return configuration;
}

// The route must persist this transaction server-side and bind its random browser value to an HttpOnly cookie.
export async function prepareAuth0Login(settings: Auth0Settings, configuration: oidc.Configuration, now = Date.now()) {
  const transaction: Auth0LoginTransaction = {
    state: oidc.randomState(), nonce: oidc.randomNonce(), verifier: oidc.randomPKCECodeVerifier(),
    browserBinding: oidc.randomState(), expiresAt: now + AUTH0_TRANSACTION_LIFETIME_MS,
  };
  const url = oidc.buildAuthorizationUrl(configuration, {
    redirect_uri: settings.callbackUrl, scope: "openid profile email", response_type: "code", response_mode: "query", prompt: "login", max_age: "0",
    state: transaction.state, nonce: transaction.nonce, code_challenge_method: "S256",
    code_challenge: await oidc.calculatePKCECodeChallenge(transaction.verifier),
  });
  return { url: url.href, transaction };
}

// Call only with an atomically consumed server-side transaction; tokens never grant Relay workspace membership.
export async function completeAuth0Login(settings: Auth0Settings, configuration: oidc.Configuration, callbackUrl: URL,
  transaction: Auth0LoginTransaction, browserBinding: string, now = Date.now()): Promise<VerifiedAuth0Identity> {
  const destination = new URL(settings.callbackUrl);
  if (callbackUrl.origin !== destination.origin || callbackUrl.pathname !== destination.pathname || callbackUrl.hash || callbackUrl.username || callbackUrl.password) {
    throw new Error("The sign-in callback address is invalid.");
  }
  if (!transaction.browserBinding || browserBinding !== transaction.browserBinding || !transaction.state || !transaction.nonce || !transaction.verifier ||
      !Number.isFinite(transaction.expiresAt) || transaction.expiresAt <= now || transaction.expiresAt > now + AUTH0_TRANSACTION_LIFETIME_MS) {
    throw new Error("This sign-in attempt expired or belongs to another browser. Start again.");
  }
  const tokens = await oidc.authorizationCodeGrant(configuration, callbackUrl, {
    pkceCodeVerifier: transaction.verifier, expectedState: transaction.state, expectedNonce: transaction.nonce, idTokenExpected: true, maxAge: 0,
  });
  const claims = tokens.claims();
  if (!claims || typeof claims.sub !== "string" || !claims.sub || claims.iss !== settings.issuer) throw new Error("A verified account identity was not returned.");
  // Never return access/refresh/ID tokens to the browser or use email equality to merge accounts.
  return { issuer: claims.iss, subject: claims.sub,
    displayName: typeof claims.name === "string" ? claims.name.slice(0, 100) : "Relay account",
    verifiedEmail: claims.email_verified === true && typeof claims.email === "string" ? claims.email : null,
    ...(typeof claims.sid === "string" && claims.sid.length > 0 && claims.sid.length <= 512 ? { providerSessionId: claims.sid } : {}) };
}
