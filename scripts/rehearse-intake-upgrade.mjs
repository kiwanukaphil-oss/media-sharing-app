import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {importSnapshot,checkDatabase,sanitizeRestoredAccess} from './relay-backup.mjs';
import {planReadOnlySnapshot,restoreReadOnlySnapshot,schemaQuery} from './backup-d1-readonly.mjs';
import {reviewMinimisationSchema} from './review-minimisation-schema.mjs';

// Rehearse only in memory, starting from a reviewed pre-intake schema. Preserve every existing
// column/row, introduce no invitations, and verify schema triggers survive a quarantined restore.
export async function rehearseIntakeUpgrade(sql){
  const db=importSnapshot(sql),digest=value=>createHash('sha256').update(value).digest('hex');
  try{
    const names=()=>db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' AND name<>'__drizzle_migrations' ORDER BY name").all().map(row=>row.name);
    const shape=()=>names().map(name=>[name,db.prepare('SELECT name,type FROM pragma_table_info(?) ORDER BY cid').all(name)]);
    if(!reviewMinimisationSchema(db,shape()).accepted||names().includes('upload_requests'))throw new Error('Expected a reviewed pre-intake snapshot.');
    const quote=value=>'"'+value.replaceAll('"','""')+'"';
    const before=shape().map(([name,columns])=>({name,columns:columns.map(column=>column.name)}));
    const rows=table=>digest(JSON.stringify(db.prepare(`SELECT ${table.columns.map(quote).join(',')} FROM ${quote(table.name)} ORDER BY rowid`).all()));
    for(const table of before)table.digest=rows(table);
    const guards=new Map([[21,()=>!names().includes('personal_favorites')],[22,()=>!names().includes('library_events')],
      [23,()=>!names().includes('asset_scopes')],[24,()=>!db.prepare("SELECT name FROM pragma_table_info('publications') WHERE name='destination_scope_id'").get()],[25,()=>true]]);
    const journal=JSON.parse(await readFile('drizzle/meta/_journal.json','utf8')).entries;
    for(const entry of journal)if(guards.has(entry.idx)&&guards.get(entry.idx)())db.exec(await readFile(`drizzle/${entry.tag}.sql`,'utf8'));
    checkDatabase(db);
    for(const table of before)if(rows(table)!==table.digest)throw new Error('Existing rows changed during intake migration.');
    for(const name of ['upload_requests','intake_submissions','intake_upload_attempts','intake_capabilities'])if(db.prepare(`SELECT COUNT(*) n FROM ${name}`).get().n)throw new Error('Migration invented intake data.');
    if(!reviewMinimisationSchema(db,shape()).accepted)throw new Error('Intake minimisation schema is unreviewed.');
    const plan=planReadOnlySnapshot(db.prepare(schemaQuery).all()),restored=importSnapshot(restoreReadOnlySnapshot(plan,db.prepare(plan.sql).all()));
    try{
      sanitizeRestoredAccess(restored);checkDatabase(restored);
      const triggers=database=>JSON.stringify(database.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' ORDER BY name").all());
      if(triggers(db)!==triggers(restored))throw new Error('Restore changed protective triggers.');
      if(restored.prepare('SELECT COUNT(*) n FROM space_memberships WHERE revoked_at IS NULL').get().n)throw new Error('Restored access remains active.');
    }finally{restored.close();}
    return {status:'verified-local-intake-upgrade',existingTablesPreserved:before.length,noInvitationsCreated:true,restoredTriggersVerified:true,restoreQuarantineVerified:true,
      schemaDigest:digest(JSON.stringify(shape())),sourceDigest:digest(sql),remoteApplied:false};
  }finally{db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{console.log(JSON.stringify(await rehearseIntakeUpgrade(await readFile(process.argv[2],'utf8'))));}
  catch(error){console.error('Intake upgrade rehearsal failed: '+error.message);process.exitCode=1;}
}
