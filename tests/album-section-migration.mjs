import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

const database = new DatabaseSync(':memory:');
const journal = JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8')).entries;
for (const migration of journal.slice(0, 5)) database.exec(await readFile(`drizzle/${migration.tag}.sql`, 'utf8'));
database.exec(`INSERT INTO spaces VALUES ('space', 'Existing space', 1);
  INSERT INTO devices (id, space_id, name, token_hash, created_at, expires_at) VALUES ('device', 'space', 'Legacy device', 'hash', 1, 9999);
  INSERT INTO albums (id, space_id, name, created_at) VALUES ('album', 'space', 'Existing album', 1), ('other', 'space', 'Other album', 1);
  INSERT INTO media (id, space_id, device_id, name, mime, size, sha256, category, object_key, upload_id, part_size, status, created_at)
    VALUES ('file', 'space', 'device', 'original.raw', 'application/octet-stream', 12, 'digest', 'original', 'object', 'upload', 12, 'ready', 1);
  INSERT INTO album_media VALUES ('album', 'file'), ('other', 'file');`);
for (const migration of journal.slice(5)) database.exec(await readFile(`drizzle/${migration.tag}.sql`, 'utf8'));
assert.equal(database.prepare('SELECT COUNT(*) AS n FROM album_media').get().n, 2);
assert.equal(database.prepare('SELECT COUNT(*) AS n FROM album_media WHERE section_id IS NULL').get().n, 2);
database.exec("INSERT INTO album_sections (album_id,id,name) VALUES ('album','section','Shortlist')");
assert.throws(() => database.exec("UPDATE album_media SET section_id='section' WHERE album_id='other'"), /FOREIGN KEY/);
database.exec("UPDATE album_media SET section_id='section' WHERE album_id='album'");
assert.equal(database.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
assert.equal(database.prepare('SELECT name FROM media').get().name, 'original.raw');
database.close();
console.log('PASS: existing memberships preserved, no global category rewrite, same-album foreign keys enforced.');
