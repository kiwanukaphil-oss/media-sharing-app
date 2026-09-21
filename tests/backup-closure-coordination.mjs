import assert from 'node:assert/strict';
import { randomUUID,createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';

const bundle=await build({entryPoints:['lib/backup-closure-coordination.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {acceptBackupCoordination}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const runtime=new Miniflare(convertV4MiniflareOptions({workers:[{name:'backup-coordination-fixture',modules:true,
  script:'export default {fetch(){return new Response("isolated");}}',d1Databases:['DB']}]}));
const now=Date.now(),secret='a'.repeat(64),id=randomUUID(),snapshotId=`${new Date(now).toISOString().replace(/[:.]/g,'-')}-${randomUUID()}`;
function signed(command,alter={}) {
  const body=JSON.stringify(command),timestamp=String(alter.timestamp??now);
  const signature=createHmac('sha256',alter.secret??secret).update(`relay-backup-coordination-v1.${timestamp}.${body}`).digest('hex');
  return new Request('https://fixture.invalid/coordination',{method:'POST',body:alter.body??body,headers:{
    'X-Relay-Backup-Time':timestamp,'X-Relay-Backup-Signature':signature,...alter.headers}});
}
try {
  const database=await runtime.getD1Database('DB');
  const migrations=JSON.parse(await readFile('drizzle/meta/_journal.json','utf8')).entries;
  for(const path of [...migrations.map(row=>`drizzle/${row.tag}.sql`),'deploy/closure-fence-prototype.sql'])
    for(const sql of (await readFile(path,'utf8')).split('--> statement-breakpoint'))if(sql.trim())await database.prepare(sql).run();
  const begin={action:'begin',id,snapshotId};
  for(const altered of [{secret:'b'.repeat(64)},{timestamp:now-300001},{body:'{}'},{headers:{Origin:'https://fixture.invalid'}},{body:'x'.repeat(2049)}])
    await assert.rejects(acceptBackupCoordination(signed(begin,altered),database,secret,now),/verified/);
  await assert.rejects(acceptBackupCoordination(signed({...begin,personId:'unexpected'}),database,secret,now),/verified/);
  assert.equal((await (await acceptBackupCoordination(signed(begin),database,secret,now)).json()).state,'active');
  await acceptBackupCoordination(signed(begin),database,secret,now);
  assert.equal((await database.prepare('SELECT COUNT(*) AS n FROM closure_write_admissions').first()).n,1);
  await assert.rejects(acceptBackupCoordination(signed({...begin,id:randomUUID()}),database,secret,now),/changed/);
  assert.equal((await database.prepare('SELECT COUNT(*) AS n FROM closure_write_admissions').first()).n,1,'Conflicting snapshot cannot create an orphan admission');
  const completed={action:'begin',id:randomUUID(),snapshotId:`${new Date(now+2).toISOString().replace(/[:.]/g,'-')}-${randomUUID()}`};
  await database.prepare("CREATE TRIGGER interrupt_backup BEFORE INSERT ON closure_backup_runs BEGIN SELECT RAISE(ABORT,'backup interruption'); END").run();
  await assert.rejects(acceptBackupCoordination(signed(completed),database,secret,now),/backup interruption/);
  assert.equal(await database.prepare('SELECT 1 FROM closure_write_admissions WHERE id=?').bind(completed.id).first(),null);
  await database.prepare('DROP TRIGGER interrupt_backup').run();
  await acceptBackupCoordination(signed(completed),database,secret,now);
  const effect=randomUUID();
  await database.prepare("INSERT INTO closure_storage_effects(id,admission_id,object_key,operation,state,started_at) VALUES(?,?,?,'put','active',?)")
    .bind(effect,completed.id,'fixture/backup',now).run();
  const completedReceipt={...completed,action:'settle',outcome:'settled',receiptDigest:'f'.repeat(64)};
  await assert.rejects(acceptBackupCoordination(signed(completedReceipt),database,secret,now),/changed/);
  assert.equal((await database.prepare('SELECT receipt_digest FROM closure_backup_runs WHERE id=?').bind(completed.id).first()).receipt_digest,null);
  await database.prepare("UPDATE closure_storage_effects SET state='acknowledged' WHERE id=?").bind(effect).run();
  // Seed a closure directly in this isolated database, then prove ordering and post-fence drain semantics.
  const person=randomUUID(),request=randomUUID();
  await database.batch([
    database.prepare('INSERT INTO people(id,issuer,subject,display_name,verified_email,created_at) VALUES(?,?,?,?,?,?)').bind(person,'https://fixture.invalid/','fixture','Fixture','fixture@example.invalid',now),
    database.prepare("INSERT INTO account_deletion_requests VALUES(?,?,?,'review_required',?)").bind(request,person,now,now),
    database.prepare("INSERT INTO closure_fences VALUES(?,?,?,1,1,'draining',?,?,?,?)").bind(randomUUID(),person,request,'a'.repeat(64),'b'.repeat(64),'c'.repeat(64),now),
  ]);
  await assert.rejects(acceptBackupCoordination(signed({...begin,id:randomUUID(),snapshotId:snapshotId.replace(id,'')+'x'}),database,secret,now),/verified/);
  const later={action:'begin',id:randomUUID(),snapshotId:`${new Date(now+1).toISOString().replace(/[:.]/g,'-')}-${randomUUID()}`};
  await assert.rejects(acceptBackupCoordination(signed(later),database,secret,now),/changed/);
  await acceptBackupCoordination(signed(completedReceipt),database,secret,now);
  await acceptBackupCoordination(signed(completedReceipt),database,secret,now);
  await assert.rejects(acceptBackupCoordination(signed(completed),database,secret,now),/changed/);
  await acceptBackupCoordination(signed(begin),database,secret,now);
  const settle={action:'settle',id,snapshotId,outcome:'uncertain',receiptDigest:'d'.repeat(64)};
  await acceptBackupCoordination(signed(settle),database,secret,now);
  await acceptBackupCoordination(signed(settle),database,secret,now);
  await assert.rejects(acceptBackupCoordination(signed({...settle,outcome:'settled'}),database,secret,now),/changed/);
  await assert.rejects(acceptBackupCoordination(signed({...settle,receiptDigest:'e'.repeat(64)}),database,secret,now),/changed/);
  await assert.rejects(acceptBackupCoordination(signed(begin),database,secret,now),/changed/);
  assert.equal((await database.prepare('SELECT state FROM closure_write_admissions WHERE id=?').bind(id).first()).state,'uncertain');
  console.log('PASS: bounded dedicated HMAC capability, stable backup admission/retry, snapshot collision refusal, closure admission denial, acknowledged drain and permanent uncertainty. Isolated only.');
} finally {await runtime.dispose();}
