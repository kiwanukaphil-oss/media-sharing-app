import {AccountError,type AccountSession} from "./account-sessions";

// These predicates are preparation only, with no public route or active migration. A draft is never
// an upload grant; activation must atomically establish quota custody before switching to open.
export function intakeIssuerAuthority(now=Date.now()) {
  return {sql:`upload_requests.state='open' AND upload_requests.revoked_at IS NULL AND upload_requests.expires_at>?
    AND EXISTS(SELECT 1 FROM space_memberships issuer JOIN people owner ON owner.id=issuer.person_id
      JOIN albums destination ON destination.id=upload_requests.album_id
      WHERE issuer.id=upload_requests.issuer_membership_id AND issuer.space_id=upload_requests.space_id
      AND issuer.role='owner' AND issuer.revoked_at IS NULL AND owner.disabled_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM personal_spaces WHERE space_id=issuer.space_id)
      AND destination.space_id=issuer.space_id AND destination.access_scope_id IS upload_requests.access_scope_id
      AND destination.deleted_at IS NULL AND destination.archived_at IS NULL
      AND (upload_requests.section_id IS NULL OR EXISTS(SELECT 1 FROM album_sections section WHERE section.id=upload_requests.section_id AND section.album_id=destination.id AND section.deleted_at IS NULL))
      AND (upload_requests.access_scope_id IS NULL OR EXISTS(SELECT 1 FROM scope_grants grant WHERE grant.scope_id=upload_requests.access_scope_id AND grant.membership_id=issuer.id AND grant.revoked_at IS NULL)))`,bindings:[now]};
}

// Read the current session/identity in every accepting or mutating statement, not a stale email
// passed by the browser. An accepted grant belongs to one person even after their email changes.
export function intakeRecipientAuthority(session:AccountSession,now=Date.now()) {
  const issuer=intakeIssuerAuthority(now);
  return {sql:`(${issuer.sql}) AND upload_requests.accepted_by=? AND EXISTS(SELECT 1 FROM account_sessions current
    JOIN people recipient ON recipient.id=current.person_id WHERE current.id=? AND recipient.id=?
    AND current.revoked_at IS NULL AND current.expires_at>? AND recipient.disabled_at IS NULL
    AND current.authenticated_at>=recipient.credentials_changed_at)`,bindings:[...issuer.bindings,session.personId,session.sessionId,session.personId,now]};
}

// A stable invitation secret only locates the request. The database atomically binds its verified
// email to a person; no space membership, file read capability or second-person retry is created.
export async function acceptUploadRequest(database:D1Database,session:AccountSession,tokenHash:string,now=Date.now()) {
  if(!/^[a-f0-9]{64}$/.test(tokenHash))throw new AccountError(404,"This upload request is unavailable.");
  const issuer=intakeIssuerAuthority(now);
  await database.prepare(`UPDATE upload_requests SET accepted_by=?,accepted_at=?,revision=revision+1
    WHERE token_hash=? AND accepted_by IS NULL AND ${issuer.sql}
    AND EXISTS(SELECT 1 FROM account_sessions current JOIN people recipient ON recipient.id=current.person_id
      WHERE current.id=? AND recipient.id=? AND current.revoked_at IS NULL AND current.expires_at>?
      AND recipient.disabled_at IS NULL AND current.authenticated_at>=recipient.credentials_changed_at
      AND lower(recipient.verified_email)=lower(upload_requests.recipient_email))`)
    .bind(session.personId,now,tokenHash,...issuer.bindings,session.sessionId,session.personId,now).run();
  const recipient=intakeRecipientAuthority(session,now);
  const result=await database.prepare(`SELECT upload_requests.id,upload_requests.title,upload_requests.expires_at AS expiresAt,
    upload_requests.max_files AS maxFiles,upload_requests.max_file_bytes AS maxFileBytes,upload_requests.max_bytes AS maxBytes,
    (SELECT name FROM spaces WHERE id=upload_requests.space_id) AS receivingLibrary
    FROM upload_requests WHERE token_hash=? AND ${recipient.sql}`).bind(tokenHash,...recipient.bindings).first();
  if(!result)throw new AccountError(404,"This upload request is unavailable.");
  return result;
}
