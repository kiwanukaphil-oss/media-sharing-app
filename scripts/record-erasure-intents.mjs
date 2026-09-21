import { createHash,createPublicKey,sign } from 'node:crypto';
import { readErasureJournal,appendErasureJournal,journalSigningBytes } from './erasure-ledger-journal.mjs';

// One bounded SELECT captures retained intent and exact provider bindings atomically. The separate count
// detects missing joins/truncation; no profile names, emails or session credentials enter this projection.
export const erasureIntentQuery=`SELECT json_object('totalRequests',(SELECT COUNT(*) FROM account_deletion_requests),
  'requests',json((SELECT json_group_array(json_object('requestId',id,'personId',person_id,'issuer',issuer,
    'subject',subject,'requestedAt',requested_at,'updatedAt',updated_at,'state',status)) FROM
    (SELECT r.id,r.person_id,p.issuer,p.subject,r.requested_at,r.updated_at,r.status FROM account_deletion_requests r
     JOIN people p ON p.id=r.person_id ORDER BY r.requested_at,r.id LIMIT 1001)))) AS intents`;
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const identifier=value=>typeof value==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const positive=value=>Number.isSafeInteger(value) && value>0;
const exact=(value,keys)=>value && typeof value==='object' && !Array.isArray(value) &&
  Object.keys(value).sort().join(',')===keys.split(',').sort().join(',');

// Treat the captured query result as observed intent, never execution approval. All rows must be present,
// bound to the configured issuer and chronologically valid. Fulfilment is outside this writer's capability.
function validateIntentSource(source,issuer,observedAt,now) {
  if(!positive(now) || !positive(observedAt) || observedAt>now || now-observedAt>30000 ||
      typeof issuer!=='string' || !issuer.startsWith('https://') ||
      !exact(source,'totalRequests,requests') || !Array.isArray(source.requests) || source.requests.length>1000 ||
      source.totalRequests!==source.requests.length) throw new Error('Complete fresh intent observation required.');
  const requests=new Set(),people=new Map(),identities=new Map();
  return source.requests.map(row=>{
    if(!exact(row,'requestId,personId,issuer,subject,requestedAt,updatedAt,state') || !identifier(row.requestId) ||
        !identifier(row.personId) || requests.has(row.requestId) || row.issuer!==issuer ||
        typeof row.subject!=='string' || !row.subject || row.subject.length>255 ||
        !positive(row.requestedAt) || !positive(row.updatedAt) || row.requestedAt>row.updatedAt || row.updatedAt>observedAt ||
        !['pending','withdrawn','review_required'].includes(row.state) ||
        (row.state==='pending' ? row.updatedAt!==row.requestedAt : row.updatedAt<=row.requestedAt))
      throw new Error('Intent identity, state or chronology requires review.');
    const identityDigest=hash([row.issuer,row.subject]);
    if((people.has(row.personId) && people.get(row.personId)!==identityDigest) ||
        (identities.has(identityDigest) && identities.get(identityDigest)!==row.personId)) throw new Error('Ambiguous intent identity.');
    requests.add(row.requestId);people.set(row.personId,identityDigest);identities.set(identityDigest,row.personId);
    return {personId:row.personId,requestId:row.requestId,identityDigest,state:row.state,
      requestedAt:row.requestedAt,updatedAt:row.updatedAt,evidenceDigest:null};
  }).sort((a,b)=>a.requestedAt-b.requestedAt || a.requestId.localeCompare(b.requestId));
}

// Audit prior history before interpreting application rows. Retained request IDs cannot disappear, change
// provider binding, move backwards or be reused. A missed pending/withdrawn pair is reconstructed from its
// two retained timestamps; neither state permits physical erasure. Unknown historical gaps fail for review.
export function planErasureIntents(database,root,source,issuer,observedAt,now=Date.now()) {
  const rows=validateIntentSource(source,issuer,observedAt,now);
  const current=readErasureJournal(database,root,now),history=new Map(),first=new Map();
  for(const revision of database.prepare('SELECT envelope FROM ledger_revisions ORDER BY revision').all()) {
    const records=JSON.parse(Buffer.from(JSON.parse(revision.envelope).payload,'base64url')).records;
    for(const record of records) {if(!first.has(record.requestId))first.set(record.requestId,record);history.set(record.requestId,record);}
  }
  if([...history.keys()].some(id=>!rows.some(row=>row.requestId===id))) throw new Error('Previously recorded intent is missing from the source.');
  const latest=new Map((current.ledger?.records ?? []).map(record=>[record.personId,record])),revisions=[];
  const recordTransition=record=>{latest.set(record.personId,record);revisions.push([...latest.values()].sort((a,b)=>a.personId.localeCompare(b.personId)));};
  for(const row of rows) {
    const {requestedAt,...record}=row,prior=history.get(row.requestId),active=latest.get(row.personId);
    if(prior) {
      const initial=first.get(row.requestId);
      if(initial.state!=='pending' || initial.updatedAt!==requestedAt || prior.personId!==row.personId ||
          prior.identityDigest!==row.identityDigest) throw new Error('Recorded request binding or origin changed.');
      if(prior.state===row.state && prior.updatedAt===row.updatedAt) continue;
      if(active?.requestId!==row.requestId || row.updatedAt<=prior.updatedAt ||
          !(prior.state==='pending' ? ['review_required','withdrawn'] : prior.state==='review_required' ? ['withdrawn'] : []).includes(row.state))
        throw new Error('Observed intent cannot overwrite historical decisions.');
      recordTransition(record);
    } else {
      if(active && (active.state!=='withdrawn' || active.identityDigest!==row.identityDigest || requestedAt<=active.updatedAt))
        throw new Error('New intent overlaps or predates its predecessor.');
      recordTransition({...record,state:'pending',updatedAt:requestedAt});
      if(row.state!=='pending') recordTransition(record);
    }
  }
  if(!revisions.length && (!current.ledger || current.ledger.expiresAt<=now+300000))
    revisions.push([...(current.ledger?.records ?? [])]);
  return {expectedHead:current.head,sourceDigest:hash(source),observedAt,revisions,cutoverAllowed:false};
}

// Sign only validated intent transitions, with independent custody and expected-head CAS at each append.
// This local writer has no deletion API or fulfilled-state path. Remote publication/coordination must be
// independently verified before treating its output as an archived observation; no CLI activates it yet.
export function recordErasureIntents(database,root,privateKey,source,issuer,observedAt,now=Date.now()) {
  if(createPublicKey(privateKey).export({type:'spki',format:'pem'})!==root.publicKey) throw new Error('Intent signer differs from pinned public root.');
  const plan=planErasureIntents(database,root,source,issuer,observedAt,now);let head=plan.expectedHead;
  for(const records of plan.revisions) {
    const revision=head.revision+1;
    const payload=Buffer.from(JSON.stringify({formatVersion:1,ledgerId:root.ledgerId,keyId:root.keyId,revision,
      issuedAt:now,expiresAt:now+3600000,records}));
    const payloadDigest=createHash('sha256').update(payload).digest('hex');
    head=appendErasureJournal(database,root,head,{envelope:{payload:payload.toString('base64url'),
      signature:sign(null,Buffer.concat([Buffer.from('relay-erasure-ledger-v1\n'),payload]),privateKey).toString('base64url')},
      journalSignature:sign(null,journalSigningBytes(root,revision,payloadDigest,head.payloadDigest),privateKey).toString('base64url')},now).head;
  }
  return {head,appendedRevisions:plan.revisions.length,sourceDigest:plan.sourceDigest,observedAt,
    archived:false,cutoverAllowed:false,cloudErasureVerified:false};
}
