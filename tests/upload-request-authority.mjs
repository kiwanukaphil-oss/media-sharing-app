import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {planReadOnlySnapshot,restoreReadOnlySnapshot,schemaQuery} from '../scripts/backup-d1-readonly.mjs';
import {importSnapshot,sanitizeRestoredAccess} from '../scripts/relay-backup.mjs';

const bundle=await build({entryPoints:['lib/upload-request-authority.ts','lib/upload-request-reservations.ts','lib/upload-request-management.ts','lib/intake-transfers.ts','lib/intake-review.ts','lib/account-closure-fence.ts'],outdir:'unused',bundle:true,write:false,platform:'node',format:'esm'});
const modules=await Promise.all(bundle.outputFiles.map(file=>import(`data:text/javascript;base64,${Buffer.from(file.text).toString('base64')}`)));
const {acceptUploadRequest,intakeRecipientAuthority}=modules.find(module=>module.acceptUploadRequest);
const {activateUploadRequest,reserveIntakeSubmission}=modules.find(module=>module.activateUploadRequest);
const {createUploadRequestDraft,closeUploadRequest}=modules.find(module=>module.createUploadRequestDraft);
const {beginIntakeUpload,completeIntakeUpload,reserveIntakePartCapability}=modules.find(module=>module.beginIntakeUpload);
const {acceptIntakeOriginal}=modules.find(module=>module.acceptIntakeOriginal);
const {admitClosureTrackedWrite,settleClosureTrackedWrite}=modules.find(module=>module.admitClosureTrackedWrite);
const db=new DatabaseSync(':memory:'),now=Date.now();
try {
  for(const migration of JSON.parse(await readFile('drizzle/meta/_journal.json','utf8')).entries)db.exec(await readFile(`drizzle/${migration.tag}.sql`,'utf8'));
  db.exec(await readFile('docs/prototypes/upload-request-schema.sql','utf8'));
  db.exec("INSERT INTO spaces VALUES('shared','Receiving studio',1),('foreign','Other',1)");
  for(const person of ['owner','recipient','other']){
    db.prepare('INSERT INTO people(id,issuer,subject,display_name,verified_email,created_at) VALUES(?,?,?,?,?,?)').run(person,'https://fixture.invalid',person,person,person+'@example.invalid',now);
    db.prepare('INSERT INTO account_sessions(id,person_id,token_hash,configuration_hash,created_at,expires_at,authenticated_at) VALUES(?,?,?,?,?,?,?)').run(person,person,person,'fixture',now,now+3600000,now);
  }
  db.exec("INSERT INTO space_memberships(id,person_id,space_id,role,created_at) VALUES('owner','owner','shared','owner',1); INSERT INTO asset_scopes VALUES('private','shared','Never disclosed','owner',1); INSERT INTO scope_grants VALUES('private','owner','owner',1,NULL)");
  db.exec("INSERT INTO albums(id,space_id,name,created_at,access_scope_id) VALUES('album','shared','Private album',1,'private'); INSERT INTO album_sections(album_id,id,name,position) VALUES('album','section','Hidden section',0)");
  db.exec("INSERT INTO devices(id,space_id,name,token_hash,role,created_at,expires_at) VALUES('owner-device','shared','Owner','account-attribution:owner','owner',1,0); INSERT INTO account_space_actors VALUES('owner','owner-device')");
  const seed=db.prepare(`INSERT INTO upload_requests(id,token_hash,space_id,issuer_membership_id,recipient_email,title,album_id,section_id,access_scope_id,created_at,expires_at,max_files,max_file_bytes,max_bytes,state)
    VALUES(?,?,'shared','owner','recipient@example.invalid','Send event photos','album','section','private',?,?,20,1024,2048,?)`);
  seed.run('request','a'.repeat(64),now,now+86400000,'draft');
  seed.run('expired','b'.repeat(64),now-2000,now-1,'open');
  assert.throws(()=>seed.run('oversized','c'.repeat(64),now,now+604800001,'open'),/CHECK constraint/);
  assert.throws(()=>db.exec("UPDATE upload_requests SET access_scope_id=NULL WHERE id='request'"),/immutable/);
  const session=person=>({sessionId:person,personId:person,displayName:person,verifiedEmail:person+'@example.invalid',createdAt:now,expiresAt:now+3600000,sessionMode:'temporary'});
  const plan=planReadOnlySnapshot(db.prepare(schemaQuery).all()),snapshot=JSON.parse(db.prepare(plan.sql).get().snapshot);
  const runtime=new Miniflare(convertV4MiniflareOptions({workers:[{name:'intake-prototype',modules:true,script:'export default {fetch(){return new Response("fixture");}}',d1Databases:['DB'],r2Buckets:['BUCKET']}]}));
  try {
    const d1=await runtime.getD1Database('DB');
    for(const statement of plan.schema.filter(row=>row.type==='table'))await d1.prepare(statement.sql).run();
    await d1.batch([d1.prepare('PRAGMA defer_foreign_keys=ON'),...snapshot.tables.flatMap(table=>table.rows.map(statement=>d1.prepare(statement)))]);
    for(const statement of plan.schema.filter(row=>row.type!=='table'))await d1.prepare(statement.sql).run();
    await assert.rejects(acceptUploadRequest(d1,session('recipient'),'a'.repeat(64),now),/unavailable/,'A draft is not a capability.');
    // Test-only activation: production activation must first reserve the shared quota in the same transaction.
    await d1.prepare("UPDATE upload_requests SET state='open' WHERE id='request'").run();
    await assert.rejects(acceptUploadRequest(d1,session('other'),'a'.repeat(64),now),/unavailable/);
    await assert.rejects(acceptUploadRequest(d1,session('recipient'),'b'.repeat(64),now),/unavailable/);
    const accepted=await acceptUploadRequest(d1,session('recipient'),'a'.repeat(64),now);
    assert.equal(accepted.title,'Send event photos');assert.equal(accepted.receivingLibrary,'Receiving studio');
    assert.doesNotMatch(JSON.stringify(accepted),/Private album|Hidden section|Never disclosed|token_hash|recipient_email/);
    assert.equal((await d1.prepare('SELECT COUNT(*) AS n FROM space_memberships').first()).n,1,'Acceptance creates no membership.');
    assert.equal((await d1.prepare('SELECT COUNT(*) AS n FROM scope_grants').first()).n,1,'Acceptance creates no content audience grant.');
    // Concurrent invitations compete against the same quota used by every ordinary upload/copy.
    const owner={...session('owner'),id:'owner-device',space_id:'shared',space_name:'Studio',name:'Owner',role:'owner',authentication:'account',space_kind:'shared'};
    const drafts=[{id:crypto.randomUUID(),hash:'c'.repeat(64)},{id:crypto.randomUUID(),hash:'d'.repeat(64)}];
    for(const draft of drafts)await d1.prepare(`INSERT INTO upload_requests(id,token_hash,space_id,issuer_membership_id,recipient_email,title,album_id,section_id,access_scope_id,created_at,expires_at,max_files,max_file_bytes,max_bytes)
      VALUES(?,?,'shared','owner','recipient@example.invalid','Send files','album','section','private',?,?,2,1024,2048)`).bind(draft.id,draft.hash,now,now+86400000).run();
    const activations=await Promise.allSettled(drafts.map(draft=>activateUploadRequest(d1,owner,draft.id,3000,now)));
    assert.equal(activations.filter(result=>result.status==='fulfilled').length,1,'Two requests cannot reserve the same free bytes.');
    const winner=drafts[activations.findIndex(result=>result.status==='fulfilled')];
    assert.equal((await activateUploadRequest(d1,owner,winner.id,3000,now)).state,'open','Activation retries do not reserve twice.');
    await acceptUploadRequest(d1,session('recipient'),winner.hash,now);
    const file={id:crypto.randomUUID(),requestId:winner.id,name:'Original.bin',mime:'application/octet-stream',size:1024,sha256:'1'.repeat(64)};
    const charged=async()=>(await d1.prepare('SELECT SUM(size+preview_size) AS n FROM media').first()).n;
    assert.equal(await charged(),2048);
    await assert.rejects(reserveIntakeSubmission(d1,session('recipient'),{...file,size:1025},now),/limit/);
    const sameFile=await Promise.allSettled([reserveIntakeSubmission(d1,session('recipient'),file,now),reserveIntakeSubmission(d1,session('recipient'),file,now)]);
    assert.equal(sameFile.filter(result=>result.status==='fulfilled').length,2,'Concurrent exact retry returns the same reservation.');
    assert.equal((await d1.prepare('SELECT COUNT(*) AS n FROM intake_submissions').first()).n,1);
    assert.equal(await charged(),2048,'Submission replaces allowance without increasing or releasing total charged bytes.');
    await assert.rejects(reserveIntakeSubmission(d1,session('recipient'),{...file,sha256:'2'.repeat(64)},now),/intent/);
    await reserveIntakeSubmission(d1,session('recipient'),{...file,id:crypto.randomUUID()},now);
    await assert.rejects(reserveIntakeSubmission(d1,session('recipient'),{...file,id:crypto.randomUUID(),size:1},now),/limit/);
    assert.equal(await charged(),2048);assert.equal((await d1.prepare('SELECT size FROM media WHERE id=?').bind(winner.id).first()).size,0);
    assert.equal((await d1.prepare("SELECT COUNT(*) AS n FROM media WHERE status='ready'").first()).n,0,'Intake reservation never exposes a ready original.');
    assert.equal((await d1.prepare("SELECT expires_at FROM devices WHERE id=?").bind(winner.id).first()).expires_at,0,'Intake attribution cannot log in as a device.');
    // Owner draft/retry/close follows immutable reviewed intent; releasing unused allowance never
    // deletes staged originals. A failed custody insert must roll back both sides of the quota exchange.
    const generalAlbum=crypto.randomUUID();
    await d1.prepare("INSERT INTO albums(id,space_id,name,created_at) VALUES(?,'shared','General destination',?)").bind(generalAlbum,now).run();
    const draft={id:crypto.randomUUID(),tokenHash:'e'.repeat(64),title:'Reviewed collection',recipientEmail:'RECIPIENT@example.invalid',albumId:generalAlbum,sectionId:null,accessScopeId:null,expiresAt:now+86400000,maxFiles:2,maxFileBytes:1024,maxBytes:2048,confirmed:true};
    assert.equal((await createUploadRequestDraft(d1,owner,draft,now)).state,'draft');
    assert.equal((await createUploadRequestDraft(d1,owner,draft,now)).id,draft.id);
    await assert.rejects(createUploadRequestDraft(d1,owner,{...draft,title:'Different intent'},now),/changed/);
    await activateUploadRequest(d1,owner,draft.id,10000,now);
    await acceptUploadRequest(d1,session('recipient'),draft.tokenHash,now);
    const incoming={...file,id:crypto.randomUUID(),requestId:draft.id,size:512};
    await d1.prepare(`CREATE TRIGGER fail_intake_custody BEFORE INSERT ON intake_submissions WHEN NEW.request_id='${draft.id}' BEGIN SELECT RAISE(ABORT,'Fixture custody failure'); END`).run();
    await assert.rejects(reserveIntakeSubmission(d1,session('recipient'),incoming,now),/custody failure/);
    assert.equal((await d1.prepare('SELECT size FROM media WHERE id=?').bind(draft.id).first()).size,2048);
    assert.equal(await d1.prepare('SELECT id FROM media WHERE id=?').bind(incoming.id).first(),null);
    await d1.prepare('DROP TRIGGER fail_intake_custody').run();
    await reserveIntakeSubmission(d1,session('recipient'),incoming,now);
    const revision=(await d1.prepare('SELECT revision FROM upload_requests WHERE id=?').bind(draft.id).first()).revision;
    await assert.rejects(closeUploadRequest(d1,owner,draft.id,revision+1,now),/changed/);
    assert.equal(await charged(),4096);
    await closeUploadRequest(d1,owner,draft.id,revision,now);
    assert.equal(await charged(),2560,'Only 1536 unused bytes are released; both earlier originals and this staged file remain charged.');
    assert.equal((await d1.prepare('SELECT status FROM media WHERE id=?').bind(incoming.id).first()).status,'receiving');
    assert.equal((await closeUploadRequest(d1,owner,draft.id,revision,now)).changed,false);
    await assert.rejects(reserveIntakeSubmission(d1,session('recipient'),{...incoming,id:crypto.randomUUID()},now),/limit/);
    await d1.prepare("UPDATE people SET verified_email='recipient@example.invalid' WHERE id='other'").run();
    await assert.rejects(acceptUploadRequest(d1,session('other'),'a'.repeat(64),now),/unavailable/,'Matching email cannot rebind acceptance.');
    await d1.prepare("UPDATE people SET verified_email='changed@example.invalid' WHERE id='recipient'").run();
    assert.equal((await acceptUploadRequest(d1,session('recipient'),'a'.repeat(64),now)).id,'request');
    await d1.prepare("UPDATE account_sessions SET revoked_at=? WHERE id='recipient'").bind(now).run();
    await assert.rejects(acceptUploadRequest(d1,session('recipient'),'a'.repeat(64),now),/unavailable/);
    await d1.prepare("UPDATE account_sessions SET revoked_at=NULL WHERE id='recipient'").run();
    await d1.prepare("UPDATE people SET verified_email='recipient@example.invalid' WHERE id='recipient'").run();
    // Real R2 multipart transport stays outside the feed until streamed independent verification.
    const bucket=await runtime.getR2Bucket('BUCKET'),originalBytes=new Uint8Array([1,2,3,4]);
    const digest=Buffer.from(await crypto.subtle.digest('SHA-256',originalBytes)).toString('hex');
    const transferDraft={...draft,id:crypto.randomUUID(),tokenHash:'f'.repeat(64),maxFiles:4};
    await createUploadRequestDraft(d1,owner,transferDraft,now);await activateUploadRequest(d1,owner,transferDraft.id,10000,now);
    await acceptUploadRequest(d1,session('recipient'),transferDraft.tokenHash,now);
    const original={...file,id:crypto.randomUUID(),requestId:transferDraft.id,size:4,sha256:digest};
    await reserveIntakeSubmission(d1,session('recipient'),original,now);
    assert.equal((await beginIntakeUpload(d1,bucket,session('recipient'),original.id)).status,'uploading');
    const transport=await d1.prepare('SELECT object_key,upload_id FROM media WHERE id=?').bind(original.id).first();
    const admission=await admitClosureTrackedWrite(d1,{kind:'account',session:session('recipient')});
    const trackedSession={...session('recipient'),closureAdmissionId:admission.id};
    const capability=await reserveIntakePartCapability(d1,trackedSession,original.id,1);
    assert.equal(capability.expectedBytes,4);assert.equal(capability.expiresAt-capability.signedAt,60000);
    assert.equal(capability.objectKey,transport.object_key);assert.equal(capability.uploadId,transport.upload_id);
    assert.equal((await d1.prepare("SELECT COUNT(*) AS n FROM closure_storage_effects WHERE admission_id=? AND operation='multipart_capability' AND state='uncertain'").bind(admission.id).first()).n,1);
    await settleClosureTrackedWrite(d1,admission.id,'uncertain');
    await assert.rejects(reserveIntakePartCapability(d1,trackedSession,original.id,1),/unavailable/,'A settled/uncertain admission cannot issue another capability.');
    await assert.rejects(reserveIntakePartCapability(d1,session('recipient'),original.id,2),/available upload part/);
    const part=await bucket.resumeMultipartUpload(transport.object_key,transport.upload_id).uploadPart(1,originalBytes);
    assert.deepEqual(await completeIntakeUpload(d1,bucket,session('recipient'),original.id,[part]),{received:true,verified:false});
    assert.equal((await d1.prepare('SELECT status FROM media WHERE id=?').bind(original.id).first()).status,'pending-review');
    await acceptIntakeOriginal(d1,bucket,owner,original.id);
    assert.equal((await d1.prepare('SELECT status FROM media WHERE id=?').bind(original.id).first()).status,'ready');
    assert.equal((await d1.prepare('SELECT album_id FROM album_media WHERE media_id=?').bind(original.id).first()).album_id,generalAlbum);
    await acceptIntakeOriginal(d1,bucket,owner,original.id);
    assert.equal((await d1.prepare("SELECT COUNT(*) AS n FROM library_events WHERE action='file.arrive' AND resources LIKE ?").bind('%'+original.id+'%').first()).n,1);
    assert.deepEqual(new Uint8Array(await (await bucket.get(transport.object_key)).arrayBuffer()),originalBytes);
    const corrupt={...original,id:crypto.randomUUID(),sha256:'0'.repeat(64)};
    await reserveIntakeSubmission(d1,session('recipient'),corrupt,now);await beginIntakeUpload(d1,bucket,session('recipient'),corrupt.id);
    const corruptRow=await d1.prepare('SELECT object_key,upload_id FROM media WHERE id=?').bind(corrupt.id).first();
    const corruptPart=await bucket.resumeMultipartUpload(corruptRow.object_key,corruptRow.upload_id).uploadPart(1,originalBytes);
    await completeIntakeUpload(d1,bucket,session('recipient'),corrupt.id,[corruptPart]);
    await assert.rejects(acceptIntakeOriginal(d1,bucket,owner,corrupt.id),/checksum/);
    assert.equal((await d1.prepare('SELECT status FROM media WHERE id=?').bind(corrupt.id).first()).status,'pending-review');
    // Closing after R2 completion but before receipt cannot promote late bytes into review/the feed.
    const lateDraft={...draft,id:crypto.randomUUID(),tokenHash:'9'.repeat(64)};
    await createUploadRequestDraft(d1,owner,lateDraft,now);await activateUploadRequest(d1,owner,lateDraft.id,10000,now);await acceptUploadRequest(d1,session('recipient'),lateDraft.tokenHash,now);
    const late={...original,id:crypto.randomUUID(),requestId:lateDraft.id};await reserveIntakeSubmission(d1,session('recipient'),late,now);await beginIntakeUpload(d1,bucket,session('recipient'),late.id);
    const lateRow=await d1.prepare('SELECT object_key,upload_id FROM media WHERE id=?').bind(late.id).first();
    const latePart=await bucket.resumeMultipartUpload(lateRow.object_key,lateRow.upload_id).uploadPart(1,originalBytes);
    const closingBucket={head:key=>bucket.head(key),resumeMultipartUpload:(key,uploadId)=>({complete:async parts=>{
      const object=await bucket.resumeMultipartUpload(key,uploadId).complete(parts);
      const revision=(await d1.prepare('SELECT revision FROM upload_requests WHERE id=?').bind(lateDraft.id).first()).revision;
      await closeUploadRequest(d1,owner,lateDraft.id,revision);return object;
    }})};
    await assert.rejects(completeIntakeUpload(d1,closingBucket,session('recipient'),late.id,[latePart]),/request changed/);
    assert.equal((await d1.prepare('SELECT status FROM media WHERE id=?').bind(late.id).first()).status,'receiving');
    assert.ok(await bucket.head(lateRow.object_key),'Late bytes retain their custody record for reconciliation, never a false erased claim.');
    await assert.rejects(reserveIntakePartCapability(d1,session('recipient'),late.id,1),/unavailable/);
    // An owner losing authority while reading bytes must not commit visibility or an album reference.
    const racing={...original,id:crypto.randomUUID()};await reserveIntakeSubmission(d1,session('recipient'),racing,now);await beginIntakeUpload(d1,bucket,session('recipient'),racing.id);
    const raceRow=await d1.prepare('SELECT object_key,upload_id FROM media WHERE id=?').bind(racing.id).first();
    const racePart=await bucket.resumeMultipartUpload(raceRow.object_key,raceRow.upload_id).uploadPart(1,originalBytes);await completeIntakeUpload(d1,bucket,session('recipient'),racing.id,[racePart]);
    const racingBucket={get:async key=>{const object=await bucket.get(key);await d1.prepare("UPDATE space_memberships SET role='viewer' WHERE id='owner'").run();return object;}};
    await assert.rejects(acceptIntakeOriginal(d1,racingBucket,owner,racing.id),/access changed/);
    assert.equal((await d1.prepare('SELECT status FROM media WHERE id=?').bind(racing.id).first()).status,'pending-review');
    assert.equal(await d1.prepare('SELECT media_id FROM album_media WHERE media_id=?').bind(racing.id).first(),null);
    await d1.prepare("UPDATE space_memberships SET role='owner' WHERE id='owner'").run();
    await d1.prepare("UPDATE scope_grants SET revoked_at=? WHERE scope_id='private'").bind(now).run();
    await d1.prepare("UPDATE scope_grants SET revoked_at=NULL WHERE scope_id='private'").run();
    await assert.rejects(acceptUploadRequest(d1,session('recipient'),'a'.repeat(64),now),/unavailable/,'Restoring issuer access cannot revive a revoked request.');
    const exported=await d1.prepare(plan.sql).all(),restoredIntake=importSnapshot(restoreReadOnlySnapshot(plan,exported.results));
    try{
      sanitizeRestoredAccess(restoredIntake,now+1000);
      assert.equal(restoredIntake.prepare('SELECT COUNT(*) AS n FROM upload_requests WHERE revoked_at IS NULL').get().n,0);
      assert.equal(restoredIntake.prepare('SELECT COUNT(*) AS n FROM intake_capabilities').get().n,1,'Restore retains exact outstanding capability custody.');
      assert.equal(restoredIntake.prepare("SELECT status FROM media WHERE id=?").get(original.id).status,'ready');
    }finally{restoredIntake.close();}
  } finally {await runtime.dispose();}
  db.exec("UPDATE upload_requests SET state='open',accepted_by='recipient',accepted_at=1 WHERE id='request'");
  const authority=intakeRecipientAuthority(session('recipient'),now);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM upload_requests WHERE ${authority.sql}`).get(...authority.bindings).n,1);
  db.exec("UPDATE album_sections SET deleted_at=2 WHERE id='section'; UPDATE album_sections SET deleted_at=NULL WHERE id='section'");
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM upload_requests WHERE ${authority.sql}`).get(...authority.bindings).n,0);
  const restorePlan=planReadOnlySnapshot(db.prepare(schemaQuery).all()),restored=importSnapshot(restoreReadOnlySnapshot(restorePlan,db.prepare(restorePlan.sql).all()));
  try{sanitizeRestoredAccess(restored,now+1);assert.equal(restored.prepare('SELECT COUNT(*) AS n FROM upload_requests WHERE revoked_at IS NULL').get().n,0);}
  finally{restored.close();}
  console.log('PASS: isolated SQLite/D1 intake invitation binding, no membership/disclosure, draft/expiry/session denial, immutable destination, non-resurrecting grants and restore quarantine. Atomic quota, multipart receipt, capability custody, closure races and verified acceptance pass; production intake remains disabled.');
} finally {db.close();}
