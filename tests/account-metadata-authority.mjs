import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { providerIdentityDigest } from '../scripts/minimise-erased-snapshot.mjs';

const bundle = await build({entryPoints:['lib/account-sessions.ts','lib/account-space-access.ts','lib/space-memberships.ts','lib/space-people.ts'],outdir:'unused',bundle:true,write:false,platform:'node',format:'esm'});
const modules = await Promise.all(bundle.outputFiles.map(file=>import(`data:text/javascript;base64,${Buffer.from(file.text).toString('base64')}`)));
const accounts=modules.find(value=>value.createAccountSession), access=modules.find(value=>value.requireAccountSpaceAccess);
const claims=modules.find(value=>value.prepareOwnerClaim), people=modules.find(value=>value.createPersonInvitation);
const settings={issuer:'https://metadata.fixture/',clientId:'fixture',clientSecret:'fixture',appOrigin:'https://relay.example'};
const runtime=new Miniflare(convertV4MiniflareOptions({workers:[{name:'metadata-authority',modules:true,
  script:'export default { fetch() { return new Response("isolated"); } }',d1Databases:['DB']}]}));
const now=Date.now(), hash=async value=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))).toString('hex');
try {
  const database=await runtime.getD1Database('DB');
  for(const migration of JSON.parse(await readFile('drizzle/meta/_journal.json','utf8')).entries)
    for(const sql of (await readFile(`drizzle/${migration.tag}.sql`,'utf8')).split('--> statement-breakpoint'))if(sql.trim())await database.prepare(sql).run();

  // Each race has its own genuine D1 identities; only the scheduling boundary is intercepted.
  async function fixture() {
    const subject=crypto.randomUUID(),space=crypto.randomUUID(),membership=crypto.randomUUID(),device=crypto.randomUUID();
    const credential='a'.repeat(32)+crypto.randomUUID().replaceAll('-','');
    const login=await accounts.createAccountSession(database,settings,{issuer:settings.issuer,subject,displayName:'Before',
      authenticatedAt:now,credentialsChangedAt:0,verifiedEmail:`${subject}@example.test`},null,now);
    const session=await accounts.readAccountSession(database,settings,login.token,now);
    await database.batch([
      database.prepare('INSERT INTO spaces VALUES(?,?,?)').bind(space,'Fixture',now),
      database.prepare("INSERT INTO space_memberships(id,person_id,space_id,role,created_at) VALUES(?,?,?,'owner',?)").bind(membership,session.personId,space,now),
      database.prepare("INSERT INTO devices(id,space_id,name,token_hash,role,created_at,expires_at) VALUES(?,?,?,?,'owner',?,?)").bind(device,space,'Legacy',await hash(credential),now,now+60000),
    ]);
    const request=new Request(`${settings.appOrigin}/api/session?space=${space}`,{headers:{Cookie:`__Host-relay_account=${login.token}`}});
    return {...session,space,membership,device,credential,request};
  }
  const beforeBatch=callback=>({prepare:sql=>database.prepare(sql),batch:async statements=>{await callback();return database.batch(statements);}});
  for(const scenario of ['recovery','disabled','session','membership']) {
    const person=await fixture();
    const revoke=()=>database.prepare(scenario==='recovery'?'UPDATE people SET credentials_changed_at=? WHERE id=?':
      scenario==='disabled'?'UPDATE people SET disabled_at=? WHERE id=?':scenario==='session'?
        'UPDATE account_sessions SET revoked_at=? WHERE id=?':'UPDATE space_memberships SET revoked_at=? WHERE id=?')
      .bind(now+1,scenario==='session'?person.sessionId:scenario==='membership'?person.membership:person.personId).run();
    await assert.rejects(access.requireAccountSpaceAccess(person.request,beforeBatch(revoke),settings,now),/not available/);
    assert.equal(await database.prepare('SELECT id FROM devices WHERE id=?').bind(person.membership).first(),null,scenario);
    assert.equal(await database.prepare('SELECT device_id FROM account_space_actors WHERE membership_id=?').bind(person.membership).first(),null,scenario);
  }
  const current=await fixture();
  const resolved=await access.requireAccountSpaceAccess(current.request,beforeBatch(()=>database.prepare('UPDATE people SET display_name=? WHERE id=?').bind('Current',current.personId).run()),settings,now);
  assert.equal(resolved.name,'Current');
  assert.equal((await database.prepare('SELECT name FROM devices WHERE id=?').bind(current.membership).first()).name,'Current');
  const recoverBeforeFinalRead={prepare:sql=>{
    const statement=database.prepare(sql);
    if(!sql.includes('FROM account_space_actors actor'))return statement;
    return {bind:(...bindings)=>({first:async()=>{
      await database.prepare('UPDATE people SET credentials_changed_at=? WHERE id=?').bind(now+1,current.personId).run();
      return statement.bind(...bindings).first();
    }})};
  }};
  await assert.rejects(access.requireAccountSpaceAccess(current.request,recoverBeforeFinalRead,settings,now),/not available/);

  // Claim previews and confirmations must independently reject a stale caller after recovery.
  for(const stage of ['preview','confirmation']) {
    const person=await fixture();
    const claimant=await fixture();
    const change=()=>database.prepare('UPDATE people SET credentials_changed_at=? WHERE id=?').bind(now+1,claimant.personId).run();
    if(stage==='preview') {
      await assert.rejects(claims.prepareOwnerClaim(beforeBatch(change),claimant,person.credential,now),/Access changed/);
      assert.equal((await database.prepare('SELECT COUNT(*) AS n FROM owner_claim_attempts WHERE session_id=?').bind(claimant.sessionId).first()).n,0);
    } else {
      const preview=await claims.prepareOwnerClaim(database,claimant,person.credential,now);
      await change();
      await assert.rejects(claims.confirmOwnerClaim(database,claimant,person.credential,preview.token,now),/Access changed/);
    }
    assert.equal(await database.prepare('SELECT id FROM space_memberships WHERE person_id=? AND space_id=?').bind(claimant.personId,person.space).first(),null);
  }
  const owner=await fixture(),recipient=await fixture();
  const invitation=await people.createPersonInvitation(database,owner,owner.space,recipient.verifiedEmail,now);
  await database.prepare('UPDATE people SET credentials_changed_at=? WHERE id IN (?,?)').bind(now+1,owner.personId,recipient.personId).run();
  await assert.rejects(people.createPersonInvitation(database,owner,owner.space,'new@example.test',now),/access changed/);
  await assert.rejects(people.changeSpacePerson(database,owner,owner.space,owner.membership,'owner',0,now),/Access changed/);
  assert.equal((await database.prepare('SELECT revision FROM space_memberships WHERE id=?').bind(owner.membership).first()).revision,0);
  await people.revokePersonInvitation(database,owner,owner.space,invitation.id,now);
  assert.equal((await database.prepare('SELECT revoked_at FROM person_invitations WHERE id=?').bind(invitation.id).first()).revoked_at,null);
  await assert.rejects(people.acceptPersonInvitation(database,recipient,invitation.token,now),/no longer available/);
  assert.equal((await database.prepare('SELECT accepted_at FROM person_invitations WHERE id=?').bind(invitation.id).first()).accepted_at,null);
  // Use the actual minimiser's identity digest to prove a delayed callback cannot recreate erased
  // profile fields, even if an inconsistent restore also contains the old active provider row.
  const erasedIdentity={issuer:settings.issuer,subject:'erased-callback',displayName:'Must not return',
    verifiedEmail:'erased@example.test',authenticatedAt:now,credentialsChangedAt:0};
  await database.prepare("INSERT INTO people(id,issuer,subject,display_name,verified_email,created_at,disabled_at) VALUES(?,'urn:relay:erased',?,'Deleted member','',?,?)")
    .bind(crypto.randomUUID(),providerIdentityDigest(erasedIdentity.issuer,erasedIdentity.subject),now,now).run();
  const countBefore=(await database.prepare('SELECT COUNT(*) AS n FROM people').first()).n;
  await assert.rejects(accounts.createAccountSession(database,settings,erasedIdentity,null,now),/unavailable/);
  assert.equal((await database.prepare('SELECT COUNT(*) AS n FROM people').first()).n,countBefore);
  const inconsistentId=crypto.randomUUID();
  await database.prepare('INSERT INTO people(id,issuer,subject,display_name,verified_email,created_at) VALUES(?,?,?,?,?,?)')
    .bind(inconsistentId,settings.issuer,erasedIdentity.subject,'Unchanged','old@example.test',now).run();
  await assert.rejects(accounts.createAccountSession(database,settings,erasedIdentity,null,now),/unavailable/);
  assert.equal((await database.prepare('SELECT display_name FROM people WHERE id=?').bind(inconsistentId).first()).display_name,'Unchanged');
  assert.equal((await database.prepare('SELECT COUNT(*) AS n FROM account_sessions WHERE person_id=?').bind(inconsistentId).first()).n,0);
  assert.ok((await accounts.createAccountSession(database,settings,{...erasedIdentity,subject:'unrelated-current'},null,now)).token);
  console.log('PASS: actual D1 attribution/claim races, current profile attribution, recovery-bound people writes and unchanged rejected effects.');
} finally {await runtime.dispose();}
