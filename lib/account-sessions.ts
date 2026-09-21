import type { VerifiedAuth0Identity } from "./auth0-client";
import type { Auth0Settings } from "./auth0-config";

import { accountSessionLifetime, type AccountSessionMode } from "./account-session-policy";
export { ACCOUNT_SESSION_LIFETIME_MS } from "./account-session-policy";
const cookieName = "__Host-relay_account";
const validToken = (token: string) => /^[a-f0-9]{64}$/.test(token);
const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest(
  "SHA-256", new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, "0")).join("");
const configurationHash = (settings: Auth0Settings) => digest(JSON.stringify([settings.issuer, settings.clientId, settings.appOrigin]));

export class AccountError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export type AccountSession = {
  sessionId: string; personId: string; displayName: string; verifiedEmail: string; createdAt: number; expiresAt: number; sessionMode: AccountSessionMode;
};

// Reject duplicate cookies rather than letting cookie order select the authenticated account.
export function readAccountToken(request: Request) {
  const values = (request.headers.get("Cookie") || "").split(";").map(part => part.trim())
    .filter(part => part.startsWith(`${cookieName}=`)).map(part => part.slice(cookieName.length + 1));
  return values.length === 1 && validToken(values[0]) ? values[0] : null;
}
export function accountCookie(token: string, mode: AccountSessionMode = "temporary") {
  if (!validToken(token)) throw new Error("Invalid account credential.");
  const lifetime = accountSessionLifetime(mode);
  return `${cookieName}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/${mode === "trusted" ? `; Max-Age=${lifetime / 1000}` : ""}`;
}
export function clearAccountCookie() {
  return `${cookieName}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

// Atomically resolve the stable provider identity and issue a fresh hashed credential.
// Email changes update profile data only. Disabled accounts cannot be resurrected by signing in.
export async function createAccountSession(database: D1Database, settings: Auth0Settings,
  identity: VerifiedAuth0Identity, previousToken: string | null, now = Date.now(), mode: AccountSessionMode = "temporary") {
  const lifetime = accountSessionLifetime(mode);
  if (identity.issuer !== settings.issuer || !identity.subject || identity.subject.length > 255 ||
      !identity.verifiedEmail || identity.verifiedEmail.length > 320) {
    throw new AccountError(403, "Verify your email address before signing in to Relay.");
  }
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
  const sessionId = crypto.randomUUID();
  const binding = await configurationHash(settings);
  const previousHash = previousToken && validToken(previousToken) ? await digest(previousToken) : "";
  const results = await database.batch([
    database.prepare(`INSERT INTO people (id, issuer, subject, display_name, verified_email, created_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(issuer, subject) DO UPDATE SET
      display_name = excluded.display_name, verified_email = excluded.verified_email WHERE people.disabled_at IS NULL`)
      .bind(crypto.randomUUID(), identity.issuer, identity.subject, identity.displayName.slice(0, 100), identity.verifiedEmail, now),
    database.prepare(`INSERT INTO account_sessions (id, person_id, token_hash, configuration_hash, created_at, expires_at, session_mode, provider_session_id)
      SELECT ?, id, ?, ?, ?, ?, ?, ? FROM people WHERE issuer = ? AND subject = ? AND disabled_at IS NULL`)
      .bind(sessionId, await digest(token), binding, now, now + lifetime, mode, identity.providerSessionId || null, identity.issuer, identity.subject),
    database.prepare(`UPDATE account_sessions SET revoked_at = ? WHERE token_hash = ? AND configuration_hash = ?
      AND revoked_at IS NULL AND EXISTS (SELECT 1 FROM account_sessions WHERE id = ?)`)
      .bind(now, previousHash, binding, sessionId),
  ]);
  if (!results[1].meta.changes) throw new AccountError(403, "This account is unavailable.");
  return { token, sessionId };
}

// Always recheck expiry and account disablement in D1; browser-held identity is never authority.
export async function readAccountSession(database: D1Database, settings: Auth0Settings, token: string | null, now = Date.now()) {
  if (!token || !validToken(token)) return null;
  return database.prepare(`SELECT s.id AS sessionId, p.id AS personId, p.display_name AS displayName,
    p.verified_email AS verifiedEmail, s.created_at AS createdAt, s.expires_at AS expiresAt, s.session_mode AS sessionMode
    FROM account_sessions s JOIN people p ON p.id = s.person_id
    WHERE s.token_hash = ? AND s.configuration_hash = ? AND s.revoked_at IS NULL
    AND s.expires_at > ? AND p.disabled_at IS NULL`)
    .bind(await digest(token), await configurationHash(settings), now).first<AccountSession>();
}

// Revocation is scoped to the authenticated person and is safe to retry without revealing other accounts.
export async function revokeAccountSession(database: D1Database, session: AccountSession, targetId: string, now = Date.now()) {
  await database.prepare("UPDATE account_sessions SET revoked_at = ? WHERE id = ? AND person_id = ? AND revoked_at IS NULL")
    .bind(now, targetId, session.personId).run();
}
