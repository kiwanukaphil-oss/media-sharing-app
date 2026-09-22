import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle=await build({entryPoints:['lib/account-closure-fence.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {beginApprovedClosureFence}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

// Pair a disposable legacy owner through the actual built Worker, then fence its positively linked
// person. An already-issued invitation must not create a new credential after that transaction.
export async function verifyClosureEntryPoints(database,dispatch,origin) {
  // Independent fixture traffic must not share the authentication rate budget consumed by earlier
  // account tests. Keep real production limits enabled and use an isolated documentation-range IP.
  const fixtureDispatch=(url,options={})=>dispatch(url,{...options,headers:{...options.headers,'CF-Connecting-IP':'192.0.2.201'}});
  const connect=await fixtureDispatch(`${origin}/api/connect`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},
    body:JSON.stringify({name:'Closure fixture',spaceName:'Closure fixture'})});
  assert.equal(connect.status,200);
  const cookie=connect.headers.get('set-cookie').split(';')[0];
  const sessionResponse=await fixtureDispatch(`${origin}/api/session`,{headers:{Cookie:cookie}});
  const session=await sessionResponse.json();
  const invitationResponse=await fixtureDispatch(`${origin}/api/invitations`,{method:'POST',headers:{Cookie:cookie,Origin:origin}});
  assert.equal(invitationResponse.status,200);
  const invitation=await invitationResponse.json();
  const prefix=crypto.randomUUID(),person=prefix+'-owner',other=prefix+'-other',membership=prefix+'-member';
  const accountSession=prefix+'-session',request=prefix+'-request',now=Date.now(),issuer='https://closure-entry.fixture/';
  await database.batch([
    database.prepare('INSERT INTO people(id,issuer,subject,display_name,verified_email,created_at) VALUES(?,?,?,?,?,?),(?,?,?,?,?,?)')
      .bind(person,issuer,person,'Closing fixture','closing@example.invalid',now,other,issuer,other,'Retained owner','retained@example.invalid',now),
    database.prepare("INSERT INTO space_memberships(id,person_id,space_id,role,created_at) VALUES(?,?,?,'owner',?),(?,?,?,'owner',?)")
      .bind(membership,person,session.space.id,now,prefix+'-other-member',other,session.space.id,now),
    database.prepare('INSERT INTO account_sessions(id,person_id,token_hash,configuration_hash,created_at,expires_at,authenticated_at) VALUES(?,?,?,?,?,?,?)')
      .bind(accountSession,person,prefix+'-token','fixture',now,now+60000,now),
    database.prepare('INSERT INTO legacy_owner_claims VALUES(?,?,?,?)').bind(session.deviceId,membership,accountSession,now),
    database.prepare("INSERT INTO account_deletion_requests VALUES(?,?,?,'pending',?)").bind(request,person,now-1,now-1),
  ]);
  const before=(await database.prepare('SELECT COUNT(*) AS n FROM devices WHERE space_id=?').bind(session.space.id).first()).n;
  await beginApprovedClosureFence(database,{id:prefix+'-fence',personId:person,requestId:request,requestRevision:now-1,
    issuer,subject:person,planDigest:'a'.repeat(64),decisionDigest:'b'.repeat(64),approvalDigest:'c'.repeat(64),authorisedAt:now},now);
  for(const endpoint of ['connect','native/connect']) {
    const response=await fixtureDispatch(`${origin}/api/${endpoint}`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},
      body:JSON.stringify({name:'Denied late pairing',invitation:invitation.token})});
    assert.equal(response.status,410);
  }
  assert.equal((await database.prepare('SELECT COUNT(*) AS n FROM devices WHERE space_id=?').bind(session.space.id).first()).n,before);
  assert.equal((await database.prepare('SELECT disabled_at FROM people WHERE id=?').bind(other).first()).disabled_at,null);
  const denied=await fixtureDispatch(`${origin}/api/session`,{headers:{Cookie:cookie}});
  assert.equal(denied.status,401);
  console.log('PASS: actual closure fence blocks pre-issued browser/native pairing invitations and linked credentials without disabling the retained owner.');
}
