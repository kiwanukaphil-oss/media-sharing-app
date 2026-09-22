import {AccountError,type AccountSession} from "./account-sessions";
import {accountClosureCommitAuthority} from "./account-closure-fence";

// Every delivery read rechecks all originals and the original sender's exact authority. Losing one
// source suspends the whole snapshot instead of silently presenting an incomplete selection.
export function deliverySourceAuthority(now=Date.now(),state:"draft"|"issued"|"suspended"="issued"){
  return {sql:`delivery_snapshots.state=? AND delivery_snapshots.revoked_at IS NULL AND delivery_snapshots.expires_at>?
    AND EXISTS(SELECT 1 FROM space_memberships issuer JOIN people p ON p.id=issuer.person_id LEFT JOIN personal_spaces personal ON personal.space_id=issuer.space_id
      WHERE issuer.id=delivery_snapshots.issuer_membership_id AND issuer.space_id=delivery_snapshots.space_id AND issuer.role='owner' AND issuer.revoked_at IS NULL AND p.disabled_at IS NULL AND (personal.space_id IS NULL OR personal.person_id=issuer.person_id)
      AND (delivery_snapshots.access_scope_id IS NULL OR EXISTS(SELECT 1 FROM scope_grants WHERE scope_id=delivery_snapshots.access_scope_id AND membership_id=issuer.id AND revoked_at IS NULL)))
    AND (SELECT COUNT(*) FROM delivery_items WHERE delivery_id=delivery_snapshots.id)=delivery_snapshots.file_count
    AND NOT EXISTS(SELECT 1 FROM delivery_items item WHERE item.delivery_id=delivery_snapshots.id AND NOT EXISTS(
      SELECT 1 FROM media m WHERE m.id=item.media_id AND m.space_id=delivery_snapshots.space_id AND m.access_scope_id IS delivery_snapshots.access_scope_id
        AND m.status='ready' AND m.archived_at IS NULL AND m.size=item.size AND m.sha256=item.sha256))`,bindings:[state,now]};
}

export function deliveryRecipientAuthority(session:AccountSession,now=Date.now()){
  const source=deliverySourceAuthority(now),closure=accountClosureCommitAuthority(session);
  return {sql:`(${source.sql}) AND (${closure.sql}) AND delivery_recipients.accepted_by=? AND delivery_recipients.revoked_at IS NULL
    AND EXISTS(SELECT 1 FROM account_sessions current JOIN people p ON p.id=current.person_id WHERE current.id=? AND p.id=?
      AND current.revoked_at IS NULL AND current.expires_at>? AND p.disabled_at IS NULL AND current.authenticated_at>=p.credentials_changed_at)`,
    bindings:[...source.bindings,...closure.bindings,session.personId,session.sessionId,session.personId,now]};
}

// A secret is a locator, never a library credential. First acceptance requires the invited verified
// email; later access remains tied to the same person even if their verified email changes.
export async function acceptDelivery(database:D1Database,session:AccountSession,hash:string,now=Date.now()){
  if(!/^[a-f0-9]{64}$/.test(hash))throw new AccountError(404,"This delivery is unavailable.");
  const source=deliverySourceAuthority(now),closure=accountClosureCommitAuthority(session);
  await database.prepare(`UPDATE delivery_recipients SET accepted_by=?,accepted_at=? WHERE token_hash=? AND accepted_by IS NULL AND revoked_at IS NULL AND ${closure.sql}
    AND EXISTS(SELECT 1 FROM delivery_snapshots WHERE id=delivery_recipients.delivery_id AND ${source.sql})
    AND EXISTS(SELECT 1 FROM account_sessions current JOIN people p ON p.id=current.person_id WHERE current.id=? AND p.id=?
      AND current.revoked_at IS NULL AND current.expires_at>? AND p.disabled_at IS NULL AND current.authenticated_at>=p.credentials_changed_at
      AND lower(p.verified_email)=lower(delivery_recipients.email))`)
    .bind(session.personId,now,hash,...closure.bindings,...source.bindings,session.sessionId,session.personId,now).run();
  const authority=deliveryRecipientAuthority(session,now);
  const result=await database.prepare(`SELECT delivery_snapshots.id,delivery_snapshots.title,delivery_snapshots.expires_at AS expiresAt
    FROM delivery_snapshots JOIN delivery_recipients ON delivery_recipients.delivery_id=delivery_snapshots.id WHERE delivery_recipients.token_hash=? AND ${authority.sql}`)
    .bind(hash,...authority.bindings).first();
  if(!result)throw new AccountError(404,"This delivery is unavailable for this account.");
  return result;
}
