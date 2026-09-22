import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';

const bundle=await build({entryPoints:['lib/account-closure-fence.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const fence=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const storageBundle=await build({entryPoints:['lib/closure-tracked-bucket.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {createClosureTrackedBucket}=await import(`data:text/javascript;base64,${Buffer.from(storageBundle.outputFiles[0].text).toString('base64')}`);
const requestBundle=await build({entryPoints:['lib/closure-tracked-request.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {runClosureTrackedRequest}=await import(`data:text/javascript;base64,${Buffer.from(requestBundle.outputFiles[0].text).toString('base64')}`);
const identityBundle=await build({entryPoints:['lib/account-sessions.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {createAccountSession}=await import(`data:text/javascript;base64,${Buffer.from(identityBundle.outputFiles[0].text).toString('base64')}`);
const runtime=new Miniflare(convertV4MiniflareOptions({workers:[{name:'closure-protocol-test',modules:true,
  script:'export default { fetch() { return new Response("isolated"); } }',d1Databases:['DB'],r2Buckets:['MEDIA']}]}));
const now=Date.now(),issuer='https://closure.fixture/';
try {
  const database=await runtime.getD1Database('DB');
  const migrations=JSON.parse(await readFile('drizzle/meta/_journal.json','utf8')).entries;
  for(const path of [...migrations.map(row=>`drizzle/${row.tag}.sql`),'deploy/closure-fence-prototype.sql'])
    for(const sql of (await readFile(path,'utf8')).split('--> statement-breakpoint'))if(sql.trim())await database.prepare(sql).run();
  // Seed only disposable identities in this isolated actual-schema D1; no live key or account is used.
  async function createPerson(label) {
    const personId=crypto.randomUUID(),sessionId=crypto.randomUUID(),requestId=crypto.randomUUID();
    await database.batch([
      database.prepare('INSERT INTO people(id,issuer,subject,display_name,verified_email,created_at) VALUES(?,?,?,?,?,?)').bind(personId,issuer,label,label,`${label}@example.test`,now),
      database.prepare('INSERT INTO account_sessions(id,person_id,token_hash,configuration_hash,created_at,expires_at,authenticated_at) VALUES(?,?,?,?,?,?,?)')
        .bind(sessionId,personId,sessionId,'fixture',now,now+60000,now),
      database.prepare("INSERT INTO account_deletion_requests VALUES(?,?,?,'pending',?)").bind(requestId,personId,now-100,now-100),
    ]);
    return {personId,sessionId,requestId,subject:label};
  }
  const [owner,other,independent]=await Promise.all(['owner','other','independent'].map(createPerson));
  const space=crypto.randomUUID(),membership=crypto.randomUUID(),otherMembership=crypto.randomUUID(),legacy=crypto.randomUUID(),unrelatedLegacy=crypto.randomUUID();
  await database.batch([
    database.prepare('INSERT INTO spaces VALUES(?,?,?)').bind(space,'Shared fixture',now),
    database.prepare("INSERT INTO space_memberships(id,person_id,space_id,role,created_at) VALUES(?,?,?,'owner',?)").bind(membership,owner.personId,space,now),
    database.prepare("INSERT INTO space_memberships(id,person_id,space_id,role,created_at) VALUES(?,?,?,'owner',?)").bind(otherMembership,other.personId,space,now),
    database.prepare('INSERT INTO devices(id,space_id,name,token_hash,created_at,expires_at) VALUES(?,?,?,?,?,?)').bind(legacy,space,'Linked',legacy,now,now+60000),
    database.prepare('INSERT INTO devices(id,space_id,name,token_hash,created_at,expires_at) VALUES(?,?,?,?,?,?)').bind(unrelatedLegacy,space,'Unrelated',unrelatedLegacy,now,now+60000),
    database.prepare('INSERT INTO legacy_owner_claims VALUES(?,?,?,?)').bind(legacy,membership,owner.sessionId,now),
  ]);
  const approval=person=>({id:crypto.randomUUID(),personId:person.personId,requestId:person.requestId,requestRevision:now-100,
    issuer,subject:person.subject,planDigest:'a'.repeat(64),decisionDigest:'b'.repeat(64),approvalDigest:'c'.repeat(64),authorisedAt:now});
  const ownerApproval=approval(owner);
  const [activeAccount,activeLegacy,activeBackup,activeOther]=await Promise.all([
    fence.admitClosureTrackedWrite(database,{kind:'account',session:owner},now),
    fence.admitClosureTrackedWrite(database,{kind:'legacy',deviceId:legacy,spaceId:space},now),
    fence.admitClosureTrackedWrite(database,{kind:'backup'},now),
    fence.admitClosureTrackedWrite(database,{kind:'account',session:other},now),
  ]);
  const commit=async admission=>{
    const guard=fence.closureAdmissionAuthority(admission.id);
    return (await database.prepare(`UPDATE spaces SET name='Still shared' WHERE id=? AND ${guard.sql}`).bind(space,...guard.bindings).run()).meta.changes;
  };
  assert.equal(await commit(activeAccount),1);
  const storage=await runtime.getR2Bucket('MEDIA');
  // Concurrent request adapters keep separate admissions; ambiguous/capability responses retain custody.
  const requestPerson=await createPerson('request');
  const requestActor={kind:'account',session:requestPerson};
  const requestIds=await Promise.all(['one','two'].map(label=>runClosureTrackedRequest(database,storage,requestActor,async(tracked,id)=>{
    await tracked.put(`fixture/request-${label}`,label);return id;
  })));
  assert.notEqual(requestIds[0],requestIds[1]);
  for(const id of requestIds)assert.equal((await database.prepare('SELECT state FROM closure_write_admissions WHERE id=?').bind(id).first()).state,'settled');
  let failedRequest;
  await assert.rejects(runClosureTrackedRequest(database,storage,requestActor,async(tracked,id)=>{
    failedRequest=id;await tracked.put('fixture/request-failed','retained');throw new Error('request interrupted');
  }),/interrupted/);
  assert.equal((await database.prepare('SELECT state FROM closure_write_admissions WHERE id=?').bind(failedRequest).first()).state,'uncertain');
  const capabilityRequest=await runClosureTrackedRequest(database,storage,requestActor,async(_tracked,id)=>{
    await fence.reserveClosureUploadCapability(database,id,{objectKey:'fixture/request-capability',uploadId:'pending',partNumber:1,expiresAt:Date.now()+60000});
    return {id,response:'issued'};
  });
  assert.equal(capabilityRequest.response,'issued');
  assert.equal((await database.prepare('SELECT state FROM closure_write_admissions WHERE id=?').bind(capabilityRequest.id).first()).state,'uncertain');
  // Exercise the actual R2 interface through the adapter, including handles retained across a fence.
  const adapterPerson=await createPerson('adapter');
  const adapterAdmission=await fence.admitClosureTrackedWrite(database,{kind:'account',session:adapterPerson},now);
  const tracked=createClosureTrackedBucket(database,adapterAdmission.id,storage);
  const adapterKey='fixture/adapter';
  await tracked.put(adapterKey,'original',{httpMetadata:{contentType:'text/plain'}});
  assert.equal(await (await tracked.get(adapterKey)).text(),'original');
  assert.equal((await tracked.head(adapterKey)).httpMetadata.contentType,'text/plain');
  assert.ok((await tracked.list({prefix:adapterKey})).objects.length);
  assert.equal(await tracked.put(adapterKey,'denied',{onlyIf:{etagMatches:'wrong'}}),null);
  assert.equal(await (await tracked.get(adapterKey)).text(),'original');
  const adapterMultipart=await tracked.createMultipartUpload('fixture/adapter-multipart');
  const resumed=tracked.resumeMultipartUpload(adapterMultipart.key,adapterMultipart.uploadId);
  await assert.rejects(resumed.uploadPart(0,'invalid'),/target/);
  const part=await resumed.uploadPart(1,'multipart bytes');
  await resumed.complete([part]);
  assert.equal(await (await tracked.get(adapterMultipart.key)).text(),'multipart bytes');
  const pendingMultipart=await tracked.createMultipartUpload('fixture/adapter-abort');
  await pendingMultipart.abort();
  await tracked.delete([adapterKey,adapterMultipart.key]);
  assert.equal(await storage.head(adapterKey),null);
  const adapterEffects=(await database.prepare('SELECT operation,upload_id,part_number,state FROM closure_storage_effects WHERE admission_id=?').bind(adapterAdmission.id).all()).results;
  assert.equal(adapterEffects.length,9);
  assert.ok(adapterEffects.every(row=>row.state==='acknowledged'));
  assert.equal(adapterEffects.find(row=>row.operation==='multipart_part').part_number,1);
  assert.equal(adapterEffects.find(row=>row.operation==='multipart_part').upload_id,adapterMultipart.uploadId);
  const retainedHandle=await tracked.createMultipartUpload('fixture/adapter-fenced');
  await fence.beginApprovedClosureFence(database,approval(adapterPerson),now);
  await assert.rejects(retainedHandle.uploadPart(1,'late'),/Closure/);
  await assert.rejects(tracked.put('fixture/adapter-denied','late'),/Closure/);
  assert.equal(await storage.head('fixture/adapter-denied'),null);
  assert.equal((await database.prepare('SELECT COUNT(*) AS n FROM closure_storage_effects WHERE admission_id=?').bind(adapterAdmission.id).first()).n,10);
  let releaseStorage, announceDispatch;
  const dispatched=new Promise(resolve=>{announceDispatch=resolve;});
  const paused=new Promise(resolve=>{releaseStorage=resolve;});
  // Pause after durable admission, then let an actual isolated R2 write arrive after the fence.
  const lateWrite=fence.runClosureStorageEffect(database,activeAccount.id,{objectKey:'fixture/late-preview',operation:'put'},async()=>{
    announceDispatch();await paused;
    await storage.put('fixture/late-preview','generated fixture');return {value:'stored'};
  },now);
  await dispatched;
  await assert.rejects(fence.settleClosureTrackedWrite(database,activeAccount.id,'settled',now),/review/);
  const started=await fence.beginApprovedClosureFence(database,ownerApproval,now);
  assert.equal(started.id,ownerApproval.id);assert.equal(started.generation,1);
  const frozenProfile=await database.prepare('SELECT * FROM people WHERE id=?').bind(owner.personId).first();
  const frozenSessionCount=(await database.prepare('SELECT COUNT(*) AS n FROM account_sessions WHERE person_id=?').bind(owner.personId).first()).n;
  await assert.rejects(createAccountSession(database,{issuer,clientId:'fixture',clientSecret:'fixture',appOrigin:'https://closure.fixture'},
    {issuer,subject:owner.subject,displayName:'Late provider profile',verifiedEmail:'late@example.invalid',authenticatedAt:now,credentialsChangedAt:0},null,now),/unavailable/);
  assert.deepEqual(await database.prepare('SELECT * FROM people WHERE id=?').bind(owner.personId).first(),frozenProfile);
  assert.equal((await database.prepare('SELECT COUNT(*) AS n FROM account_sessions WHERE person_id=?').bind(owner.personId).first()).n,frozenSessionCount);
  assert.deepEqual(await fence.beginApprovedClosureFence(database,ownerApproval,now+1),started,'Exact fence retry is idempotent');
  for(const active of [activeAccount,activeLegacy,activeBackup])assert.equal(await commit(active),0);
  assert.equal(await commit(activeOther),1);
  assert.equal((await fence.inspectClosureFence(database,started.id)).unresolvedWrites,3);
  let forbiddenDispatch=false;
  await assert.rejects(fence.runClosureStorageEffect(database,activeAccount.id,{objectKey:'fixture/denied',operation:'put'},async()=>{
    forbiddenDispatch=true;return {value:null};
  },now),/Closure/);
  assert.equal(forbiddenDispatch,false);
  releaseStorage();assert.equal(await lateWrite,'stored');
  assert.equal(await (await storage.get('fixture/late-preview')).text(),'generated fixture');
  const effect=await database.prepare('SELECT object_key,state FROM closure_storage_effects WHERE admission_id=?').bind(activeAccount.id).first();
  assert.equal(effect.object_key,'fixture/late-preview');assert.equal(effect.state,'acknowledged');
  assert.equal(await commit(activeAccount),0,'Late storage acknowledgement never restores metadata authority');
  await assert.rejects(fence.runClosureStorageEffect(database,activeOther.id,{objectKey:'fixture/ambiguous',operation:'put'},async()=>{
    await storage.put('fixture/ambiguous','response lost');throw new Error('lost response');
  },now),/lost response/);
  await assert.rejects(fence.settleClosureTrackedWrite(database,activeOther.id,'settled',now),/review/);
  assert.equal((await database.prepare('SELECT state FROM closure_storage_effects WHERE admission_id=?').bind(activeOther.id).first()).state,'uncertain');
  for(const actor of [{kind:'account',session:owner},{kind:'legacy',deviceId:legacy,spaceId:space},{kind:'backup'}])
    await assert.rejects(fence.admitClosureTrackedWrite(database,actor,now),/closure|access/);
  assert.ok(await fence.admitClosureTrackedWrite(database,{kind:'legacy',deviceId:unrelatedLegacy,spaceId:space},now));
  assert.equal((await database.prepare('SELECT revoked_at FROM account_sessions WHERE id=?').bind(owner.sessionId).first()).revoked_at,now);
  assert.equal((await database.prepare('SELECT disabled_at FROM people WHERE id=?').bind(other.personId).first()).disabled_at,null);
  assert.equal((await database.prepare('SELECT revoked_at FROM devices WHERE id=?').bind(unrelatedLegacy).first()).revoked_at,null);
  await assert.rejects(fence.beginApprovedClosureFence(database,approval(other),now),/ownership/,'Last shared owner cannot close');
  await fence.settleClosureTrackedWrite(database,activeAccount.id,'settled',now+1);
  await fence.settleClosureTrackedWrite(database,activeLegacy.id,'uncertain',now+1);
  await fence.settleClosureTrackedWrite(database,activeBackup.id,'settled',now+1);
  assert.equal((await fence.inspectClosureFence(database,started.id)).unresolvedWrites,1);
  await assert.rejects(fence.settleClosureTrackedWrite(database,activeLegacy.id,'settled',now+86400000),/review/,'Uncertain effects cannot be cleared by timeout');
  const independentApproval=approval(independent);
  const multipartAdmission=await fence.admitClosureTrackedWrite(database,{kind:'account',session:independent},now);
  const upload=await fence.runClosureStorageEffect(database,multipartAdmission.id,{objectKey:'fixture/multipart',operation:'multipart_create'},async()=>{
    const created=await storage.createMultipartUpload('fixture/multipart');return {value:created,uploadId:created.uploadId};
  },now);
  assert.equal((await database.prepare('SELECT upload_id FROM closure_storage_effects WHERE admission_id=?').bind(multipartAdmission.id).first()).upload_id,upload.uploadId);
  await fence.runClosureStorageEffect(database,multipartAdmission.id,{objectKey:'fixture/multipart',operation:'multipart_abort',uploadId:upload.uploadId},async()=>{
    await upload.abort();return {value:null};
  },now);
  await fence.settleClosureTrackedWrite(database,multipartAdmission.id,'settled',now);
  const lostAcknowledgement=await fence.admitClosureTrackedWrite(database,{kind:'account',session:other},now);
  await database.prepare("CREATE TRIGGER lose_storage_ack BEFORE UPDATE ON closure_storage_effects WHEN NEW.state='acknowledged' BEGIN SELECT RAISE(ABORT,'acknowledgement unavailable'); END").run();
  await assert.rejects(fence.runClosureStorageEffect(database,lostAcknowledgement.id,{objectKey:'fixture/lost-ack',operation:'put'},async()=>{
    await storage.put('fixture/lost-ack','generated');return {value:null};
  },now),/acknowledgement unavailable/);
  await database.prepare('DROP TRIGGER lose_storage_ack').run();
  await assert.rejects(fence.settleClosureTrackedWrite(database,lostAcknowledgement.id,'settled',now),/review/);
  for(const altered of [{requestRevision:now-99},{subject:'wrong'},{authorisedAt:now-300001}])
    await assert.rejects(fence.beginApprovedClosureFence(database,{...independentApproval,...altered},now));
  await database.prepare("UPDATE account_deletion_requests SET status='withdrawn' WHERE id=?").bind(independent.requestId).run();
  await assert.rejects(fence.beginApprovedClosureFence(database,independentApproval,now),/Intent/);
  await database.prepare("UPDATE account_deletion_requests SET status='pending' WHERE id=?").bind(independent.requestId).run();
  await database.prepare(`CREATE TRIGGER interrupt_fence BEFORE UPDATE ON people WHEN NEW.id='${independent.personId}' BEGIN SELECT RAISE(ABORT,'simulated fence interruption'); END`).run();
  await assert.rejects(fence.beginApprovedClosureFence(database,independentApproval,now),/interruption/);
  assert.equal(await database.prepare('SELECT 1 FROM closure_fences WHERE id=?').bind(independentApproval.id).first(),null);
  assert.equal((await database.prepare('SELECT disabled_at FROM people WHERE id=?').bind(independent.personId).first()).disabled_at,null);
  await database.prepare('DROP TRIGGER interrupt_fence').run();
  const directAdmission=await fence.admitClosureTrackedWrite(database,{kind:'account',session:independent},now);
  const capability={objectKey:'fixture/direct',uploadId:'isolated-upload',partNumber:1,expiresAt:now+3600000};
  const capabilityReceipt=await fence.reserveClosureUploadCapability(database,directAdmission.id,capability,now);
  const capabilityRow=await database.prepare('SELECT object_key,upload_id,part_number,capability_expires_at,state FROM closure_storage_effects WHERE id=?').bind(capabilityReceipt.id).first();
  assert.deepEqual(capabilityRow,{object_key:capability.objectKey,upload_id:capability.uploadId,part_number:1,capability_expires_at:capability.expiresAt,state:'uncertain'});
  for(const changed of [{partNumber:0},{partNumber:10001},{uploadId:''},{expiresAt:now},{expiresAt:now+3600001}])
    await assert.rejects(fence.reserveClosureUploadCapability(database,directAdmission.id,{...capability,...changed},now),/bounded/);
  assert.equal((await fence.beginApprovedClosureFence(database,independentApproval,now)).id,independentApproval.id);
  await assert.rejects(fence.reserveClosureUploadCapability(database,directAdmission.id,capability,now),/Closure/);
  await assert.rejects(fence.settleClosureTrackedWrite(database,directAdmission.id,'settled',now+86400000),/review/,'Expired capabilities remain unresolved');
  const drained=await fence.inspectClosureFence(database,independentApproval.id);
  assert.equal(drained.trackedWritesDrained,false);assert.equal(drained.unresolvedWrites,1);assert.equal(drained.executable,false);
  console.log('PASS: atomic D1 closure fence, scoped revocation, generation commit denial, stalled R2 late-write tracking, multipart allocation custody, lost response/acknowledgement retention and guarded settlement. Prototype only; no production migration or closure.');
} finally {await runtime.dispose();}
