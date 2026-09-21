import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { initialiseErasureJournal,readErasureJournal } from '../scripts/erasure-ledger-journal.mjs';
import { erasureIntentQuery,planErasureIntents,recordErasureIntents } from '../scripts/record-erasure-intents.mjs';
import { prepareLiveErasureIntents } from '../scripts/prepare-live-erasure-intents.mjs';

const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const root={ledgerId:'intent-fixture',keyId:'fixture',publicKey:publicKey.export({type:'spki',format:'pem'})};
const issuer='https://identity.example/',now=1800000000000;
const withdrawn={personId:'person',requestId:'request1',issuer,subject:'provider-person',requestedAt:now-100,updatedAt:now-90,state:'withdrawn'};
const pending={...withdrawn,requestId:'request2',requestedAt:now-80,updatedAt:now-80,state:'pending'};
const source=rows=>({totalRequests:rows.length,requests:rows});
const database=new DatabaseSync(':memory:');
try {
  initialiseErasureJournal(database,root);
  const observed=source([pending,withdrawn]);
  const planned=planErasureIntents(database,root,observed,issuer,now,now);
  assert.deepEqual(planned.revisions.map(rows=>rows[0].state),['pending','withdrawn','pending']);
  assert.equal(JSON.stringify(planned).includes('provider-person'),false);
  const recorded=recordErasureIntents(database,root,privateKey,observed,issuer,now,now);
  assert.equal(recorded.appendedRevisions,3);assert.equal(recorded.archived,false);assert.equal(recorded.cutoverAllowed,false);
  assert.equal(recordErasureIntents(database,root,privateKey,observed,issuer,now+1,now+1).appendedRevisions,0);
  assert.equal(readErasureJournal(database,root,now).ledger.records[0].requestId,'request2');
  const review={...pending,state:'review_required',updatedAt:now-50};
  assert.equal(recordErasureIntents(database,root,privateKey,source([withdrawn,review]),issuer,now,now).appendedRevisions,1);
  const latestWithdrawn={...review,state:'withdrawn',updatedAt:now-10};
  recordErasureIntents(database,root,privateKey,source([withdrawn,latestWithdrawn]),issuer,now,now);
  for(const bad of [source([latestWithdrawn]),source([withdrawn,pending]),source([{...withdrawn,requestedAt:now-101},latestWithdrawn]),
    source([{...withdrawn,subject:'different'},latestWithdrawn]),source([withdrawn,{...latestWithdrawn,state:'fulfilled'}]),
    source([withdrawn,{...latestWithdrawn,updatedAt:now+1}]),source([withdrawn,latestWithdrawn,{...pending,requestId:'request3'}]),
    {...observed,totalRequests:3},source([withdrawn,withdrawn]),source([{...withdrawn,extra:true}])])
    assert.throws(()=>planErasureIntents(database,root,bad,issuer,now,now));
  assert.throws(()=>planErasureIntents(database,root,observed,issuer,now-30001,now),/fresh/);
  assert.throws(()=>planErasureIntents(database,root,observed,issuer,now+1,now),/fresh/);
  assert.throws(()=>recordErasureIntents(database,root,generateKeyPairSync('ed25519').privateKey,observed,issuer,now,now),/signer/);
  const renewal=recordErasureIntents(database,root,privateKey,source([withdrawn,latestWithdrawn]),issuer,now+3600000,now+3600000);
  assert.equal(renewal.appendedRevisions,1);
  assert.equal(readErasureJournal(database,root,now+3600000).ledger.records[0].updatedAt,now-10);
} finally {database.close();}

// A mid-batch interruption retains an auditable prefix and retry records the missing withdrawal once.
const interrupted=new DatabaseSync(':memory:');
try {
  initialiseErasureJournal(interrupted,root);
  interrupted.exec("CREATE TRIGGER interrupt_second BEFORE INSERT ON ledger_revisions WHEN NEW.revision=2 BEGIN SELECT RAISE(ABORT,'interrupted'); END");
  assert.throws(()=>recordErasureIntents(interrupted,root,privateKey,source([withdrawn]),issuer,now,now),/interrupted/);
  assert.equal(readErasureJournal(interrupted,root,now).ledger.records[0].state,'pending');
  interrupted.exec('DROP TRIGGER interrupt_second');
  assert.equal(recordErasureIntents(interrupted,root,privateKey,source([withdrawn]),issuer,now,now).appendedRevisions,1);
  assert.equal(readErasureJournal(interrupted,root,now).ledger.records[0].state,'withdrawn');
} finally {interrupted.close();}

// Validate the single SQL projection and completeness count independently of the planner's fixtures.
const application=new DatabaseSync(':memory:');
try {
  application.exec('CREATE TABLE people(id TEXT,issuer TEXT,subject TEXT); CREATE TABLE account_deletion_requests(id TEXT,person_id TEXT,requested_at INTEGER,updated_at INTEGER,status TEXT);');
  assert.deepEqual(JSON.parse(application.prepare(erasureIntentQuery).get().intents),source([]));
  application.prepare('INSERT INTO people VALUES(?,?,?)').run('person',issuer,'provider-person');
  application.prepare('INSERT INTO account_deletion_requests VALUES(?,?,?,?,?)').run('request1','person',now-100,now-90,'withdrawn');
  assert.deepEqual(JSON.parse(application.prepare(erasureIntentQuery).get().intents),source([withdrawn]));
  application.prepare('INSERT INTO account_deletion_requests VALUES(?,?,?,?,?)').run('orphan','missing',now-100,now-100,'pending');
  const incomplete=JSON.parse(application.prepare(erasureIntentQuery).get().intents);
  assert.equal(incomplete.totalRequests,2);assert.equal(incomplete.requests.length,1);
} finally {application.close();}
console.log('PASS: observed pending/review/withdrawal history, missed transitions, retry after interruption, ordering, identity binding, complete-source checks, expiry renewal and no fulfilment authority.');
const observedJournal=new DatabaseSync(':memory:');
try {
  initialiseErasureJournal(observedJournal,root);
  const stable=await prepareLiveErasureIntents(observedJournal,root,async()=>source([pending]),issuer,()=>now);
  assert.equal(stable.requestCount,1);assert.equal(stable.executable,false);assert.equal(stable.archived,false);
  let reads=0;
  await assert.rejects(prepareLiveErasureIntents(observedJournal,root,async()=>source(++reads===1?[pending]:[]),issuer,()=>now),/changed/);
  let ticks=0;
  await assert.rejects(prepareLiveErasureIntents(observedJournal,root,async()=>source([pending]),issuer,()=>now+20000*ticks++),/expired/);
  assert.equal(readErasureJournal(observedJournal,root,now).head.revision,0,'Preparation cannot change the journal');
} finally {observedJournal.close();}
console.log('PASS: stable live observation, changed-source rejection, preparation expiry and no planning mutations.');
