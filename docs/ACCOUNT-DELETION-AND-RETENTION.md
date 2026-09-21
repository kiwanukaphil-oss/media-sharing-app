# Account deletion and retention

Status: local request workflow implemented and tested on 21 September 2026. Operator execution, request monitoring and an end-to-end erasure rehearsal remain release gates. This document records the actual present retention behaviour; it does not promise an unimplemented deletion deadline.

## What users can do

Your account offers a deliberate deletion review. It explains personal versus shared content, links to shared libraries needing ownership handover, and requires authentication within five minutes before submitting a request. A pending request is visible and can be withdrawn. The account stays active and no file is removed by submission. The request is not advertised as completed deletion.

Every shared library must have another active account owner before a request can be submitted. A legacy paired owner is insufficient: the intended surviving authority is a person with a recoverable account. Personal spaces never need a handover. The operator must repeat this check at execution because ownership can change after submission.

Shared uploads and explicit published copies remain with their shared libraries when a member leaves or requests account deletion. Deleting a private source cannot recall a shared independent copy or a recipient's download. This is an application data-handling rule, not a determination of copyright ownership. Media attribution can be retained under an anonymised actor without retaining the departing person's profile.

## Current retention

| Data | Current behaviour | Required treatment during account deletion |
| --- | --- | --- |
| Personal originals, previews, Trash and incomplete uploads | Stored until explicit removal; count against the personal allowance | Inventory and remove all owned object versions and incomplete transfers after confirmed execution authority |
| Shared uploads and published copies | Retained by the shared library | Preserve bytes, organisation and stable attribution; remove unnecessary person-identifying profile data |
| Trash | No automatic expiry | Do not treat Trash as already erased; include personal Trash in the inventory |
| Account/profile/session records | Server-side identity and access records | Revoke sessions and linked credentials, remove provider identity when authorised, then remove or minimise personal records without breaking shared references |
| Backup originals and snapshots | B2 keeps all versions; no pruning is installed. At least 30 days is a recovery target, not an upper bound | Identify every retained copy and snapshot containing the person's data. Do not promise a 30-day erasure deadline under the present policy |
| Deletion requests | Pending, withdrawn or held for renewed review | Preserve enough decision evidence to prevent restore from reversing a withdrawal or resurrecting deleted data; minimise identifying fields after fulfilment |

No automatic deletion or blanket backup age rule is introduced. A backup original may still be referenced by a kept snapshot belonging to other people.

## Operator review and execution gates

1. Review the pending queue through an authorised, private database connection. `deploy/account-deletion-review.sql` is a read-only queue query. Do not copy identities, filenames, object keys or provider credentials into public CI logs or tickets. Assign an operator and review cadence before exposing the request workflow in production.
2. Verify the request still exists, remains wanted, belongs to the provider issuer/subject in question, and has not been withdrawn. Reauthenticate the requester for irreversible execution; request submission alone is not authority for an unattended purge. Recheck ownership handover and active publication/upload operations.
3. Produce a private dry-run inventory of personal live originals, previews, Trash, incomplete multipart uploads, publication attempts, D1 references, Auth0 identity, B2 file versions and every affected snapshot. Separate shared independent copies and other people's content. Save counts and hashes for verification without spreading content.
4. Prepare explicit execution and rollback boundaries. Revocation precedes deletion. Prevent new writes/publications for the closing identity before taking the final inventory. Preserve other members' access and file references. Do not delete the last account owner or cascade through shared uploads.
5. Obtain the required concrete authorisation for irreversible operations. The present application only queues/withdraws requests: it provides no purge endpoint, no scheduled deletion job and no automatic provider-account removal.
6. Execute and independently verify the approved removal/minimisation plan. Backup processing must remove the affected personal data without silently destroying unrelated recovery points. A source-object deletion alone is not sufficient evidence. Record the surviving anonymised references and any explicitly disclosed retention exception.
7. Mark completion only when the verified live/provider/backup outcomes support it. If any copy remains or a dependency is unresolved, keep the request in review and give a truthful status; do not label it erased.

The destructive executor, backup-redaction/pruning policy, verified completion transition and operator monitoring are outstanding. They must be reviewed and rehearsed before the Phase 2 lifecycle parent item can be checked. The safe request workflow is useful groundwork, not a substitute for these release gates.

## Restore reconciliation

Restoration already revokes sessions, legacy access and memberships. It additionally converts a snapshot's pending deletion requests to `review_required`; withdrawn requests remain withdrawn. An old request cannot be fed directly into a deletion job. Before cutover, reconcile current requests, withdrawals and fulfilled erasures against surviving live/provider/operator evidence. Reapply fulfilled erasures to an isolated restoration before it can serve users; never revive a deleted identity from an old snapshot. Missing evidence means the affected access remains disabled pending review.

## Verification

Real-D1 tests cover sole-owner denial, handover, recent authentication, concurrent request idempotence, account isolation, withdrawal, CSRF, revoked sessions and preserved access. Browser fixtures cover preview, confirmation cancellation, submission, honest pending status and withdrawal. Restore tests cover pending intent held for renewed review and preserved withdrawal. These are local results; no real account or data was deleted.
