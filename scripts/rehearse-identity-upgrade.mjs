import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { importSnapshot, checkDatabase } from './relay-backup.mjs';

// Rehearse against a private Phase 1 export in memory; never modify the input or print its rows.
async function rehearseIdentityUpgrade(snapshotPath) {
  if (!snapshotPath) throw new Error('Provide the path to a private Phase 1 SQL export.');
  const database = importSnapshot(await readFile(snapshotPath, 'utf8'));
  try {
    if (database.prepare("SELECT 1 FROM sqlite_schema WHERE name='people'").get()) {
      throw new Error('This rehearsal requires a Phase 1 snapshot without identity tables.');
    }
    const tables = ['spaces', 'devices', 'invitations', 'media', 'albums', 'album_sections', 'album_media'];
    const fingerprint = table => createHash('sha256').update(JSON.stringify(database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())).digest('hex');
    const before = Object.fromEntries(tables.map(table => [table, fingerprint(table)]));
    const journal = JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8')).entries;
    for (const migration of journal.filter(entry => entry.idx > 6)) {
      database.exec(await readFile(`drizzle/${migration.tag}.sql`, 'utf8'));
    }
    checkDatabase(database);
    for (const table of tables) if (fingerprint(table) !== before[table]) throw new Error(`Existing ${table} changed during rehearsal.`);
    for (const table of ['people', 'account_sessions', 'space_memberships', 'personal_spaces', 'legacy_owner_claims', 'person_invitations', 'publications', 'recovery_watermarks', 'account_deletion_requests']) {
      if (database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n !== 0) throw new Error('Migration inferred identity, access or lifecycle intent.');
    }
    console.log(`PASS: private Phase 1 snapshot upgraded through ${journal.at(-1).tag}; legacy rows unchanged, integrity/relationships valid, identity tables empty. No remote mutation.`);
  } finally { database.close(); }
}

await rehearseIdentityUpgrade(process.argv[2]);
