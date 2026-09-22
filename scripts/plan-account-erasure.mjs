import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { importSnapshot } from './relay-backup.mjs';
import {inspectDeliverySnapshot} from './delivery-lifecycle.mjs';
import {inspectIntakeSnapshot} from './intake-lifecycle.mjs';
import { inspectClosureSnapshot } from './inspect-closure-snapshot.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Include exact positively linked effects plus global backups without exposing unrelated people's
// storage targets in this person's review. The full inventory digest detects changes outside scope;
// unbound legacy work still blocks review because absence of a link is not proof of unrelated ownership.
function inventoryClosureReferences(database, personId) {
  const protocol = inspectClosureSnapshot(database);
  if (!protocol.complete) return { present: protocol.present, complete: false, quiescenceProven: false };
  const admissions = protocol.admissions.filter(row => row.globalScope || row.personIds.includes(personId));
  const ids = new Set(admissions.map(row => row.id));
  return { present: true, complete: true, quiescenceProven: false,
    fullInventoryDigest: digest(protocol),
    fences: protocol.fences.filter(row => row.person_id === personId), admissions,
    effects: protocol.effects.filter(row => ids.has(row.admission_id)), backups: protocol.backups,
    unboundLegacyAdmissions: protocol.unboundLegacyAdmissionIds.length,
    orphanEffects: protocol.orphanEffectIds.length, orphanBackups: protocol.orphanBackupIds.length };
}

