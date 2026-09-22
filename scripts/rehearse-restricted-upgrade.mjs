import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {reviewMinimisationSchema} from './review-minimisation-schema.mjs';
import {importSnapshot,checkDatabase,sanitizeRestoredAccess} from './relay-backup.mjs';
import {planReadOnlySnapshot,restoreReadOnlySnapshot,schemaQuery} from './backup-d1-readonly.mjs';

// Work exclusively on an in-memory copy. Compare the original columns so additive scope fields do
// not hide changes to existing records, then export/import the triggers and quarantine restored access.
export async function rehearseRestrictedUpgrade(sql) {
  const db=importSnapshot(sql);
  try {
    const names=()=>db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' AND name<>'__drizzle_migrations' ORDER BY name").all().map(row=>row.name);
    if(names().includes('asset_scopes'))throw new Error('Expected a pre-scope schema.');
    const quote=value=>'"'+value.replaceAll('"','""')+'"';
    const before=names().map(name=>({name,columns:db.prepare('SELECT name FROM pragma_table_info(?) ORDER BY cid').all(name).map(row=>row.name)}));
    const fingerprint=table=>createHash('sha256').update(JSON.stringify(db.prepare(`SELECT ${table.columns.map(quote).join(',')} FROM ${quote(table.name)} ORDER BY rowid`).all())).digest('hex');
    for(const table of before)table.digest=fingerprint(table);
    if(!names().includes('personal_favorites'))db.exec(await readFile('drizzle/0021_magical_raza.sql','utf8'));
    if(!names().includes('library_events'))db.exec(await readFile('drizzle/0022_glamorous_star_brand.sql','utf8'));
    db.exec(await readFile('drizzle/0023_eager_penance.sql','utf8'));
    db.exec(await readFile('drizzle/0024_burly_senator_kelly.sql','utf8'));checkDatabase(db);
    for(const table of before)if(fingerprint(table)!==table.digest)throw new Error('Existing records changed.');
    for(const name of ['media','albums'])if(db.prepare(`SELECT COUNT(*) AS n FROM ${name} WHERE access_scope_id IS NOT NULL`).get().n)throw new Error('Migration invented a scope.');
    const shape=names().map(name=>[name,db.prepare('SELECT name,type FROM pragma_table_info(?) ORDER BY cid').all(name)]);
    if(reviewMinimisationSchema(db,shape).scope!=='global-backup-only')throw new Error('Unreviewed erasure schema.');
    const plan=planReadOnlySnapshot(db.prepare(schemaQuery).all());
    const restored=importSnapshot(restoreReadOnlySnapshot(plan,db.prepare(plan.sql).all()));
    try {
      sanitizeRestoredAccess(restored);checkDatabase(restored);
      if(restored.prepare('SELECT COUNT(*) AS n FROM space_memberships WHERE revoked_at IS NULL').get().n)throw new Error('Memberships not quarantined.');
      const triggers=database=>database.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' ORDER BY name").all();
      if(JSON.stringify(triggers(db))!==JSON.stringify(triggers(restored)))throw new Error('Restore lost scope protection.');
    } finally {restored.close();}
    return {status:'verified-local-upgrade',existingTablesPreserved:before.length,scopeMigrationInventsNoGrants:true,
      restoredTriggersVerified:true,restoreQuarantineVerified:true,schemaDigest:createHash('sha256').update(JSON.stringify(shape)).digest('hex'),
      sourceDigest:createHash('sha256').update(sql).digest('hex'),remoteApplied:false};
  } finally {db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {console.log(JSON.stringify(await rehearseRestrictedUpgrade(await readFile(process.argv[2],'utf8'))));}
  catch(error) {console.error('Restricted upgrade rehearsal failed: '+error.message);process.exitCode=1;}
}
