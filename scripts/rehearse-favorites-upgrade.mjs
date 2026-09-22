import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {importSnapshot,checkDatabase,sanitizeRestoredAccess} from './relay-backup.mjs';
import {reviewMinimisationSchema} from './review-minimisation-schema.mjs';

// Rehearse only the additive bookmark table in memory. Existing content/access/invitations are
// fingerprinted, and a restored copy must still quarantine every historical membership.
export async function rehearseFavoritesUpgrade(sql) {
  const db=importSnapshot(sql);
  try {
    const tables=()=>db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' AND name<>'__drizzle_migrations' ORDER BY name").all().map(row=>row.name);
    const beforeTables=tables();
    if(beforeTables.includes('personal_favorites')||!db.prepare("SELECT 1 FROM pragma_table_info('person_invitations') WHERE name='role'").get())throw new Error('Expected migration 0020.');
    const fingerprint=name=>createHash('sha256').update(JSON.stringify(db.prepare(`SELECT * FROM "${name.replaceAll('"','""')}" ORDER BY rowid`).all())).digest('hex');
    const before=new Map(beforeTables.map(name=>[name,fingerprint(name)]));
    db.exec(await readFile('drizzle/0021_magical_raza.sql','utf8'));checkDatabase(db);
    for(const name of beforeTables)if(fingerprint(name)!==before.get(name))throw new Error('Existing rows changed.');
    if(db.prepare('SELECT COUNT(*) AS n FROM personal_favorites').get().n!==0)throw new Error('Migration inferred bookmarks.');
    const shape=tables().map(name=>[name,db.prepare('SELECT name,type FROM pragma_table_info(?) ORDER BY cid').all(name)]);
    if(reviewMinimisationSchema(db,shape).scope!=='global-backup-only')throw new Error('Unreviewed schema or protocol state.');
    sanitizeRestoredAccess(db);checkDatabase(db);
    if(db.prepare('SELECT COUNT(*) AS n FROM space_memberships WHERE revoked_at IS NULL').get().n)throw new Error('Restore access not quarantined.');
    return {status:'verified-local-upgrade',existingTablesPreserved:beforeTables.length,emptyPersonalBookmarks:true,restoreQuarantineVerified:true,
      sourceDigest:createHash('sha256').update(sql).digest('hex'),remoteApplied:false};
  } finally {db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {console.log(JSON.stringify(await rehearseFavoritesUpgrade(await readFile(process.argv[2],'utf8'))));}
  catch {console.error('Favourites upgrade rehearsal failed; no remote state changed.');process.exitCode=1;}
}
