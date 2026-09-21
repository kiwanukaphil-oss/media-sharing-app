import { AccountError } from "./account-sessions";

type BackupCommand = { action: "begin"; id: string; snapshotId: string } |
  { action: "settle"; id: string; snapshotId: string; receiptDigest: string; outcome: "settled" | "uncertain" };
const deny = () => new AccountError(403, "Backup coordination could not be verified.");
const encoder = new TextEncoder();

// This dedicated capability only records global backup admission and acknowledged completion. It
// cannot query application content, alter people or clear closure fences. No public route is wired yet.
async function verifyBackupCommand(request: Request, secret: string | undefined, now: number): Promise<BackupCommand> {
  if (request.method !== "POST" || request.headers.has("Origin") || !/^[a-f0-9]{64}$/.test(secret ?? "") || !request.body) throw deny();
  const timestamp = request.headers.get("X-Relay-Backup-Time") ?? "", signature = request.headers.get("X-Relay-Backup-Signature") ?? "";
  if (!/^\d{13}$/.test(timestamp) || Math.abs(now - Number(timestamp)) > 300000 || !/^[a-f0-9]{64}$/.test(signature)) throw deny();
  const reader = request.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  let length = 0, body = "";
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > 2048) { await reader.cancel(); throw deny(); }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
  } catch { throw deny(); } finally { reader.releaseLock(); }
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const proof = Uint8Array.from(signature.match(/../g)!, byte => parseInt(byte, 16));
  if (!await crypto.subtle.verify("HMAC", key, proof, encoder.encode(`relay-backup-coordination-v1.${timestamp}.${body}`))) throw deny();
  let command: BackupCommand;
  try { command = JSON.parse(body); } catch { throw deny(); }
  if (!command || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(command.id) ||
      !/^\d{4}-\d{2}-\d{2}T[\d-]+Z-[a-f0-9-]{36}$/.test(command.snapshotId)) throw deny();
  const fields = command.action === "begin" ? ["action", "id", "snapshotId"] : ["action", "id", "snapshotId", "receiptDigest", "outcome"];
  if (Object.keys(command).sort().join() !== fields.sort().join() || !["begin", "settle"].includes(command.action) ||
      (command.action === "settle" && (!/^[a-f0-9]{64}$/.test(command.receiptDigest) || !["settled", "uncertain"].includes(command.outcome)))) throw deny();
  return command;
}

// D1 orders admission against closure atomically. Stable run identifiers make lost-response retries
// safe; a completed/uncertain run never becomes active again, and no clock expiry clears a writer.
export async function acceptBackupCoordination(request: Request, database: D1Database, secret: string | undefined, now = Date.now()) {
  const command = await verifyBackupCommand(request, secret, now);
  if (command.action === "begin") {
    await database.batch([
      database.prepare(`INSERT INTO closure_write_admissions(id,kind,generation,state,started_at)
        SELECT ?,'backup',0,'active',? WHERE NOT EXISTS(SELECT 1 FROM closure_fences)
        AND NOT EXISTS(SELECT 1 FROM closure_backup_runs WHERE snapshot_id=?) ON CONFLICT DO NOTHING`).bind(command.id, now, command.snapshotId),
      database.prepare(`INSERT INTO closure_backup_runs(id,snapshot_id,created_at) SELECT ?,?,? WHERE EXISTS
        (SELECT 1 FROM closure_write_admissions WHERE id=? AND kind='backup' AND state='active')
        AND NOT EXISTS(SELECT 1 FROM closure_fences) ON CONFLICT DO NOTHING`).bind(command.id, command.snapshotId, now, command.id),
    ]);
  } else {
    // Receipt digests bind evidence produced after every storage promise finishes; the dedicated trusted
    // writer supplies it. This does not independently prove receipt contents or grant erasure authority.
    await database.batch([
      database.prepare(`UPDATE closure_backup_runs SET receipt_digest=? WHERE id=? AND snapshot_id=? AND receipt_digest IS NULL
        AND EXISTS(SELECT 1 FROM closure_write_admissions WHERE id=? AND kind='backup' AND state='active')
        AND (?='uncertain' OR NOT EXISTS(SELECT 1 FROM closure_storage_effects WHERE admission_id=? AND state<>'acknowledged'))`)
        .bind(command.receiptDigest, command.id, command.snapshotId, command.id, command.outcome, command.id),
      database.prepare(`UPDATE closure_write_admissions SET state=?,settled_at=? WHERE id=? AND kind='backup' AND state='active'
        AND EXISTS(SELECT 1 FROM closure_backup_runs WHERE id=? AND snapshot_id=? AND receipt_digest=?)
        AND (?='uncertain' OR NOT EXISTS(SELECT 1 FROM closure_storage_effects WHERE admission_id=? AND state<>'acknowledged'))`)
        .bind(command.outcome, now, command.id, command.id, command.snapshotId, command.receiptDigest, command.outcome, command.id),
    ]);
  }
  const run = await database.prepare(`SELECT a.state,b.receipt_digest AS receiptDigest FROM closure_backup_runs b
    JOIN closure_write_admissions a ON a.id=b.id WHERE b.id=? AND b.snapshot_id=? AND a.kind='backup'`)
    .bind(command.id, command.snapshotId).first<{ state: string; receiptDigest: string | null }>();
  if (!run || (command.action === "begin" && run.state !== "active") ||
      (command.action === "settle" && (run.state !== command.outcome || run.receiptDigest !== command.receiptDigest))) {
    throw new AccountError(409, "Backup coordination changed; retain this run for review.");
  }
  return Response.json({ id: command.id, snapshotId: command.snapshotId, ...run }, { headers: { "Cache-Control": "no-store" } });
}
