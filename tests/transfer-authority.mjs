import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({entryPoints:['lib/transfer-authority.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {transferAuthority} = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

// Keep the request's resolved principal unchanged while revoking live records before a guarded write.
// Real D1 executes the predicate and mutation together; cached request authority must not win the race.
export async function verifyTransferAuthority(database) {
  const now=Date.now(), prefix=crypto.randomUUID(), person=prefix+'-person', space=prefix+'-space';
  const member=prefix+'-member', session=prefix+'-session', legacy=prefix+'-legacy';
  await database.batch([
    database.prepare('INSERT INTO spaces VALUES (?,?,?)').bind(space,'Authority fixture',now),
    database.prepare('INSERT INTO people(id,issuer,subject,display_name,verified_email,created_at) VALUES (?,?,?,?,?,?)')
      .bind(person,'https://authority.fixture/',person,'Fixture','fixture@example.test',now),
    database.prepare('INSERT INTO space_memberships(id,person_id,space_id,role,created_at) VALUES (?,?,?,?,?)')
      .bind(member,person,space,'owner',now),
    database.prepare('INSERT INTO devices(id,space_id,name,token_hash,created_at,expires_at) VALUES (?,?,?,?,?,?)')
      .bind(member,space,'Actor','account-attribution:'+member,now,0),
    database.prepare('INSERT INTO devices(id,space_id,name,token_hash,created_at,expires_at) VALUES (?,?,?,?,?,?)')
      .bind(legacy,space,'Legacy',prefix+'-token',now,now+60000),
    database.prepare('INSERT INTO account_space_actors VALUES (?,?)').bind(member,member),
    database.prepare('INSERT INTO account_sessions(id,person_id,token_hash,configuration_hash,created_at,expires_at,authenticated_at) VALUES (?,?,?,?,?,?,?)')
      .bind(session,person,prefix+'-session-token','fixture',now,now+60000,now),
  ]);
  try {
  const account={id:member,space_id:space,authentication:'account',personId:person,sessionId:session};
  const device={id:legacy,space_id:space};
  const write = async principal => {
    const authority=transferAuthority(principal,now);
    return (await database.prepare(`UPDATE spaces SET name='Guarded fixture' WHERE id=? AND ${authority.sql}`)
      .bind(space,...authority.bindings).run()).meta.changes;
  };
  assert.equal(await write(account),1); assert.equal(await write(device),1);
  assert.equal(await write({...account,sessionId:undefined}),0);
  assert.equal(await write({...account,personId:'wrong'}),0);
  assert.equal(await write({...account,space_id:'wrong'}),0);
  assert.equal(await write({...device,space_id:'wrong'}),0);
  for (const [deny,restore] of [
    ["UPDATE account_sessions SET revoked_at=1 WHERE id=?","UPDATE account_sessions SET revoked_at=NULL WHERE id=?"],
    ["UPDATE account_sessions SET expires_at=0 WHERE id=?","UPDATE account_sessions SET expires_at="+(now+60000)+" WHERE id=?"],
  ]) {
    await database.prepare(deny).bind(session).run(); assert.equal(await write(account),0);
    await database.prepare(restore).bind(session).run(); assert.equal(await write(account),1);
  }
  await database.prepare('UPDATE people SET disabled_at=? WHERE id=?').bind(now,person).run(); assert.equal(await write(account),0);
  await database.prepare('UPDATE people SET disabled_at=NULL,credentials_changed_at=? WHERE id=?').bind(now+1,person).run(); assert.equal(await write(account),0);
  await database.prepare('UPDATE people SET credentials_changed_at=0 WHERE id=?').bind(person).run();
  await database.prepare('UPDATE space_memberships SET revoked_at=? WHERE id=?').bind(now,member).run(); assert.equal(await write(account),0);
  await database.prepare('UPDATE space_memberships SET revoked_at=NULL WHERE id=?').bind(member).run();
  await database.prepare('UPDATE devices SET revoked_at=? WHERE id=?').bind(now,legacy).run(); assert.equal(await write(device),0);
  await database.prepare('UPDATE devices SET revoked_at=NULL WHERE id=?').bind(legacy).run();
  await database.prepare('INSERT INTO personal_spaces VALUES (?,?,?)').bind(space,person,1000).run();
  assert.equal(await write(device),0); assert.equal(await write(account),1);
  await database.prepare("UPDATE space_memberships SET role='member' WHERE id=?").bind(member).run(); assert.equal(await write(account),0);
  await database.prepare("UPDATE space_memberships SET role='owner' WHERE id=?").bind(member).run();
  assert.equal(await write(account),1);
  await database.prepare("UPDATE devices SET token_hash='invalid-actor' WHERE id=?").bind(member).run(); assert.equal(await write(account),0);
  console.log('PASS: transfer commits recheck real D1 session, recovery, identity, membership, legacy access and personal ownership after initial authentication.');
  } finally {
    // Remove only this isolated fixture so its personal allocation cannot affect subsequent budget tests.
    await database.batch([
      database.prepare('DELETE FROM personal_spaces WHERE space_id=?').bind(space),
      database.prepare('DELETE FROM account_sessions WHERE id=?').bind(session),
      database.prepare('DELETE FROM account_space_actors WHERE membership_id=?').bind(member),
      database.prepare('DELETE FROM devices WHERE space_id=?').bind(space),
      database.prepare('DELETE FROM space_memberships WHERE id=?').bind(member),
      database.prepare('DELETE FROM people WHERE id=?').bind(person),
      database.prepare('DELETE FROM spaces WHERE id=?').bind(space),
    ]);
  }
}
