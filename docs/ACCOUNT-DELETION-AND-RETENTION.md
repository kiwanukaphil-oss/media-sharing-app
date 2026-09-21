# Account deletion and retention

Status: local request workflow implemented and tested on 21 September 2026. Operator execution, alert-delivery verification and an end-to-end erasure rehearsal remain release gates. A read-only scheduled queue check is live and hosted verification passed (35576462943); the combined provider/queue report is also verified, with external health monitor 4956708 Up. Alert receipt remains pending. This document records the actual present retention behaviour; it does not promise an unimplemented deletion deadline.

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

## Operational queue check

`Identity operations` runs twice hourly on main using the existing D1 read-only environment credential. It fails when pending or restore-held requests exist, when request states are unknown, or when known recovery watermarks/disabled accounts disagree with live sessions. It reports static categories only; no identities, request IDs, counts, filenames or credentials enter job logs. GitHub scheduling and notifications are best effort; successful manual execution alone does not prove notification delivery or missed-run detection.

The project operator reviews failed runs and uses `deploy/account-deletion-review.sql` privately to assess requests. A red run is a review task, never authority to erase data. Pending requests continue to flag until withdrawn or a future reviewed execution workflow records completion; do not silence the check to imply fulfilment. This check cannot detect an Auth0 reset whose event never reached Relay. Provider-side monitoring remains a separate gate.

## Read-only erasure review preparation

`node --disable-warning=ExperimentalWarning scripts/plan-account-erasure.mjs <local-snapshot.sql> <request-uuid>` prepares a private review under ignored `.sites-runtime/operations/erasure-plans/`. It does not query the provider, modify live data, remove backup versions or execute deletion. It requires an existing request and always reports `executable: false`.

The inventory identifies exact personal-space ownership, originals, Trash, incomplete uploads, publication attempts, linked devices/account actors, shared copies to preserve and profile/session/membership references. It rechecks sole shared ownership against other active account owners. Withdrawn, restored-for-review or unknown request states are blockers. A snapshot digest and inventory fingerprint support later comparison; they are not locks and cannot replace a fresh inventory after writes are frozen.

Backup originals are content-addressed. If an independently published shared copy or another space legitimately references the same SHA-256, deleting that B2 blob would damage someone else's retained content. The review therefore counts other current references and never treats a personal hash as an unconditional purge target. Every historical snapshot/version still needs separate inventory and metadata redaction; current D1 references alone cannot determine which backup objects may be removed.

- [x] Implement the private read-only planner and actual-schema tests for personal/shared isolation, Trash, active uploads, source/copy independence, duplicate-content dependencies, owner handover, disabled owners and withdrawn/restored intent.
- [ ] Complete live R2/multipart and all-version B2 inventories; identify orphaned objects and historical profile references.
  - [x] Implement and run the read-only B2 version/unfinished-upload catalog on 21 September: 43 versions and zero unfinished uploads. Private metadata stays in ignored operations storage. Subsequent historical and live R2 reconciliation results follow below.
  - [x] Inspect all eight retained SQL upload versions by exact B2 version ID and verified SHA-256. Inventory provider-identity digests, personal ownership and shared/content-addressed dependencies; seven historical schemas require separate minimisation treatment. Reconcile all eight manifest versions with their exact SQL and original catalog references; no SQL versions lack a manifest. The before/after version catalogs matched. A write freeze remains outstanding.
  - [x] Complete read-only live R2 object/multipart listing and reconcile exact D1 media, preview, Trash, publication-attempt and upload references: **31 objects, zero unfinished uploads, zero review anomalies**. Independent before/after R2 and D1 fingerprints matched. This is metadata consistency, not byte verification or a write freeze.
- [ ] Implement/rehearse an authorised write freeze, provider removal, database minimisation, backup snapshot replacement and an independent erasure ledger for restore reconciliation.
- [ ] Obtain concrete irreversible-operation approval and verify a synthetic end-to-end erasure/restore before marking lifecycle execution complete.

Plans contain private provider/object identifiers and must stay out of chat, Git and public CI artifacts. No production deletion request was submitted to exercise this planner; tests use synthetic in-memory databases.

## Backup version catalog

