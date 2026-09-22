import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {importSnapshot,checkDatabase,sanitizeRestoredAccess} from './relay-backup.mjs';
import {reviewMinimisationSchema} from './review-minimisation-schema.mjs';

// Add one role column in a disposable restore. Compare every existing column/row without printing
// content, then verify old invitations retain Member and restored credentials remain quarantined.
export async function rehearseInvitationUpgrade(sql) {
  const db=importSnapshot(sql);
  try {
    const tables=db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' AND name<>'__drizzle_migrations' ORDER BY name").all().map(row=>row.name);
    const quote=name=>'"'+name.replaceAll('"','""')+'"';
    const columns=new Map(tables.map(name=>[name,db.prepare('SELECT name FROM pragma_table_info(?) ORDER BY cid').all(name).map(row=>row.name)]));
    if(columns.get('person_invitations')?.includes('role'))throw new Error('Expected the schema before invitation roles.');
    const fingerprint=name=>createHash('sha256').update(JSON.stringify(db.prepare(`SELECT ${columns.get(name).map(quote).join(',')} FROM ${quote(name)} ORDER BY rowid`).all())).digest('hex');
    const before=new Map(tables.map(name=>[name,fingerprint(name)]));
    db.exec(await readFile('drizzle/0020_tidy_starjammers.sql','utf8'));
    checkDatabase(db);
    for(const name of tables)if(fingerprint(name)!==before.get(name))throw new Error('Existing data changed.');
    if(db.prepare("SELECT COUNT(*) AS n FROM person_invitations WHERE role<>'member'").get().n)throw new Error('Existing invitation grants changed.');
    const shape=tables.map(name=>[name,db.prepare('SELECT name,type FROM pragma_table_info(?) ORDER BY cid').all(name)]);
    if(reviewMinimisationSchema(db,shape).scope!=='global-backup-only')throw new Error('Unreviewed schema or protocol state.');
    sanitizeRestoredAccess(db);checkDatabase(db);
    if(db.prepare('SELECT COUNT(*) AS n FROM space_memberships WHERE revoked_at IS NULL').get().n)throw new Error('Restored membership was not quarantined.');
    return {status:'verified-local-upgrade',existingTablesPreserved:tables.length,existingInvitationsPreserveMember:true,
      restoreQuarantineVerified:true,sourceDigest:createHash('sha256').update(sql).digest('hex'),remoteApplied:false};
  } finally {db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {console.log(JSON.stringify(await rehearseInvitationUpgrade(await readFile(process.argv[2],'utf8'))));}
  catch {console.error('Invitation upgrade rehearsal failed; no remote state changed.');process.exitCode=1;}
}
