# Account closure execution contract

Status: implementation contract, 21 September 2026. No closure executor or production freeze is enabled. This refines P2-06; request submission still only records revocable intent.

## User-facing boundary

A pending request leaves the account active and can be withdrawn. Before execution, the operator obtains fresh identity confirmation, rechecks shared ownership handover and presents the exact personal-content scope and shared copies that remain. Execution requires concrete irreversible-operation authority. The interface must distinguish “Requested”, “Review required”, “Closure in progress” and verified completion; it must never derive completion from a disabled login or an empty current library.

Withdrawal remains available until the approved execution starts. Once physical removal begins, cancellation cannot promise recovery of already removed content. A failed or interrupted operation stays in review with access fenced; it must not automatically reactivate because a lease or timer expired. Any reopening is an explicit, audited operator decision and cannot resurrect removed data.

## Required sequence

1. Capture current request identity and revision, independently record the decision and pin the approved dry-run plan. Reject a withdrawal, ownership change, mismatched provider subject or changed inventory. A prior signed fulfilment record is never fabricated to start execution.
2. Acquire a durable closure fence for the person and personal space. Advance an operation generation; every subsequent write reservation and commit must check that generation atomically. Revoke person sessions and positively linked legacy credentials without disconnecting unrelated members. Recheck the last-owner rule in the transaction that establishes the fence.
3. Stop new personal uploads, multipart URL issuance, preview writes, publications and identity/profile changes. Reconcile already admitted operations. Preserve a durable record of every reserved original/preview/attempt key before cloud work begins, including allocations that fail before their media row is created.
4. Coordinate independent backup writers. A backup begun before the fence can finish later and create another retained copy; pausing future schedules alone is insufficient. Require a writer generation/lease acknowledgement and account for every in-flight snapshot/version. A restore remains quarantined throughout reconciliation.
5. Repeat the D1, R2 object/multipart, provider and all-version B2 inventories under the fence. Match exact object/version IDs and dependency hashes. Stop on unknown objects, held versions, missing mappings or unreviewed schemas; do not expand the approved scope automatically.
6. Execute only the pinned approved disposition. Keep shared originals and valid shared metadata, including independently published copies and content-addressed blobs still referenced by retained snapshots. Replace affected recovery metadata with verified minimised recovery points before removing approved obsolete versions. Verify retained recovery points independently.
7. Remove the exact provider identity only under its separate approved operation. Verify absence through an independent read path. Failures or ambiguous provider responses remain unresolved; email/name matching is insufficient.
8. Verify live data, all retained snapshots, multipart leftovers, provider outcome and independent ledger custody. Record evidence hashes and durable history, then publish a fulfilled decision through a monotonic head update. Only this verified outcome may drive future restore minimisation.

## Current gaps found in the implementation review

| Boundary | Present behaviour | Remaining requirement |
| --- | --- | --- |
| Transfer metadata commit | Live account/session/membership or legacy authority is rechecked in the D1 mutation | Durable closure generation and tracked admission for every writer |
| Direct multipart parts | URLs last up to one hour; access revocation stops later authenticated requests | Stop issuance under the fence; abort/reconcile exact multipart IDs and account for requests already admitted by storage |
| Preview upload | Server receives a bounded JPEG and rechecks authority before reservation/commit | Track in-flight storage work so a late object cannot appear after final erasure verification |
| Publication | Lease, authority and source checks precede visibility; attempt keys are tracked | Fence both admission and completion; independently reconcile all late attempt writes |
| Library metadata APIs | Live album/section/rename/organisation/date mutations recheck account/session/membership and current owner role atomically; personal allocation rechecks recovery | Complete generation coverage and remaining profile/claim/invitation transitions |
| Backups | Independent scheduled writer; all versions are retained | Shared fencing protocol, active-writer acknowledgement and historical replacement verification |
| Decision evidence | Verified protected custody, independent archive recovery and single-operator live intent synchronization | Bind verified executor outcomes; coordinate application and backup writers before fulfilment |

