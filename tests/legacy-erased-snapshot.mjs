import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { minimiseLegacyDeviceSnapshot } from '../scripts/minimise-legacy-device-snapshot.mjs';
import { verifiedLegacyErasureBindings } from '../scripts/verify-erasure-ledger.mjs';
import { importSnapshot } from '../scripts/relay-backup.mjs';
import { planReadOnlySnapshot, restoreReadOnlySnapshot, schemaQuery } from '../scripts/backup-d1-readonly.mjs';

const now = 1800000000000, identityDigest = 'a'.repeat(64);
const {publicKey,privateKey} = generateKeyPairSync('ed25519');
const evidence = {formatVersion:1,personId:'gone',identityDigest,sourceSnapshotDigest:'b'.repeat(64),legacyDevices:[{deviceId:'mine',spaceId:'shared'}]};
// Synthetic signatures authenticate only fixture statements; no production key or completed-erasure record is created.
function signEvidence(value = evidence, state = 'fulfilled') {
  const evidenceText = JSON.stringify(value);
  const ledger = {formatVersion:1,ledgerId:'fixture',keyId:'fixture',revision:1,issuedAt:now-1,expiresAt:now+1000,
    records:[{personId:'gone',requestId:'request',identityDigest,state,updatedAt:now-2,
      evidenceDigest:state === 'fulfilled' ? createHash('sha256').update(evidenceText).digest('hex') : null}]};
  const payload = Buffer.from(JSON.stringify(ledger));
  return {evidenceText,envelope:{payload:payload.toString('base64url'),signature:sign(null,
    Buffer.concat([Buffer.from('relay-erasure-ledger-v1\n'),payload]),privateKey).toString('base64url')},
  trust:{ledgerId:'fixture',keyId:'fixture',revision:1,headCheckedAt:now,payloadDigest:createHash('sha256').update(payload).digest('hex'),
    publicKey:publicKey.export({type:'spki',format:'pem'})}};
}
const good = signEvidence();
for (const index of [2,6]) {
  const database = new DatabaseSync(':memory:');
  try {
    const migrations = JSON.parse(await readFile('drizzle/meta/_journal.json','utf8')).entries;
    for (const migration of migrations.slice(0,index+1)) database.exec(await readFile(`drizzle/${migration.tag}.sql`,'utf8'));
    database.exec(`INSERT INTO spaces VALUES ('shared','Shared library',1);
      INSERT INTO devices(id,space_id,name,token_hash,created_at,expires_at) VALUES
      ('mine','shared','Private profile','private-token',1,999),('other','shared','Other member','other-token',1,999);
      INSERT INTO media(id,space_id,device_id,name,mime,size,sha256,category,object_key,upload_id,part_size,status,created_at)
      VALUES ('media','shared','mine','Shared original','image/png',10,'${'c'.repeat(64)}','original','shared/keep','upload',16,'ready',1);`);
    const plan = planReadOnlySnapshot(database.prepare(schemaQuery).all());
    const sql = restoreReadOnlySnapshot(plan,database.prepare(plan.sql).all());
    const output = minimiseLegacyDeviceSnapshot(sql,good.envelope,good.trust,'gone',good.evidenceText,now);
    assert.equal(output.minimisedProfiles,1); assert.equal(output.historicalBindingsComplete,true);
    assert.equal(output.cutoverAllowed,false); assert.equal(output.cloudErasureVerified,false);
    const restored = importSnapshot(output.sql);
    try {
      assert.equal(restored.prepare("SELECT name FROM devices WHERE id='mine'").get().name,'Deleted member');
      assert.equal(restored.prepare("SELECT name FROM devices WHERE id='other'").get().name,'Other member');
      assert.equal(restored.prepare("SELECT object_key FROM media WHERE id='media'").get().object_key,'shared/keep');
      assert.equal(restored.prepare('SELECT COUNT(*) AS n FROM devices WHERE revoked_at IS NULL').get().n,0);
      assert.equal(restored.prepare('PRAGMA foreign_key_check').all().length,0);
    } finally {restored.close();}
    assert.equal(database.prepare("SELECT name FROM devices WHERE id='mine'").get().name,'Private profile');
    assert.equal(minimiseLegacyDeviceSnapshot(output.sql,good.envelope,good.trust,'gone',good.evidenceText,now).sql,output.sql);
    const wrongSpace = signEvidence({...evidence,legacyDevices:[{deviceId:'mine',spaceId:'other'}]});
    assert.throws(()=>minimiseLegacyDeviceSnapshot(sql,wrongSpace.envelope,wrongSpace.trust,'gone',wrongSpace.evidenceText,now),/scope/);
    const absent = signEvidence({...evidence,legacyDevices:[{deviceId:'later-device',spaceId:'shared'}]});
    assert.equal(minimiseLegacyDeviceSnapshot(sql,absent.envelope,absent.trust,'gone',absent.evidenceText,now).historicalBindingsComplete,false);
    assert.throws(()=>minimiseLegacyDeviceSnapshot(sql+'\nALTER TABLE devices ADD secret_note TEXT;',good.envelope,good.trust,'gone',good.evidenceText,now),/schema/);
  } finally {database.close();}
}
assert.throws(()=>verifiedLegacyErasureBindings(good.envelope,good.trust,'gone',good.evidenceText+' ',now),/Authenticated/);
for (const changed of [{personId:'other'},{identityDigest:'f'.repeat(64)},{legacyDevices:[evidence.legacyDevices[0],evidence.legacyDevices[0]]},
  {legacyDevices:[{deviceId:['mine'],spaceId:'shared'}]}]) {
  const fixture = signEvidence({...evidence,...changed});
  assert.throws(()=>verifiedLegacyErasureBindings(fixture.envelope,fixture.trust,'gone',fixture.evidenceText,now));
}
const withdrawn = signEvidence(evidence,'withdrawn');
assert.throws(()=>verifiedLegacyErasureBindings(withdrawn.envelope,withdrawn.trust,'gone',withdrawn.evidenceText,now),/Authenticated/);
console.log('PASS: authenticated legacy device bindings, schemas 0002/0006, preserved shared bytes/other profiles, quarantined access, missing bindings and replay.');
