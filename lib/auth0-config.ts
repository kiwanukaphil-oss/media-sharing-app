export type Auth0Settings = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  appOrigin: string;
  callbackUrl: string;
};

// Incomplete configuration must never enable account sign-in or alter legacy device access.
export function readAuth0Settings(environment: Record<string, string | undefined>, allowLocalOrigin = false): Auth0Settings | null {
  if (environment.AUTH0_ENABLED !== "true") return null;
  const domain = environment.AUTH0_DOMAIN?.trim();
  const clientId = environment.AUTH0_CLIENT_ID?.trim();
  const clientSecret = environment.AUTH0_CLIENT_SECRET;
  if (!domain || !clientId || !clientSecret || !environment.RELAY_APP_ORIGIN) throw new Error("Auth0 configuration is incomplete.");
  // Start with the provider-owned tenant domain; custom domains require a separate issuer review.
  if (domain.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+auth0\.com$/i.test(domain)) throw new Error("Use the Auth0 tenant domain without a URL path.");
  const app = new URL(environment.RELAY_APP_ORIGIN);
  const local = allowLocalOrigin && ["localhost", "127.0.0.1", "[::1]"].includes(app.hostname);
  if ((app.protocol !== "https:" && !(local && app.protocol === "http:")) || app.username || app.password || app.pathname !== "/" || app.search || app.hash) {
    throw new Error("Relay must have a fixed HTTPS application origin.");
  }
  return { issuer: `https://${domain.toLowerCase()}/`, clientId, clientSecret, appOrigin: app.origin, callbackUrl: `${app.origin}/api/auth/callback` };
}

// Dashboard setup contains only public URLs, never a client secret or a user identity.
export function auth0ApplicationSetup(appOrigin: string) {
  const app = new URL(appOrigin);
  if (app.protocol !== "https:" || app.origin !== appOrigin) throw new Error("Use the exact production HTTPS origin without a trailing slash.");
  return { name: "Relay Web", applicationType: "Regular Web Application", tokenEndpointAuthenticationMethod: "POST",
    allowedCallbackUrls: [`${app.origin}/api/auth/callback`], allowedLogoutUrls: [`${app.origin}/`],
    applicationLoginUri: `${app.origin}/api/auth/login`, signingAlgorithm: "RS256" };
}
