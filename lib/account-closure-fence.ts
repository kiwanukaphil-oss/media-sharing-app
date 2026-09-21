import { AccountError, type AccountSession } from "./account-sessions";

type WriteActor = { kind: "account"; session: AccountSession } | { kind: "legacy"; deviceId: string; spaceId: string } | { kind: "backup" };
type ClosureApproval = { id: string; personId: string; requestId: string; requestRevision: number; issuer: string; subject: string;
  planDigest: string; decisionDigest: string; approvalDigest: string; authorisedAt: number };

// Resolve closure scope from recorded identity/legacy-claim relationships, never a display name.
// A global backup admission intersects every closure because its snapshot can contain any person.
const admissionHasFence = `EXISTS (SELECT 1 FROM closure_fences f WHERE w.kind='backup' OR f.person_id=w.person_id OR
  (w.kind='legacy' AND EXISTS (SELECT 1 FROM legacy_owner_claims c JOIN space_memberships m ON m.id=c.membership_id
    WHERE c.device_id=w.device_id AND m.person_id=f.person_id)))`;

// These primitives are not wired to production routes until the complete writer audit and migration are
// ready. Admission and closure share D1 ordering: either the write is tracked before the fence, or denied.
export async function admitClosureTrackedWrite(database: D1Database, actor: WriteActor, now = Date.now()) {
  const id = crypto.randomUUID();
  let authority: string, bindings: (string | number)[], personId: string | null = null, deviceId: string | null = null;
  if (actor.kind === "account") {
    personId = actor.session.personId;
    authority = `EXISTS (SELECT 1 FROM account_sessions a JOIN people p ON p.id=a.person_id WHERE a.id=? AND p.id=?
      AND a.revoked_at IS NULL AND a.expires_at>? AND p.disabled_at IS NULL AND a.authenticated_at>=p.credentials_changed_at)
      AND NOT EXISTS (SELECT 1 FROM closure_fences WHERE person_id=?)`;
    bindings = [actor.session.sessionId, personId, now, personId];
  } else if (actor.kind === "legacy") {
    deviceId = actor.deviceId;
    authority = `EXISTS (SELECT 1 FROM devices d WHERE d.id=? AND d.space_id=? AND d.revoked_at IS NULL AND d.expires_at>?
      AND NOT EXISTS (SELECT 1 FROM personal_spaces WHERE space_id=d.space_id)) AND NOT EXISTS
      (SELECT 1 FROM closure_fences f JOIN space_memberships m ON m.person_id=f.person_id JOIN legacy_owner_claims c ON c.membership_id=m.id WHERE c.device_id=?)`;
    bindings = [deviceId, actor.spaceId, now, deviceId];
  } else {
    authority = "NOT EXISTS (SELECT 1 FROM closure_fences)"; bindings = [];
  }
  const result = await database.prepare(`INSERT INTO closure_write_admissions
    (id,kind,person_id,device_id,generation,state,started_at) SELECT ?,?,?,?,0,'active',? WHERE ${authority}`)
    .bind(id, actor.kind, personId, deviceId, now, ...bindings).run();
  if (!result.meta.changes) throw new AccountError(409, "Account closure or changed access prevents this write.");
  return { id, generation: 0 };
}

export function closureAdmissionAuthority(id: string) {
  return { sql: `EXISTS (SELECT 1 FROM closure_write_admissions w WHERE w.id=? AND w.state='active' AND w.generation=0 AND NOT ${admissionHasFence})`, bindings: [id] };
}

// Settled means the caller awaited all effects; failed/ambiguous work must remain uncertain for review.
// Time passage never settles a record. No API is provided here to clear uncertain or abandoned work.
export async function settleClosureTrackedWrite(database: D1Database, id: string, outcome: "settled" | "uncertain", now = Date.now()) {
  const result = await database.prepare("UPDATE closure_write_admissions SET state=?,settled_at=? WHERE id=? AND state='active'")
    .bind(outcome, now, id).run();
  if (!result.meta.changes) throw new AccountError(409, "Tracked write changed; review its outcome.");
}