**Waiting one hour is not proof of a freeze.** A presigned URL's expiry bounds admission, not necessarily the completion of a request admitted earlier. Equal before/after listings detect observed changes but do not exclude a late writer. The executor must prove writer quiescence or continue reconciliation and remain unfulfilled. It must not convert a convenient settling interval into an erasure guarantee.

## Acceptance

- [ ] Revoke during a deliberately stalled upload, preview and publication; prove no late visible or untracked object escapes reconciliation.
- [ ] Withdraw or change ownership concurrently with execution start; prove the fence does not bypass current intent or strand the last shared owner.
- [ ] Interrupt and retry each provider/database/object/backup step without expanding scope or harming retained content.
- [ ] Lose the application database and recover current decisions from independently protected custody; reject a stale head or old backup.
- [ ] Verify a complete generated-identity cloud rehearsal with concrete removal authority before exposing fulfilled deletion in production.

The restricted pilot remains the current release boundary. This contract does not introduce a deletion deadline, automatic purge, new service purchase or production identity removal.

## Isolated fence protocol implemented

`lib/account-closure-fence.ts` and `deploy/closure-fence-prototype.sql` implement the first protocol layer, exercised against actual isolated D1. A single batch rechecks request revision, provider identity and shared last-owner protection, then records generation 1, disables the exact person and revokes sessions/positively linked legacy access. Tests prove the batch rolls back on interruption and preserves unrelated members/devices. Exact operation retries are idempotent. Approval digests pin the caller's reviewed evidence; they are not proof of user authority by themselves. No public route invokes this operator primitive.

Write admissions are recorded before effects. A generation predicate denies commits after the fence; current route-specific authority must also be checked. Global backup admissions intersect every closure; positively recorded device claims bind legacy admissions. Active or uncertain work blocks drain indefinitely. Time passage is not settlement, and the primitive provides no automatic clearance of uncertain work. All registered effects must be awaited before a caller records settlement.

This schema is not in the application migration journal and has not been applied to production. Application route integration, tracked storage keys/capabilities, backup writer integration, coverage proof, restore-schema review and closure-status UX remain required. Even zero registered outstanding writes reports `executable: false`; the prototype cannot prove that currently uninstrumented writers have stopped.

The isolated protocol now journals exact storage keys and multipart identifiers before dispatch. An admission cannot settle while any storage effect is active or uncertain. A stalled write tested against local R2 can finish after fencing, but remains recorded and cannot commit visible metadata. Lost storage responses and failed D1 acknowledgements retain uncertainty. Multipart allocation records its returned upload ID; a lost allocation response retains the key for inventory reconciliation. Acknowledgement means an operation finished, not that the resulting object was removed. Direct presigned capabilities and cloud network semantics are not covered by this local test.

### Writer integration inventory

| Writer | Required integration before activation |
| --- | --- |
| `lib/server.ts` upload initialization | Record key before multipart allocation; retain failed allocation and abort outcomes even when no media row exists. |
| `app/api/[...path]/route.ts` part URL, proxy part and completion | Track issued capabilities separately from awaited server writes; bind multipart ID and part number. Never settle a direct capability merely because the URL expired. |
| `lib/web-api.ts` thumbnail, restart and cancellation | Track original/preview effects and old/new multipart IDs. Keep cleanup available through a separately reviewed operator path after normal writer admission is fenced. |
| `lib/publications.ts` original/preview copy and cleanup | Track each attempt effect through final acknowledgement; combine closure generation with existing source/destination authority at commit. |
| `scripts/relay-backup.mjs` snapshot export and uploads | Admit before export, record snapshot and every uploaded version, acknowledge only after all writes finish. Add a narrow authenticated coordinator; the existing D1 read-only credential must remain read-only. |

This inventory covers the observed storage-write entry points, not yet a proof of every metadata mutation. The application migration remains held until route coverage, direct capabilities, backup coordination and restore quarantine are reviewed together.

### Backup coordination implementation (inactive)

