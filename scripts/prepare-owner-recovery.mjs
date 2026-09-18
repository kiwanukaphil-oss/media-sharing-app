import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const spaceId = process.argv[2];
if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(spaceId || '')) {
  throw new Error('Usage: node scripts/prepare-owner-recovery.mjs <verified-space-uuid>. Prepares files only; never applies them.');
}

// Prepare a short-lived, space-scoped operator credential for an explicitly approved recovery.
// Tokens stay in ignored local files; the operator must review and apply the SQL separately.
async function prepareOwnerRecovery() {
  const id = randomUUID();
  const token = randomBytes(32).toString('hex');
  const now = Date.now();
  const expiresAt = now + 30 * 60 * 1000;
  const directory = resolve('.sites-runtime', 'owner-recovery', id);
  await mkdir(directory, { recursive: true });
  const hash = createHash('sha256').update(token).digest('hex');
  const sql = `-- Review the space identity and obtain explicit recovery approval before applying.\n` +
    `-- Must affect exactly one row. This temporary owner expires thirty minutes after preparation.\n` +
    `INSERT INTO devices (id, space_id, name, token_hash, role, created_at, expires_at)\n` +
    `SELECT '${id}', id, 'Temporary recovery owner', '${hash}', 'owner', ${now}, ${expiresAt}\n` +
    `FROM spaces WHERE id = '${spaceId}';\n`;
  await writeFile(resolve(directory, 'recovery.sql'), sql, { mode: 0o600, flag: 'wx' });
  await writeFile(resolve(directory, 'credential.json'), JSON.stringify({ deviceId: id, spaceId, token, expiresAt }), { mode: 0o600, flag: 'wx' });
  console.log(`Prepared private recovery files in ${directory}. No database or access was changed. Do not share credential.json.`);
}
await prepareOwnerRecovery();
