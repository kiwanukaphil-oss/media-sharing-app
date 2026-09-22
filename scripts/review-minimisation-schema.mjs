import { createHash } from 'node:crypto';

const baseDigest = 'b59ead9f977608a709cc1569f7fa90b6427f18b12908bb3babc57dad12902201';
const protocolDigest = '94b6d4de5174007726b87356cec7f5f54272cc2e9d5b34c941f24c0041ab36e5';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

// Review a deliberately narrow activation stage: global backup runs contain only opaque run/snapshot
// IDs, timing and receipt digests. Any account/device admission, fence or storage key still requires
// the separate disposition/minimisation review. This is not an unrestricted protocol-schema allowlist.
export function reviewMinimisationSchema(database, shape) {
  const schemaDigest = createHash('sha256').update(JSON.stringify(shape)).digest('hex');
  if (schemaDigest === baseDigest) return { accepted: true, scope: 'migration-0018', schemaDigest };
  const denied = { accepted: false, scope: 'requires-review', schemaDigest };
  if (schemaDigest !== protocolDigest) return denied;
  if (database.prepare(`SELECT (SELECT COUNT(*) FROM closure_fences) +
      (SELECT COUNT(*) FROM closure_storage_effects) + (SELECT COUNT(*) FROM closure_write_admissions
      WHERE kind<>'backup' OR person_id IS NOT NULL OR device_id IS NOT NULL) AS n`).get().n !== 0) return denied;
  const runs = database.prepare(`SELECT a.id,a.generation,a.state,a.started_at,a.settled_at,
    b.snapshot_id,b.receipt_digest,b.created_at FROM closure_write_admissions a
    JOIN closure_backup_runs b ON b.id=a.id`).all();
  if (runs.length !== database.prepare('SELECT COUNT(*) AS n FROM closure_write_admissions').get().n ||
      runs.length !== database.prepare('SELECT COUNT(*) AS n FROM closure_backup_runs').get().n) return denied;
  for (const run of runs) {
    if (!uuid.test(run.id) || !/^\d{4}-\d{2}-\d{2}T[\d-]+Z-[a-f0-9-]{36}$/.test(run.snapshot_id) ||
        run.generation !== 0 || !['active', 'settled', 'uncertain'].includes(run.state) ||
        ![run.started_at, run.created_at].every(value => Number.isSafeInteger(value) && value > 0) ||
        (run.settled_at !== null && (!Number.isSafeInteger(run.settled_at) || run.settled_at <= 0)) ||
        (run.receipt_digest !== null && !/^[a-f0-9]{64}$/.test(run.receipt_digest)) ||
        (run.state === 'settled' && (run.receipt_digest === null || run.settled_at === null))) return denied;
  }
  return { accepted: true, scope: 'global-backup-only', schemaDigest };
}