`lib/backup-closure-coordination.ts` accepts bounded, purpose-separated HMAC commands for backup admission and settlement only. Admission and a stable snapshot/run binding are written in one D1 batch, ordered against closure. Duplicate requests cannot start a second admission; settled or uncertain runs cannot reopen. Existing admitted work can finish after a fence, but new runs are refused. Active storage effects prevent settlement. The writer supplies a receipt digest after awaiting effects; this binds its evidence but does not independently validate all backup contents.

`scripts/backup-closure-client.mjs` is integrated around snapshot creation, before the first database export. Once enabled it refuses partial configuration and unavailable/invalid admission, waits for the copy callback and records completion evidence. Interrupted work remains active or uncertain; timeouts never clear it. Private run IDs survive ambiguous responses for operator review. The current deployed backup path remains unchanged while both activation variables are absent.

A dormant coordinator route is now wired behind `RELAY_BACKUP_COORDINATION_ENABLED=true`; it returns private 404 responses by default. Enabled-route tests through the actual built Worker reject browser Origin, invalid signatures and extra fields, preserve stable retry identity, and prevent reopening terminal runs. A 10-second body read deadline cancels stalled requests. No coordinator route, secret, schema migration or GitHub environment activation has been deployed. Activation requires all of these together, a reviewed recovery/quarantine treatment for the new tables, and an observed hosted backup under the protocol. `RELAY_BACKUP_COORDINATION_ENABLED=true` plus a separate `RELAY_BACKUP_COORDINATION_SECRET` will be required; do not reuse the monitoring key or broaden D1 read permissions. The new coordinator is not an erasure execution endpoint.

Restore sanitisation now recognises the complete protocol table family: fences remain disabled and move to review, active admissions/effects become uncertain, and completed receipt evidence stays intact. An incomplete table family aborts and rolls back sanitisation. Actual-schema tests verify these rules and repeat safety. This quarantine support is not a review of personal-data minimisation: the erasure transformer still rejects schemas beyond migration 0018 until the new identity/key references receive their own explicit minimisation treatment.

### Remaining metadata review targets

The 22 September correction is implemented, tested and deployed in source `591d2ab`: compatibility attribution inserts recheck live membership/session/person/recovery authority inside the atomic D1 batch and use the current profile name. Claim preview insertion repeats live device/account checks; claim confirmation and people-management writes enforce the credential watermark. Actual-schema tests force recovery/revocation between the initial read and mutation and confirm that rejected effects are absent. Production deployment and passed fresh signed-in verification are recorded in `deploy/STATUS.md`. This closes these stale-authority gaps, but does not complete closure-generation admission or the full writer audit.

### Provider component rehearsal

The explicitly approved provider fixture was created, checked, removed and independently confirmed absent on 22 September at 06:08 UTC. The rotated temporary client grant and connection access were revoked afterwards. See [provider evidence](PROVIDER-ERASURE-REHEARSAL.md#rotated-continuation--passed). The acceptance item above remains open because the complete generated-person storage/backup/ledger sequence is not yet executed.

### Direct-upload capability reservation (isolated only)

The prototype records the exact object key, multipart upload ID, part number and URL admission deadline before a caller signs/returns a part URL. No signed URL or bearer is stored. Issued capabilities remain uncertain and block write settlement even after their deadline; a lost response or client completion cannot clear them. New reservations are rejected after fencing. Tests cover exact custody, invalid targets/deadlines, fence ordering and expiry without settlement.

This is preparatory bookkeeping, not a completed direct-upload freeze: production part-URL issuance is not wired to it, and a separately reviewed storage reconciliation must establish multipart quiescence before any clearance. The prototype schema remains outside the migration journal and the snapshot minimiser still refuses unreviewed schemas.

### Delayed sign-in after minimisation

Account-session creation now checks the same issuer/subject digest retained by the snapshot minimiser before both profile insertion/update and session insertion, inside D1. This prevents a previously verified callback from recreating an identity whose original provider columns have been anonymised. Actual-schema tests cover a tombstone alone, an inconsistent duplicate active row and unrelated login. No erasure is performed by this guard; full executor and restore reconciliation remain required.