// Produce a private, read-only review inventory from one database snapshot, never an execution instruction.
// Scope comes from personal_spaces ownership, not file authorship, membership role, email or library names.
export function planAccountErasure(database, requestId) {
  const request = database.prepare(`SELECT r.id,r.person_id,r.requested_at,r.updated_at,r.status,
    p.issuer,p.subject,p.verified_email,p.disabled_at FROM account_deletion_requests r
    JOIN people p ON p.id=r.person_id WHERE r.id=?`).get(requestId);
  if (!request) throw new Error('Deletion request is not present in the supplied snapshot.');
  const person = request.person_id;
  const spaces = database.prepare('SELECT space_id,quota_bytes FROM personal_spaces WHERE person_id=? ORDER BY space_id').all(person);
  const personalMedia = database.prepare(`SELECT m.id,m.space_id,m.object_key,m.size,m.sha256,m.status,
    m.upload_id,m.archived_at,m.preview_ready,m.preview_size FROM media m
    JOIN personal_spaces ps ON ps.space_id=m.space_id WHERE ps.person_id=? ORDER BY m.id`).all(person);
  const ownershipBlockers = database.prepare(`SELECT m.space_id FROM space_memberships m WHERE m.person_id=?
    AND m.role='owner' AND m.revoked_at IS NULL AND NOT EXISTS(SELECT 1 FROM personal_spaces ps WHERE ps.space_id=m.space_id)
    AND NOT EXISTS(SELECT 1 FROM space_memberships other JOIN people p ON p.id=other.person_id
      WHERE other.space_id=m.space_id AND other.person_id<>m.person_id AND other.role='owner'
      AND other.revoked_at IS NULL AND p.disabled_at IS NULL) ORDER BY m.space_id`).all(person);
  const publications = database.prepare(`SELECT id,source_id,source_space_id,destination_space_id,phase,attempt_key,lease_expires_at
    FROM publications WHERE person_id=? ORDER BY id`).all(person);
  const attempts = database.prepare(`SELECT a.object_key,a.publication_id FROM publication_attempts a
    JOIN publications p ON p.id=a.publication_id WHERE p.person_id=? ORDER BY a.object_key`).all(person);
  const actors = database.prepare(`SELECT a.device_id,m.space_id FROM account_space_actors a
    JOIN space_memberships m ON m.id=a.membership_id WHERE m.person_id=? ORDER BY a.device_id`).all(person);
  const linkedDevices = database.prepare(`SELECT c.device_id,m.space_id FROM legacy_owner_claims c
    JOIN space_memberships m ON m.id=c.membership_id WHERE m.person_id=? ORDER BY c.device_id`).all(person);
  const sharedMedia = database.prepare(`SELECT m.id,m.space_id,m.object_key,m.size,m.sha256 FROM media m
    WHERE NOT EXISTS(SELECT 1 FROM personal_spaces ps WHERE ps.space_id=m.space_id)
    AND (m.device_id IN(SELECT a.device_id FROM account_space_actors a JOIN space_memberships s ON s.id=a.membership_id WHERE s.person_id=?)
      OR m.device_id IN(SELECT c.device_id FROM legacy_owner_claims c JOIN space_memberships s ON s.id=c.membership_id WHERE s.person_id=?)
      OR m.id IN(SELECT id FROM publications WHERE person_id=? AND phase='ready')) ORDER BY m.id`).all(person,person,person);
  // B2 originals are content-addressed. An independent shared copy can legitimately need the same bytes.
  const backupContent = [...new Set(personalMedia.filter(row => row.status === 'ready').map(row => row.sha256))].sort().map(sha256 => ({
    sha256, currentOtherSpaceReferences: database.prepare(`SELECT COUNT(*) AS n FROM media m WHERE m.sha256=? AND m.status='ready'
      AND NOT EXISTS(SELECT 1 FROM personal_spaces ps WHERE ps.space_id=m.space_id AND ps.person_id=?)`).get(sha256,person).n,
  }));
  const metadataReferences = {
    memberships: database.prepare('SELECT id,space_id,role,revoked_at FROM space_memberships WHERE person_id=? ORDER BY id').all(person),
    sessions: database.prepare('SELECT id,revoked_at,expires_at FROM account_sessions WHERE person_id=? ORDER BY id').all(person),
    invitations: database.prepare(`SELECT id,space_id FROM person_invitations WHERE accepted_by=? OR lower(email)=lower(?)
      OR created_by IN(SELECT id FROM space_memberships WHERE person_id=?) ORDER BY id`).all(person,request.verified_email,person),
    membershipEvents: database.prepare(`SELECT id FROM membership_events WHERE actor_id=?
      OR membership_id IN(SELECT id FROM space_memberships WHERE person_id=?) ORDER BY id`).all(person,person),
    recoveryWatermark: database.prepare('SELECT changed_at FROM recovery_watermarks WHERE issuer=? AND subject=?').get(request.issuer,request.subject) ?? null,
  };
  const blockers = ['fresh-requester-authorisation-required', 'live-write-freeze-and-reinventory-required',
    'all-r2-objects-and-multipart-inventory-required', 'all-backup-versions-and-snapshot-inventory-required',
    'provider-removal-authorisation-required', 'restore-erasure-ledger-and-verification-required'];
  if (request.status !== 'pending') blockers.push('request-is-not-current-pending-intent');
  if (ownershipBlockers.length) blockers.push('shared-last-owner-handover-required');
  if (personalMedia.some(row => row.status !== 'ready')) blockers.push('personal-uploads-need-reconciliation');
  if (publications.some(row => !['ready','cancelled'].includes(row.phase))) blockers.push('publication-operations-need-reconciliation');
  const deliveryReferences=inspectDeliverySnapshot(database,person);
  if(!deliveryReferences.complete)blockers.push('delivery-schema-inventory-incomplete');
  if(deliveryReferences.snapshots.some(row=>row.state!=='revoked')||deliveryReferences.recipients.some(row=>row.revoked_at===null))blockers.push('delivery-grants-need-revocation');
  const intakeReferences=inspectIntakeSnapshot(database,person);
  if(!intakeReferences.complete)blockers.push('intake-schema-inventory-incomplete');
  if(intakeReferences.requests.some(row=>row.state!=='closed'&&row.revoked_at===null))blockers.push('intake-requests-need-revocation');
  if(intakeReferences.attempts.length||intakeReferences.capabilities.length)blockers.push('intake-storage-disposition-required');
  if(intakeReferences.submissions.some(row=>row.phase!=='accepted'))blockers.push('intake-staged-originals-need-reconciliation');
  const preservedIds=new Set(sharedMedia.map(row=>row.id));
  for(const row of intakeReferences.sharedMediaToPreserve)if(!preservedIds.has(row.id)){sharedMedia.push(row);preservedIds.add(row.id);}
  sharedMedia.sort((left,right)=>left.id.localeCompare(right.id));
  const closureReferences = inventoryClosureReferences(database, person);
  if (!closureReferences.complete) blockers.push('closure-protocol-inventory-incomplete');
  else {
    if (closureReferences.admissions.some(row => row.unresolved) ||
        closureReferences.effects.some(row => row.state !== 'acknowledged')) blockers.push('tracked-writes-need-current-reconciliation');
    if (closureReferences.unboundLegacyAdmissions || closureReferences.orphanEffects || closureReferences.orphanBackups)
      blockers.push('unattributed-protocol-records-require-review');
    if (closureReferences.effects.length) blockers.push('tracked-storage-disposition-required');
  }
  const inventory = { request, personalSpaces:spaces, personalMedia, publications, publicationAttempts:attempts,
    accountActors:actors, linkedDevices, sharedMediaToPreserve:sharedMedia, backupContent, ownershipBlockers, metadataReferences,
    closureReferences, intakeReferences, deliveryReferences };
  return { formatVersion:1, mode:'review-only', executable:false, inventoryFingerprint:digest(inventory), blockers, inventory };
}

// Never print private identities, object keys or a SQL/provider error. Save only to the ignored operations folder.
async function saveErasureReview(snapshotPath, requestId) {
  if (!snapshotPath || !/^[a-f0-9-]{36}$/i.test(requestId || '')) throw new Error('Supply a local SQL snapshot and request UUID.');
  const sql = await readFile(snapshotPath,'utf8');
  const database = importSnapshot(sql);
  try {
    const plan = planAccountErasure(database,requestId);
    const directory = resolve('.sites-runtime/operations/erasure-plans');
    await mkdir(directory,{recursive:true});
    await writeFile(resolve(directory,`${requestId}-${Date.now()}.json`),JSON.stringify({ ...plan,
      snapshotSha256:createHash('sha256').update(sql).digest('hex'), generatedAt:new Date().toISOString() },null,2),{flag:'wx',mode:0o600});
    console.log('Private erasure review saved under ignored operations storage. No live state or backup was changed; execution remains blocked.');
  } finally { database.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await saveErasureReview(process.argv[2],process.argv[3]); }
  catch { console.error('Erasure review could not be prepared. Check the local snapshot and request privately; no execution attempted.'); process.exitCode=1; }
}
