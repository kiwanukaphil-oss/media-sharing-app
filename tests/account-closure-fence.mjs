import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';

const bundle=await build({entryPoints:['lib/account-closure-fence.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const fence=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const runtime=new Miniflare(convertV4MiniflareOptions({workers:[{name:'closure-protocol-test',modules:true,
  script:'export default { fetch() { return new Response("isolated"); } }',d1Databases:['DB']}]}));
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
  const started=await fence.beginApprovedClosureFence(database,ownerApproval,now);
  assert.equal(started.id,ownerApproval.id);assert.equal(started.generation,1);
  assert.deepEqual(await fence.beginApprovedClosureFence(database,ownerApproval,now+1),started,'Exact fence retry is idempotent');
  for(const active of [activeAccount,activeLegacy,activeBackup])assert.equal(await commit(active),0);
  assert.equal(await commit(activeOther),1);
  assert.equal((await fence.inspectClosureFence(database,started.id)).unresolvedWrites,3);
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
  assert.equal((await fence.beginApprovedClosureFence(database,independentApproval,now)).id,independentApproval.id);
  const drained=await fence.inspectClosureFence(database,independentApproval.id);
  assert.equal(drained.trackedWritesDrained,true);assert.equal(drained.executable,false);
  console.log('PASS: atomic D1 closure fence, request/identity/handover recheck, rollback, scoped credential revocation, generation commit denial, tracked drain and uncertain-write retention. Prototype only; no production migration or closure.');
} finally {await runtime.dispose();}