// The caller must independently verify concrete approval and signed intent before calling this operator
// primitive. Digests pin reviewed evidence, not self-authenticating permission. One atomic batch rechecks
// current intent/identity/last ownership, fences new writes, disables login and revokes only linked access.
export async function beginApprovedClosureFence(database: D1Database, approval: ClosureApproval, now = Date.now()) {
  if (![approval.id, approval.personId, approval.requestId].every(value => /^[A-Za-z0-9_-]{1,128}$/.test(value)) ||
      ![approval.planDigest, approval.decisionDigest, approval.approvalDigest].every(value => /^[a-f0-9]{64}$/.test(value)) ||
      !Number.isSafeInteger(now) || now <= 0 || typeof approval.issuer !== "string" || !approval.issuer.startsWith("https://") ||
      typeof approval.subject !== "string" || !approval.subject || approval.subject.length > 255 ||
      !Number.isSafeInteger(approval.requestRevision) || approval.requestRevision <= 0 || approval.requestRevision > now ||
      !Number.isSafeInteger(approval.authorisedAt) || approval.authorisedAt > now || now - approval.authorisedAt > 300_000) {
    throw new AccountError(400, "Current reviewed closure approval is required.");
  }
  const guard = "EXISTS (SELECT 1 FROM closure_fences f JOIN people p ON p.id=f.person_id WHERE f.id=? AND f.person_id=? AND f.request_id=? AND f.source_revision=? AND f.plan_digest=? AND f.decision_digest=? AND f.approval_digest=? AND p.issuer=? AND p.subject=?)";
  const guardValues = [approval.id, approval.personId, approval.requestId, approval.requestRevision, approval.planDigest, approval.decisionDigest, approval.approvalDigest, approval.issuer, approval.subject];
  await database.batch([
    database.prepare(`INSERT INTO closure_fences(id,person_id,request_id,source_revision,generation,phase,plan_digest,decision_digest,approval_digest,created_at)
      SELECT ?,p.id,r.id,r.updated_at,1,'draining',?,?,?,? FROM account_deletion_requests r JOIN people p ON p.id=r.person_id
      WHERE r.id=? AND p.id=? AND r.updated_at=? AND r.status IN ('pending','review_required') AND p.disabled_at IS NULL
      AND p.issuer=? AND p.subject=? AND NOT EXISTS (SELECT 1 FROM space_memberships m
        WHERE m.person_id=p.id AND m.role='owner' AND m.revoked_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM personal_spaces WHERE space_id=m.space_id)
        AND NOT EXISTS (SELECT 1 FROM space_memberships other JOIN people owner ON owner.id=other.person_id
          WHERE other.space_id=m.space_id AND other.person_id<>p.id AND other.role='owner' AND other.revoked_at IS NULL AND owner.disabled_at IS NULL))
      ON CONFLICT DO NOTHING`).bind(approval.id, approval.planDigest, approval.decisionDigest, approval.approvalDigest, now,
        approval.requestId, approval.personId, approval.requestRevision, approval.issuer, approval.subject),
    database.prepare(`UPDATE people SET disabled_at=COALESCE(disabled_at,?) WHERE id=? AND ${guard}`).bind(now, approval.personId, ...guardValues),
    database.prepare(`UPDATE account_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE person_id=? AND ${guard}`).bind(now, approval.personId, ...guardValues),
    database.prepare(`UPDATE devices SET revoked_at=COALESCE(revoked_at,?) WHERE id IN
      (SELECT c.device_id FROM legacy_owner_claims c JOIN space_memberships m ON m.id=c.membership_id WHERE m.person_id=?) AND ${guard}`)
      .bind(now, approval.personId, ...guardValues),
    database.prepare(`UPDATE account_deletion_requests SET status='review_required',updated_at=MAX(updated_at+1,?)
      WHERE id=? AND status='pending' AND ${guard}`).bind(now, approval.requestId, ...guardValues),
  ]);
  const fence = await database.prepare(`SELECT id,generation,phase FROM closure_fences WHERE id=? AND ${guard}`).bind(approval.id, ...guardValues).first();
  if (!fence) throw new AccountError(409, "Intent, identity or ownership changed before closure could start.");
  return fence;
}

// A drained registered set is only one prerequisite. Uninstrumented writers, direct storage capabilities
// and backup coverage still prevent execution; this report deliberately cannot authorize erasure.
export async function inspectClosureFence(database: D1Database, id: string) {
  const fence = await database.prepare("SELECT person_id AS personId,generation,phase FROM closure_fences WHERE id=?").bind(id).first<{ personId: string; generation: number; phase: string }>();
  if (!fence) throw new AccountError(404, "Closure fence not found.");
  const unresolved = await database.prepare(`SELECT COUNT(*) AS count FROM closure_write_admissions w WHERE w.state<>'settled'
    AND (w.kind='backup' OR w.person_id=? OR (w.kind='legacy' AND EXISTS
      (SELECT 1 FROM legacy_owner_claims c JOIN space_memberships m ON m.id=c.membership_id WHERE c.device_id=w.device_id AND m.person_id=?)))`)
    .bind(fence.personId, fence.personId).first<{ count: number }>();
  return { ...fence, unresolvedWrites: unresolved?.count ?? 0, trackedWritesDrained: unresolved?.count === 0, executable: false };
}
