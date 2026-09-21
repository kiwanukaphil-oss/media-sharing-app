// Return aggregate signals only; account identities and request details stay in the private database.
export const identityOperationsQuery = `SELECT
  (SELECT COUNT(*) FROM account_deletion_requests WHERE status IN ('pending', 'review_required')) AS requests_to_review,
  (SELECT COUNT(*) FROM account_deletion_requests WHERE status NOT IN ('pending', 'review_required', 'withdrawn')) AS unknown_request_states,
  (SELECT COUNT(*) FROM people p JOIN recovery_watermarks w ON w.issuer=p.issuer AND w.subject=p.subject
    WHERE p.credentials_changed_at < w.changed_at) AS unreconciled_watermarks,
  (SELECT COUNT(*) FROM account_sessions s JOIN people p ON p.id=s.person_id
    LEFT JOIN recovery_watermarks w ON w.issuer=p.issuer AND w.subject=p.subject
    WHERE s.revoked_at IS NULL AND s.expires_at > unixepoch()*1000
      AND (p.disabled_at IS NOT NULL OR s.authenticated_at < MAX(p.credentials_changed_at, COALESCE(w.changed_at,0)))) AS stale_active_sessions`;

// Fail closed on missing schema/results; never turn an unavailable check into a green operational report.
export function evaluateIdentityOperations(rows) {
  const messages = {
    requests_to_review: 'Account deletion requests need private operator review; no deletion was performed.',
    unknown_request_states: 'Unrecognised deletion state requires operator review.',
    unreconciled_watermarks: 'Recovery watermark reconciliation requires investigation.',
    stale_active_sessions: 'Sessions older than known recovery or disabled accounts require investigation.',
  };
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || Object.keys(messages).some(key =>
    !Number.isSafeInteger(rows[0][key]) || rows[0][key] < 0)) throw new Error('Identity operations response is incomplete.');
  return Object.entries(messages).filter(([key]) => rows[0][key] > 0).map(([, message]) => message);
}

