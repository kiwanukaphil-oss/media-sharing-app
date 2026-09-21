import { createHash, createPublicKey, verify } from 'node:crypto';
import { verifyArchivedErasureLedger, verifyErasureLedger } from './verify-erasure-ledger.mjs';

const recordKeys=['personId','requestId','identityDigest','state','updatedAt','evidenceDigest'];
const sameRecord=(left,right)=>recordKeys.every(key=>left[key]===right[key]);
const sameHead=(left,right)=>left?.revision===right?.revision && left?.payloadDigest===right?.payloadDigest;

// This separate journal is never an application migration. Its root must come from independent custody,
// not a restored database. Initialisation is atomic and cannot replace an existing root or decision head.
export function initialiseErasureJournal(database,root) {
  if (!root || Object.keys(root).sort().join(',')!=='keyId,ledgerId,publicKey' || !['ledgerId','keyId'].every(key=>typeof root[key]==='string' && /^[a-zA-Z0-9_-]{1,128}$/.test(root[key])) ||
      typeof root.publicKey!=='string' || !root.publicKey.startsWith('-----BEGIN PUBLIC KEY-----') ||
      createPublicKey(root.publicKey).asymmetricKeyType!=='ed25519' ||
      createPublicKey(root.publicKey).export({type:'spki',format:'pem'})!==root.publicKey) throw new Error('Independent journal root required.');
  database.exec('BEGIN IMMEDIATE');
  try {
    database.exec(`CREATE TABLE IF NOT EXISTS ledger_root (id INTEGER PRIMARY KEY CHECK(id=1),ledger_id TEXT NOT NULL,key_id TEXT NOT NULL,public_key TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ledger_revisions (revision INTEGER PRIMARY KEY CHECK(revision>0),payload_digest TEXT UNIQUE NOT NULL,
        previous_digest TEXT,envelope TEXT NOT NULL,journal_signature TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ledger_head (id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,payload_digest TEXT);`);
    database.prepare('INSERT INTO ledger_root VALUES (1,?,?,?) ON CONFLICT(id) DO NOTHING').run(root.ledgerId,root.keyId,root.publicKey);
    assertJournalRoot(database,root);
    database.prepare('INSERT INTO ledger_head VALUES (1,0,NULL) ON CONFLICT(id) DO NOTHING').run();
    database.exec('COMMIT');
  } catch (failure) { database.exec('ROLLBACK'); throw failure; }
}

// The separate signature binds each manifest to its accepted predecessor, preventing a previously
// signed but rejected concurrent proposal from being substituted into the durable history later.
export function journalSigningBytes(root,revision,payloadDigest,previousDigest) {
  return Buffer.from('relay-erasure-journal-v1\n'+JSON.stringify({ledgerId:root.ledgerId,keyId:root.keyId,revision,payloadDigest,previousDigest}));
}

function verifyJournalLink(root,revision,payloadDigest,previousDigest,signature) {
  if(typeof signature!=='string' || !/^[A-Za-z0-9_-]{86}$/.test(signature)) throw new Error('Journal link signature is invalid.');
  const bytes=Buffer.from(signature,'base64url');
  if(bytes.toString('base64url')!==signature || !verify(null,journalSigningBytes(root,revision,payloadDigest,previousDigest),root.publicKey,bytes))
    throw new Error('Journal link signature is invalid.');
}

function assertJournalRoot(database,root) {
  const stored=database.prepare('SELECT ledger_id,key_id,public_key FROM ledger_root WHERE id=1').get();
  if (!stored || stored.ledger_id!==root?.ledgerId || stored.key_id!==root?.keyId || stored.public_key!==root?.publicKey)
    throw new Error('Journal root differs from independent custody.');
}

// All decisions remain in each current manifest; history retains replaced request IDs. A signed statement
// authenticates its operator, not physical erasure. The future executor must verify evidence before signing.
function verifyDecisionProgression(previous,next,requestOwners) {
  const current=new Map(next.records.map(record=>[record.personId,record]));
  for(const prior of previous?.records ?? []) {
    const record=current.get(prior.personId);
    if (!record || record.identityDigest!==prior.identityDigest) throw new Error('A recorded identity cannot disappear or change.');
    if (sameRecord(prior,record)) continue;
    if (record.updatedAt<=prior.updatedAt || prior.state==='fulfilled') throw new Error('Decision history cannot move backwards.');
    if (prior.state==='withdrawn') {
      if (record.state!=='pending' || record.requestId===prior.requestId || requestOwners.has(record.requestId))
        throw new Error('A withdrawn request requires a distinct new request.');
    } else if (record.requestId!==prior.requestId ||
        !(prior.state==='pending' ? ['withdrawn','review_required'] : ['withdrawn','fulfilled']).includes(record.state))
      throw new Error('Decision transition requires review.');
  }
  const previousPeople=new Set(previous?.records.map(record=>record.personId) ?? []);
  for(const record of next.records) {
    const owner=requestOwners.get(record.requestId);
    if (owner && (owner.personId!==record.personId || owner.identityDigest!==record.identityDigest))
      throw new Error('A historical request cannot be reassigned.');
    if (!previousPeople.has(record.personId) && !['pending','review_required'].includes(record.state))
      throw new Error('Initial decisions must record intent before fulfilment.');
    requestOwners.set(record.requestId,{personId:record.personId,identityDigest:record.identityDigest});
  }
}

