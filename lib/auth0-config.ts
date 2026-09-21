export type Auth0Settings = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  appOrigin: string;
  callbackUrl: string;
  allowedSubjects?: string[];
};

// Incomplete configuration must never enable account sign-in or alter legacy device access.
export function readAuth0Settings(environment: Record<string, string | undefined>, allowLocalOrigin = false): Auth0Settings | null {
  if (environment.AUTH0_ENABLED !== "true") return null;
  const domain = environment.AUTH0_DOMAIN?.trim();
  const clientId = environment.AUTH0_CLIENT_ID?.trim();
  const clientSecret = environment.AUTH0_CLIENT_SECRET;
  if (!domain || !clientId || !clientSecret || !environment.RELAY_APP_ORIGIN) throw new Error("Auth0 configuration is incomplete.");
  const allowedSubjects = readPilotSubjects(environment);
  // Start with the provider-owned tenant domain; custom domains require a separate issuer review.
  if (domain.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+auth0\.com$/i.test(domain)) throw new Error("Use the Auth0 tenant domain without a URL path.");
  const app = new URL(environment.RELAY_APP_ORIGIN);
  const local = allowLocalOrigin && ["localhost", "127.0.0.1", "[::1]"].includes(app.hostname);
  if ((app.protocol !== "https:" && !(local && app.protocol === "http:")) || app.username || app.password || app.pathname !== "/" || app.search || app.hash) {
    throw new Error("Relay must have a fixed HTTPS application origin.");
  }
  return { issuer: `https://${domain.toLowerCase()}/`, clientId, clientSecret, appOrigin: app.origin, callbackUrl: `${app.origin}/api/auth/callback`,
    ...(allowedSubjects ? { allowedSubjects } : {}) };
}

// Public activation must be explicit; pilot identities belong in a private Worker binding, never public config.
function readPilotSubjects(environment: Record<string, string | undefined>): string[] | undefined {
  if (environment.AUTH0_ROLLOUT === "open") return undefined;
  if (environment.AUTH0_ROLLOUT !== "pilot") throw new Error("Choose an explicit Auth0 rollout mode.");
  let subjects: unknown;
  try { subjects = JSON.parse(environment.AUTH0_PILOT_SUBJECTS || "null"); } catch { /* Fail closed without echoing the binding. */ }
  if (!Array.isArray(subjects) || subjects.length < 1 || subjects.length > 10 ||
      subjects.some(subject => typeof subject !== "string" || !subject || subject.length > 255 || /\s/.test(subject))) {
    throw new Error("Auth0 pilot configuration is incomplete.");
  }
  return [...new Set(subjects as string[])].sort();
}

export function permitsAuth0Subject(settings: Auth0Settings, subject: string) {
  return settings.allowedSubjects === undefined || settings.allowedSubjects.includes(subject);
}

// Canonical binding invalidates sessions and pending callbacks whenever the permitted pilot audience changes.
export function auth0AudienceBinding(settings: Auth0Settings) {
  return settings.allowedSubjects === undefined ? [] : [[...new Set(settings.allowedSubjects)].sort()];
}

// Dashboard setup contains only public URLs, never a client secret or a user identity.
export function auth0ApplicationSetup(appOrigin: string) {
  const app = new URL(appOrigin);
  if (app.protocol !== "https:" || app.origin !== appOrigin) throw new Error("Use the exact production HTTPS origin without a trailing slash.");
  return { name: "Relay Web", applicationType: "Regular Web Application", tokenEndpointAuthenticationMethod: "POST",
    allowedCallbackUrls: [`${app.origin}/api/auth/callback`], allowedLogoutUrls: [`${app.origin}/`],
    applicationLoginUri: `${app.origin}/api/auth/login`, signingAlgorithm: "RS256" };
}
