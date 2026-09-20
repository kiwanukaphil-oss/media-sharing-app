import { AUTH0_TRANSACTION_LIFETIME_MS, type Auth0LoginTransaction } from "./auth0-client";
import type { Auth0Settings } from "./auth0-config";

const loginCookieName = "__Host-relay_login";
const validRandomValue = (value: string) => /^[A-Za-z0-9_-]{43,128}$/.test(value);
const hashValue = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest(
  "SHA-256", new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, "0")).join("");
const configurationKey = (settings: Auth0Settings) => JSON.stringify([settings.issuer, settings.clientId, settings.callbackUrl]);

type StoredTransaction = { nonce: string; verifier: string; expires_at: number };

// Hash lookup credentials and bind the attempt to this issuer/client/callback configuration.
export async function storeAuth0Transaction(database: D1Database, settings: Auth0Settings,
  transaction: Auth0LoginTransaction, now = Date.now()) {
  if (![transaction.state, transaction.browserBinding, transaction.nonce, transaction.verifier].every(validRandomValue) ||
      !Number.isSafeInteger(transaction.expiresAt) || transaction.expiresAt <= now || transaction.expiresAt > now + AUTH0_TRANSACTION_LIFETIME_MS) {
    throw new Error("Invalid sign-in transaction.");
  }
  const [stateHash, browserHash, configurationHash] = await Promise.all([
    hashValue(transaction.state), hashValue(transaction.browserBinding), hashValue(configurationKey(settings)),
  ]);
  await database.batch([
    database.prepare("DELETE FROM auth_transactions WHERE expires_at <= ?").bind(now),
    database.prepare(`INSERT INTO auth_transactions (state_hash, browser_hash, configuration_hash, nonce, verifier, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)`).bind(stateHash, browserHash, configurationHash, transaction.nonce, transaction.verifier, transaction.expiresAt),
  ]);
}

// DELETE RETURNING makes a matching callback one-use even when requests arrive concurrently.
// A mismatched browser cannot consume another browser's attempt. Never perform token exchange before this succeeds.
export async function consumeAuth0Transaction(database: D1Database, settings: Auth0Settings,
  state: string, browserBinding: string, now = Date.now()): Promise<Auth0LoginTransaction | null> {
  if (!validRandomValue(state) || !validRandomValue(browserBinding)) return null;
  const [stateHash, browserHash, configurationHash] = await Promise.all([
    hashValue(state), hashValue(browserBinding), hashValue(configurationKey(settings)),
  ]);
  const stored = await database.prepare(`DELETE FROM auth_transactions
    WHERE state_hash = ? AND browser_hash = ? AND configuration_hash = ? AND expires_at > ? AND expires_at <= ?
    RETURNING nonce, verifier, expires_at`)
    .bind(stateHash, browserHash, configurationHash, now, now + AUTH0_TRANSACTION_LIFETIME_MS).first<StoredTransaction>();
  return stored ? { state, browserBinding, nonce: stored.nonce, verifier: stored.verifier, expiresAt: stored.expires_at } : null;
}

// Lax allows Auth0's top-level GET callback; __Host- prevents subdomain/path cookie shadowing.
export function auth0TransactionCookie(browserBinding: string) {
  if (!validRandomValue(browserBinding)) throw new Error("Invalid browser binding.");
  return `${loginCookieName}=${browserBinding}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`;
}
export function clearAuth0TransactionCookie() {
  return `${loginCookieName}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}
export function readAuth0BrowserBinding(request: Request): string | null {
  const values = (request.headers.get("Cookie") || "").split(";").map(part => part.trim())
    .filter(part => part.startsWith(`${loginCookieName}=`)).map(part => part.slice(loginCookieName.length + 1));
  return values.length === 1 && validRandomValue(values[0]) ? values[0] : null;
}
