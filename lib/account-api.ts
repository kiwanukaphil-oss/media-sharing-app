import type { Auth0Settings } from "./auth0-config";
import { completeAuth0Login, discoverAuth0Client, prepareAuth0Login, type Auth0LoginTransaction, type VerifiedAuth0Identity } from "./auth0-client";
import { auth0TransactionCookie, clearAuth0TransactionCookie, consumeAuth0Transaction, readAuth0BrowserBinding, storeAuth0Transaction } from "./auth0-transactions";
import { AccountError, accountCookie, clearAccountCookie, createAccountSession, readAccountSession, readAccountToken, revokeAccountSession } from "./account-sessions";

type LoginProvider = {
  prepare(settings: Auth0Settings): Promise<{ url: string; transaction: Auth0LoginTransaction }>;
  complete(settings: Auth0Settings, url: URL, transaction: Auth0LoginTransaction, binding: string): Promise<VerifiedAuth0Identity>;
};
const auth0Provider: LoginProvider = {
  async prepare(settings) { return prepareAuth0Login(settings, await discoverAuth0Client(settings)); },
  async complete(settings, url, transaction, binding) {
    return completeAuth0Login(settings, await discoverAuth0Client(settings), url, transaction, binding);
  },
};
const privateHeaders = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

// Consume the login attempt before contacting the provider; callback failures never expose provider details.
async function finishAccountLogin(request: Request, database: D1Database, settings: Auth0Settings, provider: LoginProvider) {
  const headers = new Headers(privateHeaders);
  headers.append("Set-Cookie", clearAuth0TransactionCookie());
  try {
    const url = new URL(request.url);
    const binding = readAuth0BrowserBinding(request);
    if (!binding || url.searchParams.getAll("state").length !== 1 || url.searchParams.getAll("code").length !== 1 || url.searchParams.has("error")) {
      throw new AccountError(400, "This sign-in attempt is invalid or was cancelled. Start again.");
    }
    const transaction = await consumeAuth0Transaction(database, settings, url.searchParams.get("state")!, binding);
    if (!transaction) throw new AccountError(400, "This sign-in attempt expired or was already used. Start again.");
    const identity = await provider.complete(settings, url, transaction, binding);
    const session = await createAccountSession(database, settings, identity, readAccountToken(request));
    headers.append("Set-Cookie", accountCookie(session.token));
    headers.set("Location", `${settings.appOrigin}/account`);
    return new Response(null, { status: 303, headers });
  } catch (error) {
    const reason = error instanceof AccountError && error.message.startsWith("Verify your email") ? "verify-email" : "failed";
    headers.set("Location", `${settings.appOrigin}/account?signin=${reason}`);
    return new Response(null, { status: 303, headers });
  }
}

// Account endpoints deliberately do not read or create space memberships or legacy device credentials.
// Origin checks apply even to callers presenting Authorization; account cookies have no bearer-token bypass.
export async function accountAction(request: Request, database: D1Database, settings: Auth0Settings | null,
  provider: LoginProvider = auth0Provider): Promise<Response> {
  const url = new URL(request.url);
  const action = url.pathname.slice("/api/auth/".length);
  if (!settings) {
    if (action === "session" && request.method === "GET") return Response.json({ enabled: false, account: null }, { headers: privateHeaders });
    throw new AccountError(404, "Account sign-in is not available yet.");
  }
  if (url.origin !== settings.appOrigin) throw new AccountError(403, "Use the Relay account address to sign in.");
  if (request.method !== "GET" && request.headers.get("Origin") !== settings.appOrigin) throw new AccountError(403, "Send this request from Relay.");
  if (action === "login" && request.method === "GET") {
    if (request.headers.get("Sec-Fetch-Site") === "cross-site" && request.headers.get("Sec-Fetch-Mode") !== "navigate") {
      throw new AccountError(403, "Open Relay to sign in.");
    }
    const login = await provider.prepare(settings);
    await storeAuth0Transaction(database, settings, login.transaction);
    return new Response(null, { status: 303, headers: { ...privateHeaders, Location: login.url, "Set-Cookie": auth0TransactionCookie(login.transaction.browserBinding) } });
  }
  if (action === "callback" && request.method === "GET") return finishAccountLogin(request, database, settings, provider);
  const session = await readAccountSession(database, settings, readAccountToken(request));
  if (action === "session" && request.method === "GET") {
    return Response.json({ enabled: true, account: session }, { headers: privateHeaders });
  }
  if (!session) throw new AccountError(401, "Sign in to your account to continue.");
  if (action === "logout" && request.method === "POST") {
    await revokeAccountSession(database, session, session.sessionId);
    return Response.json({ signedOut: true }, { headers: { ...privateHeaders, "Set-Cookie": clearAccountCookie() } });
  }
  if (action === "sessions" && request.method === "GET") {
    const sessions = await database.prepare(`SELECT id, created_at AS createdAt, expires_at AS expiresAt FROM account_sessions
      WHERE person_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC, id LIMIT 100`)
      .bind(session.personId, Date.now()).all();
    return Response.json({ currentSessionId: session.sessionId, sessions: sessions.results }, { headers: privateHeaders });
  }
  const target = /^sessions\/([a-f0-9-]{36})$/.exec(action)?.[1];
  if (target && request.method === "DELETE") {
    await revokeAccountSession(database, session, target);
    return Response.json({ revoked: true }, { headers: { ...privateHeaders, ...(target === session.sessionId ? { "Set-Cookie": clearAccountCookie() } : {}) } });
  }
  throw new AccountError(404, "This account action is unavailable.");
}
