import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { reviewRestoredBackupRuns } from '../scripts/review-restored-backup-runs.mjs';
import { backupBucketId, backupPrefix } from '../scripts/backup-storage.mjs';

const database=new DatabaseSync(':memory:');
const id=randomUUID(),snapshotId=`2026-09-22T08-11-23-130Z-${randomUUID()}`;
const prefix=`relay/snapshots/${snapshotId}/`;
const manifest={action:'upload',fileId:'manifest',fileName:`${prefix}manifest.json`,sha256:'a'.repeat(64),size:100};
const text=JSON.stringify({snapshotId,status:'copied-awaiting-restore',coordination:{formatVersion:1,runId:id},manifest});
const receiptDigest=createHash('sha256').update(text).digest('hex');
const run={id,snapshotId,state:'settled',receiptDigest};
const catalog={listingComplete:true,bucketId:backupBucketId,prefix:backupPrefix,unfinished:[],versions:[manifest,
  {action:'upload',fileId:'receipt',fileName:`${prefix}copy-receipt.json`,sha256:receiptDigest,size:Buffer.byteLength(text)}]};
try {
  const journal=JSON.parse(await readFile('drizzle/meta/_journal.json','utf8')).entries;
  for(const migration of journal)database.exec(await readFile(`drizzle/${migration.tag}.sql`,'utf8'));
  database.prepare("INSERT INTO closure_write_admissions(id,kind,generation,state,started_at) VALUES(?,'backup',0,'active',1)").run(id);
  database.prepare('INSERT INTO closure_backup_runs VALUES(?,?,NULL,1)').run(id,snapshotId);
  const before=database.prepare('SELECT total_changes() n').get().n;
  for(const state of ['active','uncertain','settled']) {
    database.prepare('UPDATE closure_write_admissions SET state=?').run(state);
    const changes=database.prepare('SELECT total_changes() n').get().n;
    const result=await reviewRestoredBackupRuns(database,async()=>run,catalog,async()=>text);
    assert.equal(result.runs[0].historicalState,state);
    assert.equal(result.runs[0].receiptDigest,receiptDigest);
    assert.equal(result.quiescenceProven,false);assert.equal(result.cutoverAllowed,false);
    assert.equal(database.prepare('SELECT total_changes() n').get().n,changes);
    assert.equal(database.prepare('SELECT state FROM closure_write_admissions').get().state,state);
  }
  assert.equal(database.prepare('SELECT total_changes() n').get().n,before+3);
  await assert.rejects(reviewRestoredBackupRuns(database,async()=>({...run,state:'active'}),catalog,async()=>text));
  const alternateId=randomUUID();
  const alternateText=JSON.stringify({...JSON.parse(text),coordination:{formatVersion:1,runId:alternateId}});
  const alternateDigest=createHash('sha256').update(alternateText).digest('hex');
  const alternateCatalog={...catalog,versions:[manifest,{...catalog.versions[1],sha256:alternateDigest,size:Buffer.byteLength(alternateText)}]};
  await assert.rejects(reviewRestoredBackupRuns(database,async()=>({...run,id:alternateId,receiptDigest:alternateDigest}),
    alternateCatalog,async()=>alternateText),/differs from restored binding/);
  database.prepare('UPDATE closure_backup_runs SET receipt_digest=?').run('b'.repeat(64));
  await assert.rejects(reviewRestoredBackupRuns(database,async()=>run,catalog,async()=>text),/conflicts/);
  database.prepare('UPDATE closure_backup_runs SET receipt_digest=NULL').run();
  let changed=false;
  await assert.rejects(reviewRestoredBackupRuns(database,async()=>{
    if(!changed){changed=true;database.prepare("UPDATE closure_write_admissions SET state='uncertain'").run();}
    return run;
  },catalog,async()=>text),/inventory changed/);
  database.prepare("INSERT INTO closure_write_admissions(id,kind,generation,state,started_at) VALUES(?,'backup',0,'active',1)").run(randomUUID());
  await assert.rejects(reviewRestoredBackupRuns(database,async()=>run,catalog,async()=>text),/bindings/);
  console.log('PASS: historical active/uncertain backups reconcile against independent receipts without altering restored rows, conflicting evidence or lifting quarantine.');
} finally {database.close();}
