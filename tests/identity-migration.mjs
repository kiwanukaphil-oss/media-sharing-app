import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

// Rehearse the complete Phase 1 -> Phase 2 upgrade with populated legacy access and organised media.
const database = new DatabaseSync(':memory:');
try {
  const journal = JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8')).entries;
  for (const migration of journal.filter(entry => entry.idx <= 6)) database.exec(await readFile(`drizzle/${migration.tag}.sql`, 'utf8'));
  database.exec(`INSERT INTO spaces VALUES ('legacy-space','Existing shared library',1);
    INSERT INTO devices(id,space_id,name,token_hash,role,created_at,expires_at,revoked_at) VALUES
      ('owner','legacy-space','Existing owner','owner-hash','owner',1,9999999999999,NULL),
      ('member','legacy-space','Existing member','member-hash','member',2,9999999999999,NULL),
      ('revoked','legacy-space','Removed device','revoked-hash','member',3,9999999999999,4);
    INSERT INTO invitations(token_hash,space_id,created_by,expires_at) VALUES ('unused-link','legacy-space','owner',9999999999999);
    INSERT INTO albums(id,space_id,name,description,created_at,revision) VALUES ('album','legacy-space','Existing album','Preserve this description',1,7);
    INSERT INTO album_sections(album_id,id,name,position) VALUES ('album','section','Custom shortlist',3);
    INSERT INTO media(id,space_id,device_id,name,mime,original_name,captured_at,size,sha256,category,object_key,upload_id,part_size,status,archived_at,preview_ready,preview_size,created_at,revision) VALUES
      ('ready','legacy-space','owner','Named original.jpg','image/jpeg','camera-original.jpg','2025-01-02',100,'${'a'.repeat(64)}','original','legacy/original','completed',10,'ready',NULL,1,12,1,4),
      ('trash','legacy-space','member','Retained final.jpg','image/jpeg','final.jpg',NULL,80,'${'b'.repeat(64)}','final','legacy/trash','completed',10,'ready',5,0,0,2,1),
      ('upload','legacy-space','member','Pending.raw','application/octet-stream',NULL,NULL,150,'${'c'.repeat(64)}','original','legacy/upload','multipart',10,'uploading',NULL,0,0,3,0);
    INSERT INTO album_media(album_id,media_id,section_id) VALUES ('album','ready','section'),('album','trash',NULL);
    UPDATE album_sections SET cover_media_id='ready' WHERE id='section';`);
  const tables = ['spaces', 'devices', 'invitations', 'media', 'albums', 'album_sections', 'album_media'];
  const before = Object.fromEntries(tables.map(table => [table, database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  for (const migration of journal.filter(entry => entry.idx > 6)) database.exec(await readFile(`drizzle/${migration.tag}.sql`, 'utf8'));
  for (const table of tables) assert.deepEqual(database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(), before[table], `${table} must survive the identity migration unchanged.`);
  for (const table of ['people', 'account_sessions', 'space_memberships', 'personal_spaces', 'legacy_owner_claims', 'person_invitations', 'publications', 'recovery_watermarks', 'account_deletion_requests', 'closure_fences', 'closure_write_admissions', 'closure_storage_effects', 'closure_backup_runs']) {
    assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0, 'Schema migration cannot infer identities, grant access or create destructive intent.');
  }
  assert.equal(database.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
  console.log(`PASS: Phase 1 legacy access, original metadata/keys, Trash, multipart state, albums, sections/covers and revisions unchanged through ${journal.at(-1).tag}; no inferred identities or grants.`);
} finally { database.close(); }
