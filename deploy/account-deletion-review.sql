-- Read-only operator queue. Run privately; results contain personal identifiers and must not enter public logs.
-- A row is a request to review, never an executable deletion command.
SELECT r.id AS request_id, r.requested_at, r.updated_at, r.status,
       p.id AS person_id, p.issuer, p.subject, p.verified_email,
       p.disabled_at
FROM account_deletion_requests r
JOIN people p ON p.id = r.person_id
WHERE r.status IN ('pending', 'review_required')
ORDER BY r.requested_at, r.id;