Run `node scripts/inventory-backup-versions.mjs` with the existing restore reader. It exhausts the [file-version catalog](https://www.backblaze.com/apidocs/b2-list-file-versions) and the separate [unfinished-upload catalog](https://www.backblaze.com/apidocs/b2-list-unfinished-large-files), retaining hidden and superseded versions. Their distinct prefix and cursor parameters are tested. Unknown record types, duplicate IDs, malformed pages and repeated cursors fail without saving a complete report.

The result is private review evidence, never deletion authority. Listing is not atomic: freeze relevant writes and repeat/reconcile before execution. The reader cannot inspect retention/hold settings; unknown settings remain explicitly unknown. Cataloging object versions does not inspect historical SQL for personal references, prove absence of replicas, or erase anything. The first live run found 43 completed versions and no unfinished uploads; no storage object or credential was changed.

## Isolated snapshot minimisation rehearsal

- [x] Implement `minimiseErasedSnapshot` as an isolated in-memory SQL transformation; no live database handle, network operation or file overwrite is accepted. Tested against schema through 0018. Table/column changes fail closed for review.
- [x] Bind the historical person to an issuer/subject digest. Replace profile, linked-device names and session identifiers with disabled tombstones; remove private media/album/section records, recovery identity and publication attempts. Preserve independent shared originals and other personal libraries. Keep minimal opaque relationship IDs and audit times so shared references remain valid.
- [x] Verify foreign keys, unchanged source input, preserved shared object keys, all-access quarantine, stable replay and wrong/missing identity rejection. A historical deletion request remains `review_required`, never automatically fulfilled.
- [ ] Integrate a separately authenticated, current erasure ledger and inventory every pinned historical snapshot before any production restoration or backup replacement.

This is a rehearsal helper, not the erasure executor: its direct receipt input is not authenticated, output is always `cutoverAllowed: false`, and no cloud/provider removal is claimed. The new [authenticated ledger wrapper](ERASURE-LEDGER.md) verifies an independently pinned signed decision before using this helper, with actual-schema integration tests. Production ledger storage, signing authority and current-head retrieval remain unprovisioned, so this does not yet clear the external-ledger gate. Shared media content and its deliberately shared metadata remain retained. Tombstones are pseudonymisation, not a claim of complete anonymity. Originals, previews, multipart data, historical backup versions and operator-held copies still require their separate verified disposition. Do not use the result as production cutover SQL until those gates are complete.

## Historical SQL version review

`node --disable-warning=ExperimentalWarning scripts/inventory-historical-snapshots.mjs` uses the existing read-only B2 credential. It downloads every retained SQL upload version by immutable ID, verifies size and SHA-256, opens each in an isolated in-memory database and saves a private reference report. Superseded versions with the same filename are inspected separately. The complete catalog is read again afterwards; any difference prevents a complete report. Equal reads are not an atomic snapshot or a write freeze.

The 21 September live review inspected **eight SQL versions** and **eight manifest versions**; **seven SQL schemas** predate the reviewed minimisation schema. Every manifest's table counts, media IDs, object keys, sizes, hashes and exact catalog versions agree with its pinned SQL. No SQL version lacks a manifest. This metadata review does not re-download original bytes or replace independent restore verification.

Older schemas remain explicit review gates, including snapshots without person/personal-space tables; absence of those tables is not proof that legacy metadata contains no personal information. The report includes identity digests and file-hash ownership references without printing identities or object names. Non-ready object disposition, live cloud storage reconciliation and historical schema transformations remain separate work. No backup was modified or deleted. Before account erasure, the independent ledger must retain verified historical account/legacy-device mappings needed to minimise pre-identity snapshots; a present-day provider digest alone cannot establish those older relationships.

## Live object and multipart reconciliation

`node scripts/inventory-r2-objects.mjs` reuses the existing bucket-scoped S3 reader. Only signed GET requests to the fixed production bucket are possible. It exhausts [ListObjectsV2 and ListMultipartUploads](https://developers.cloudflare.com/r2/api/s3/api/), validates the returned bucket, URL-encoded keys, counts, distinct IDs and pagination, and saves private metadata under ignored operations storage. ETags are opaque metadata, not SHA-256 proofs.

The operator tool uses PowerShell's built-in .NET XML parser instead of adding a JavaScript XML dependency. It requires Windows PowerShell locally or `pwsh` on Linux CI. DTDs/external resolvers are disabled, document sizes are bounded, duplicate/nested scalar fields and delimited listings are rejected. Fixtures verify encoded keys, pagination, malformed responses, entity rejection and GET-only signing.

`node --disable-warning=ExperimentalWarning scripts/reconcile-live-object-inventory.mjs` also uses the existing D1 read-only token. One fixed SELECT captures the relevant metadata atomically. Exact original/preview keys, ownership, Trash, publication attempts and multipart upload IDs are compared against R2. Unknown objects and mismatches are **review candidates**, never removal instructions. Personal ownership comes from the explicit personal-space record, not a filename or uploader label. The known operational health object is classified separately.

The live 21 September run found **31 objects, zero unfinished uploads and zero anomalies**. D1 and R2 were each read again and their fingerprints agreed. This remains `executable: false`, `atomicSnapshot: false`, `writeFreezeVerified: false`; a changing system can still race between observations. Before erasure, freeze writes, allow issued upload capabilities/in-flight work to expire or reconcile, repeat the inventories and independently verify disposition. No live object or account was changed.
