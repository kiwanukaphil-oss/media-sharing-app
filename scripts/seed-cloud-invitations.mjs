import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile, access } from "node:fs/promises";

// Generate bootstrap invitations without putting raw credentials in SQL, logs, or tracked files.
async function prepareBootstrapInvitations() {
  const directory = new URL("../.sites-runtime/", import.meta.url);
  const output = new URL("cloud-invitations.json", directory);
  try { await access(output); console.log("Existing invitation material retained; nothing regenerated."); return; } catch {}
  await mkdir(directory, { recursive: true });
  const now = Date.now();
  const entries = ["Our shared space", "Relay verification"].map(name => ({ id: randomUUID(), name, token: randomBytes(32).toString("hex"), expiresAt: now + 24 * 60 * 60 * 1000 }));
  const statements = entries.flatMap(entry => [
    `INSERT INTO spaces (id, name, created_at) VALUES ('${entry.id}', '${entry.name}', ${now});`,
    `INSERT INTO invitations (token_hash, space_id, expires_at) VALUES ('${createHash("sha256").update(entry.token).digest("hex")}', '${entry.id}', ${entry.expiresAt});`,
  ]);
  await writeFile(output, JSON.stringify(entries), { mode: 0o600 });
  await writeFile(new URL("cloud-invitations.sql", directory), statements.join("\n"));
  console.log("Two isolated spaces prepared: owner setup and cloud verification. Invitations expire in 24 hours.");
}
await prepareBootstrapInvitations();
