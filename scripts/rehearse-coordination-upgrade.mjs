import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { importSnapshot, checkDatabase, sanitizeRestoredAccess } from './relay-backup.mjs';
import { reviewMinimisationSchema } from './review-minimisation-schema.mjs';

// Apply only additive migration 0019 in memory. Compare every pre-existing application row, including
// current identity/claims, uploads and access records; never print those rows or mutate the source SQL.
export async function rehearseCoordinationUpgrade(sql) {
  const database = importSnapshot(sql);
  try {
    const tables = database.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' AND name<>'__drizzle_migrations' ORDER BY name").all().map(row => row.name);
    const shape = () => database.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' AND name<>'__drizzle_migrations' ORDER BY name").all()
      .map(({ name }) => [name, database.prepare('SELECT name,type FROM pragma_table_info(?) ORDER BY cid').all(name)]);
    if (reviewMinimisationSchema(database, shape()).scope !== 'migration-0018') throw new Error('A reviewed migration-0018 snapshot is required.');
    const fingerprint = table => createHash('sha256').update(JSON.stringify(database.prepare(`SELECT * FROM "${table.replaceAll('"', '""')}" ORDER BY rowid`).all())).digest('hex');
    const before = new Map(tables.map(table => [table, fingerprint(table)]));
    database.exec(await readFile('drizzle/0019_wild_nighthawk.sql', 'utf8'));
    checkDatabase(database);
    for (const table of tables) if (fingerprint(table) !== before.get(table)) throw new Error('Existing application rows changed during migration.');
    if (reviewMinimisationSchema(database, shape()).scope !== 'global-backup-only') throw new Error('Migration schema differs from reviewed backup scope.');
    const addedTables = ['closure_fences', 'closure_write_admissions', 'closure_storage_effects', 'closure_backup_runs'];
    for (const table of addedTables) if (database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n !== 0) throw new Error('Migration created protocol intent.');
    sanitizeRestoredAccess(database);
    checkDatabase(database);
    return { status: 'verified-local-upgrade', existingTablesPreserved: tables.length, addedEmptyTables: addedTables.length,
      sourceDigest: createHash('sha256').update(sql).digest('hex'), restoreQuarantineVerified: true, remoteApplied: false };
  } finally { database.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (!process.argv[2]) throw new Error('Private source snapshot is required.');
    console.log(JSON.stringify(await rehearseCoordinationUpgrade(await readFile(process.argv[2], 'utf8'))));
  } catch { console.error('Coordination upgrade rehearsal failed; no remote state changed.'); process.exitCode = 1; }
}
