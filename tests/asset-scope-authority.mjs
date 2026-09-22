import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {planReadOnlySnapshot,restoreReadOnlySnapshot,schemaQuery} from '../scripts/backup-d1-readonly.mjs';
import {importSnapshot,sanitizeRestoredAccess} from '../scripts/relay-backup.mjs';

const bundle=await build({entryPoints:['lib/asset-scope-authority.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {resourceAudienceAuthority,eventAudienceAuthority}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const db=new DatabaseSync(':memory:');
try {
  for(const migration of JSON.parse(await readFile('drizzle/meta/_journal.json','utf8')).entries)db.exec(await readFile(`drizzle/${migration.tag}.sql`,'utf8'));
  db.exec(await readFile('docs/prototypes/restricted-scope-schema.sql','utf8'));
  const now=Date.now();
  db.exec("INSERT INTO spaces VALUES('shared','Shared',1),('personal','Personal',1),('foreign','Foreign',1)");
  for(const member of ['owner','viewer']){
    db.prepare('INSERT INTO people(id,issuer,subject,display_name,verified_email,created_at) VALUES(?,?,?,?,?,?)').run(member,'https://fixture.invalid',member,member,member+'@example.invalid',now);
    db.prepare('INSERT INTO space_memberships(id,person_id,space_id,role,created_at) VALUES(?,?,?,?,?)').run(member,member,'shared',member,now);
    db.prepare('INSERT INTO devices(id,space_id,name,token_hash,created_at,expires_at) VALUES(?,?,?,?,?,0)').run(member,'shared',member,'account-attribution:'+member,now);
    db.prepare('INSERT INTO account_space_actors VALUES(?,?)').run(member,member);
    db.prepare('INSERT INTO account_sessions(id,person_id,token_hash,configuration_hash,created_at,expires_at,authenticated_at) VALUES(?,?,?,?,?,?,?)').run(member,member,member,'fixture',now,now+3600000,now);
  }
  db.prepare("INSERT INTO devices(id,space_id,name,token_hash,role,created_at,expires_at) VALUES('legacy','shared','Legacy','legacy','owner',?,?)").run(now,now+3600000);
  db.exec("INSERT INTO personal_spaces VALUES('personal','owner',1024); INSERT INTO asset_scopes VALUES('restricted','shared','Sensitive area','owner',1)");
  assert.throws(()=>db.exec("INSERT INTO asset_scopes VALUES('invalid','personal','Private scope','owner',1)"),/Incompatible scope/);
  db.exec("INSERT INTO scope_grants VALUES('restricted','viewer','owner',1,NULL)");
  for(const [id,scope] of [['general',null],['secret','restricted']]){
    db.prepare("INSERT INTO media(id,space_id,device_id,name,mime,size,sha256,category,object_key,upload_id,part_size,status,created_at,access_scope_id) VALUES(?,'shared','owner',?,'text/plain',1,?,'original',?,'complete',1,'ready',1,?)").run(id,id,'a'.repeat(64),id,scope);
    db.prepare("INSERT INTO albums(id,space_id,name,created_at,access_scope_id) VALUES(?,'shared',?,1,?)").run(id,id,scope);
  }
  const actor=id=>({id,space_id:'shared',role:id,authentication:'account',personId:id,sessionId:id});
  const visible=principal=>{const rule=resourceAudienceAuthority(principal);return db.prepare(`SELECT id FROM media WHERE ${rule.sql} ORDER BY id`).all(...rule.bindings).map(row=>row.id);};
  assert.deepEqual(visible(actor('owner')),['general'],'Space owner has no implicit restricted read grant.');
  assert.deepEqual(visible(actor('viewer')),['general','secret']);
  assert.deepEqual(visible({id:'legacy',space_id:'shared',role:'owner'}),['general']);
  assert.deepEqual(visible({...actor('viewer'),space_id:'foreign'}),[]);
  assert.throws(()=>db.exec("INSERT INTO album_media VALUES('general','secret',NULL)"),/Incompatible album reference/);
  assert.throws(()=>db.exec("UPDATE media SET access_scope_id=NULL WHERE id='secret'"),/explicit cross-scope copy/);
  db.exec("INSERT INTO album_media VALUES('secret','secret',NULL); UPDATE albums SET deleted_at=1 WHERE id='secret'");
  assert.equal(db.prepare("SELECT access_scope_id FROM media WHERE id='secret'").get().access_scope_id,'restricted');
  for(const [id,scopes] of [['visible','[null]'],['hidden','["restricted"]'],['mixed','[null,"restricted"]']])db.prepare("INSERT INTO library_events VALUES(?,'shared','owner','file.rename','[{\"kind\":\"media\",\"id\":\"secret\"}]',1,1,?)").run(id,scopes);
  const events=principal=>{const rule=eventAudienceAuthority(principal);return db.prepare(`SELECT e.id FROM library_events e WHERE ${rule.sql} ORDER BY e.id`).all(...rule.bindings).map(row=>row.id);};
  assert.deepEqual(events(actor('owner')),['visible']);assert.deepEqual(events(actor('viewer')),['hidden','mixed','visible']);
  db.exec("DELETE FROM media WHERE id='secret'");
  assert.deepEqual(events(actor('owner')),['visible'],'Deleting an asset never widens its historical audience.');
  db.exec("UPDATE space_memberships SET revoked_at=2 WHERE id='viewer'; UPDATE space_memberships SET revoked_at=NULL WHERE id='viewer'");
  assert.equal(db.prepare("SELECT revoked_at FROM scope_grants WHERE membership_id='viewer'").get().revoked_at,2);
  assert.deepEqual(events(actor('viewer')),['visible'],'Rejoining does not resurrect restricted grants.');
  db.exec("UPDATE scope_grants SET revoked_at=NULL WHERE membership_id='viewer'; UPDATE account_sessions SET revoked_at=3 WHERE id='viewer'");
  assert.deepEqual(events(actor('viewer')),[],'Current session authority is evaluated inside the read query.');
  const plan=planReadOnlySnapshot(db.prepare(schemaQuery).all()),sql=restoreReadOnlySnapshot(plan,db.prepare(plan.sql).all());
  const restored=importSnapshot(sql);
  try {
    sanitizeRestoredAccess(restored,now+1000);
    assert.equal(restored.prepare('SELECT COUNT(*) AS n FROM scope_grants WHERE revoked_at IS NULL').get().n,0,'Restored membership quarantine also quarantines grants.');
    assert.equal(restored.prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE type='trigger' AND name='album_reference_same_scope'").get().n,1);
  } finally {restored.close();}
  // Execute the proposed trigger schema and the real predicates in D1 as well as SQLite. Import the
  // exact generated snapshot statements with deferred FKs; no ad-hoc trigger SQL splitting is used.
  const runtime=new Miniflare(convertV4MiniflareOptions({workers:[{name:'scope-prototype',modules:true,script:'export default {fetch(){return new Response("fixture");}}',d1Databases:['DB']}]}));
  try {
    const d1=await runtime.getD1Database('DB'),snapshot=JSON.parse(db.prepare(plan.sql).get().snapshot);
    for(const statement of plan.schema.filter(row=>row.type==='table'))await d1.prepare(statement.sql).run();
    await d1.batch([d1.prepare('PRAGMA defer_foreign_keys=ON'),...snapshot.tables.flatMap(table=>table.rows.map(statement=>d1.prepare(statement)))]);
    for(const statement of plan.schema.filter(row=>row.type!=='table'))await d1.prepare(statement.sql).run();
    const ownerRule=eventAudienceAuthority(actor('owner'));
    assert.deepEqual((await d1.prepare(`SELECT e.id FROM library_events e WHERE ${ownerRule.sql}`).bind(...ownerRule.bindings).all()).results.map(row=>row.id),['visible']);
    await d1.prepare("INSERT INTO scope_grants VALUES('restricted','owner','owner',1,NULL)").run();
    assert.equal((await d1.prepare(`SELECT COUNT(*) AS n FROM library_events e WHERE ${ownerRule.sql}`).bind(...ownerRule.bindings).first()).n,3);
    await d1.prepare("UPDATE space_memberships SET revoked_at=4 WHERE id='owner'").run();
    assert.equal((await d1.prepare("SELECT revoked_at FROM scope_grants WHERE membership_id='owner'").first()).revoked_at,4);
    assert.equal((await d1.prepare(`SELECT COUNT(*) AS n FROM library_events e WHERE ${ownerRule.sql}`).bind(...ownerRule.bindings).first()).n,0);
  } finally {await runtime.dispose();}
  console.log('PASS: isolated proposed-schema SQLite/D1 grants, owner/legacy denial, immutable compatible references, retained history scopes, offboarding and restored-trigger quarantine. Not wired into runtime.');
} finally {db.close();}