// Audit every bounded historical revision against the external root and a contiguous digest-linked head.
// Expired entries remain valid historical evidence, but this result deliberately provides no current
// restore authority. A production head reader still needs separately recoverable deployed custody.
export function readErasureJournal(database,root,now=Date.now()) {
  assertJournalRoot(database,root);
  const size=database.prepare('SELECT COUNT(*) AS records,COALESCE(SUM(length(envelope)+length(journal_signature)),0) AS bytes FROM ledger_revisions').get();
  if(size.records>10000 || size.bytes>16*1024*1024) throw new Error('Journal size requires an archival review.');
  const head=database.prepare('SELECT revision,payload_digest AS payloadDigest FROM ledger_head WHERE id=1').get();
  let previous=null,expected={revision:0,payloadDigest:null};
  const requestOwners=new Map();
  for(const row of database.prepare('SELECT * FROM ledger_revisions ORDER BY revision').all()) {
    if(row.revision!==expected.revision+1 || row.previous_digest!==expected.payloadDigest)
      throw new Error('Journal history is missing or forked.');
    verifyJournalLink(root,row.revision,row.payload_digest,row.previous_digest,row.journal_signature);
    const envelope=JSON.parse(row.envelope);
    const {ledger}=verifyArchivedErasureLedger(envelope,{...root,revision:row.revision,payloadDigest:row.payload_digest},now);
    if(previous && ledger.issuedAt<previous.issuedAt) throw new Error('Journal issuance moved backwards.');
    verifyDecisionProgression(previous,ledger,requestOwners);
    previous=ledger; expected={revision:row.revision,payloadDigest:row.payload_digest};
  }
  if(!sameHead(head,expected)) throw new Error('Journal head and durable history disagree.');
  return {mode:'local-journal-review',cutoverAllowed:false,head:{...head},ledger:previous,requestOwners};
}

// BEGIN IMMEDIATE serialises writers. Expected-head comparison rejects stale plans; insertion and head
// advancement commit together or both roll back. No private signing key or live/cloud deletion is used.
export function appendErasureJournal(database,root,expectedHead,entry,now=Date.now()) {
  database.exec('BEGIN IMMEDIATE');
  try {
    const current=readErasureJournal(database,root,now);
    if(!sameHead(expectedHead,current.head)) throw new Error('Journal head changed; review the current decision.');
    const envelope=entry?.envelope;
    if(typeof envelope?.payload!=='string' || envelope.payload.length>2*1024*1024) throw new Error('Bounded signed revision required.');
    const payloadDigest=createHash('sha256').update(Buffer.from(envelope.payload,'base64url')).digest('hex');
    const revision=current.head.revision+1;
    verifyJournalLink(root,revision,payloadDigest,current.head.payloadDigest,entry.journalSignature);
    const next=verifyErasureLedger(envelope,{...root,revision,payloadDigest,headCheckedAt:now},now);
    if(current.ledger && next.issuedAt<current.ledger.issuedAt) throw new Error('Journal issuance moved backwards.');
    verifyDecisionProgression(current.ledger,next,current.requestOwners);
    const serialized=JSON.stringify(envelope);
    const retained=database.prepare('SELECT COALESCE(SUM(length(envelope)+length(journal_signature)),0) AS bytes FROM ledger_revisions').get();
    if(revision>10000 || retained.bytes+Buffer.byteLength(serialized)+entry.journalSignature.length>16*1024*1024) throw new Error('Journal size requires an archival review.');
    database.prepare('INSERT INTO ledger_revisions VALUES (?,?,?,?,?)').run(revision,payloadDigest,current.head.payloadDigest,serialized,entry.journalSignature);
    const changed=database.prepare('UPDATE ledger_head SET revision=?,payload_digest=? WHERE id=1 AND revision=? AND payload_digest IS ?')
      .run(revision,payloadDigest,current.head.revision,current.head.payloadDigest);
    if(changed.changes!==1) throw new Error('Journal head changed during append.');
    database.exec('COMMIT');
    return {mode:'local-journal-review',cutoverAllowed:false,head:{revision,payloadDigest}};
  } catch(failure) { database.exec('ROLLBACK'); throw failure; }
}
