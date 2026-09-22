const tables=['upload_requests','intake_submissions','intake_upload_attempts','intake_capabilities'];

// Exact issuer/recipient references scope custody. Contact email is deliberately excluded from
// ownership: a recycled or shared email address cannot turn another person's files into erase targets.
export function inspectIntakeSnapshot(database,personId){
  const names=new Set(database.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(row=>row.name));
  const present=tables.filter(name=>names.has(name));
  const report={present:present.length>0,complete:present.length===0||present.length===tables.length,quiescenceProven:false};
  if(!report.present||!report.complete)return {...report,requests:[],submissions:[],attempts:[],capabilities:[],sharedMediaToPreserve:[]};
  const predicate=`r.accepted_by=? OR r.issuer_membership_id IN(SELECT id FROM space_memberships WHERE person_id=?)`;
  const requests=database.prepare(`SELECT r.id,r.space_id,r.issuer_membership_id,r.accepted_by,r.state,r.revoked_at,r.expires_at FROM upload_requests r WHERE ${predicate} ORDER BY r.id`).all(personId,personId);
  const submissions=database.prepare(`SELECT i.* FROM intake_submissions i JOIN upload_requests r ON r.id=i.request_id WHERE i.person_id=? OR ${predicate} ORDER BY i.id`).all(personId,personId,personId);
  const attempts=database.prepare(`SELECT a.* FROM intake_upload_attempts a JOIN intake_submissions i ON i.id=a.submission_id JOIN upload_requests r ON r.id=i.request_id WHERE i.person_id=? OR ${predicate} ORDER BY a.object_key`).all(personId,personId,personId);
  const capabilities=database.prepare(`SELECT c.* FROM intake_capabilities c JOIN intake_submissions i ON i.id=c.submission_id JOIN upload_requests r ON r.id=i.request_id WHERE i.person_id=? OR ${predicate} ORDER BY c.id`).all(personId,personId,personId);
  const sharedMediaToPreserve=database.prepare(`SELECT m.id,m.space_id,m.object_key,m.size,m.sha256 FROM media m JOIN intake_submissions i ON i.id=m.id
    WHERE i.person_id=? AND i.phase='accepted' AND m.status='ready' AND NOT EXISTS(SELECT 1 FROM personal_spaces WHERE space_id=m.space_id) ORDER BY m.id`).all(personId);
  return {...report,requests,submissions,attempts,capabilities,sharedMediaToPreserve};
}

// Snapshot-only identity minimisation retains every byte reservation and exact multipart/capability
// record. Closing access is not physical erasure or proof that previously admitted writes have ended.
export function minimiseIntakeIdentity(database,personId,email,now){
  const inventory=inspectIntakeSnapshot(database,personId);
  if(!inventory.complete)throw new Error('Incomplete intake schema requires review.');
  if(!inventory.present)return;
  database.prepare(`UPDATE upload_requests SET state='closed',revoked_at=COALESCE(revoked_at,?),revision=revision+1,
    recipient_email='',token_hash='erased-intake:' || id WHERE accepted_by=?
      OR issuer_membership_id IN(SELECT id FROM space_memberships WHERE person_id=?)
      OR (?<>'' AND lower(recipient_email)=lower(?))`).run(now,personId,personId,email,email);
}
