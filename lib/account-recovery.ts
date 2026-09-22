import type { Auth0Settings } from "./auth0-config";
import { AccountError } from "./account-sessions";

const encoder = new TextEncoder();
const rejectEvent = () => new AccountError(403, "Recovery event could not be verified.");

// Stream to a hard limit before parsing: neither a missing nor forged Content-Length can bypass it.
async function readRecoveryBody(request: Request) {
  if (!request.body) throw rejectEvent();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > 4096) { await reader.cancel(); throw rejectEvent(); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

// This is a server-to-server endpoint, never an alternative browser authentication mechanism.
// Authenticate exact body bytes and delivery time before accepting any provider identity or touching D1.
export async function acceptRecoveryEvent(request: Request, database: D1Database,
  settings: Auth0Settings | null, secret: string | undefined, now = Date.now()) {
  if (request.method !== "POST" || !settings || !secret || !/^[a-f0-9]{64}$/.test(secret)) throw rejectEvent();
  const timestamp = request.headers.get("X-Relay-Recovery-Time") || "";
  const signature = request.headers.get("X-Relay-Recovery-Signature") || "";
  if (!/^\d{13}$/.test(timestamp) || Math.abs(now - Number(timestamp)) > 300_000 || !/^[a-f0-9]{64}$/.test(signature)) throw rejectEvent();
  let body: string;
  try { body = await readRecoveryBody(request); } catch { throw rejectEvent(); }
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const proof = Uint8Array.from(signature.match(/../g)!, byte => parseInt(byte, 16));
  if (!await crypto.subtle.verify("HMAC", key, proof, encoder.encode(`${timestamp}.${body}`))) throw rejectEvent();
  let event: { issuer?: unknown; subject?: unknown; changedAt?: unknown };
  try { event = JSON.parse(body); } catch { throw rejectEvent(); }
  if (!event || event.issuer !== settings.issuer || typeof event.subject !== "string" || !event.subject || event.subject.length > 255 ||
      typeof event.changedAt !== "number" || !Number.isSafeInteger(event.changedAt) || event.changedAt <= 0 || event.changedAt > now) throw rejectEvent();
  await recordRecoveryWatermark(database, settings.issuer, event.subject, event.changedAt, now);
  return new Response(null, { status: 204 });
}

// D1 batches serialize reset/sign-in races. Duplicate and out-of-order deliveries cannot lower the watermark.
// Only older authentication is revoked; media, membership and newly authenticated sessions are preserved.
// A delayed provider event must not recreate identifying watermarks after closure/minimisation.
export async function recordRecoveryWatermark(database: D1Database, issuer: string, subject: string, changedAt: number, now: number) {
  const identityDigest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",
    encoder.encode(JSON.stringify([issuer, subject])))), byte => byte.toString(16).padStart(2, "0")).join("");
  const acceptsRecovery = `NOT EXISTS (SELECT 1 FROM people closed WHERE
    (closed.issuer='urn:relay:erased' AND closed.subject=?) OR
    (closed.issuer=? AND closed.subject=? AND closed.disabled_at IS NOT NULL))`;
  const identityBindings = [identityDigest, issuer, subject];
  await database.batch([
    database.prepare(`INSERT INTO recovery_watermarks (issuer, subject, changed_at) SELECT ?, ?, ? WHERE ${acceptsRecovery}
      ON CONFLICT(issuer, subject) DO UPDATE SET changed_at = MAX(recovery_watermarks.changed_at, excluded.changed_at)`)
      .bind(issuer, subject, changedAt, ...identityBindings),
    database.prepare(`UPDATE people SET credentials_changed_at = MAX(credentials_changed_at,
      (SELECT changed_at FROM recovery_watermarks WHERE issuer = ? AND subject = ?)) WHERE issuer = ? AND subject = ? AND ${acceptsRecovery}`)
      .bind(issuer, subject, issuer, subject, ...identityBindings),
    database.prepare(`UPDATE account_sessions SET revoked_at = ? WHERE revoked_at IS NULL AND person_id IN
      (SELECT id FROM people WHERE issuer = ? AND subject = ?) AND authenticated_at <
      (SELECT changed_at FROM recovery_watermarks WHERE issuer = ? AND subject = ?) AND ${acceptsRecovery}`)
      .bind(now, issuer, subject, issuer, subject, ...identityBindings),
  ]);
}
