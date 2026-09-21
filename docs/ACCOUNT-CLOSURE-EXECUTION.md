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
| Other metadata APIs | Request authentication plus route-specific checks | Audit every mutation for an atomic generation check, including profile/claim/invitation transitions |
| Backups | Independent scheduled writer; all versions are retained | Shared fencing protocol, active-writer acknowledgement and historical replacement verification |
| Decision evidence | Signature verification and isolated minimisation helpers | Independent recoverable signing custody, append history, current-head reader and real transition producer |

**Waiting one hour is not proof of a freeze.** A presigned URL's expiry bounds admission, not necessarily the completion of a request admitted earlier. Equal before/after listings detect observed changes but do not exclude a late writer. The executor must prove writer quiescence or continue reconciliation and remain unfulfilled. It must not convert a convenient settling interval into an erasure guarantee.

## Acceptance

- [ ] Revoke during a deliberately stalled upload, preview and publication; prove no late visible or untracked object escapes reconciliation.
- [ ] Withdraw or change ownership concurrently with execution start; prove the fence does not bypass current intent or strand the last shared owner.
- [ ] Interrupt and retry each provider/database/object/backup step without expanding scope or harming retained content.
- [ ] Lose the application database and recover current decisions from independently protected custody; reject a stale head or old backup.
- [ ] Verify a complete generated-identity cloud rehearsal with concrete removal authority before exposing fulfilled deletion in production.

The restricted pilot remains the current release boundary. This contract does not introduce a deletion deadline, automatic purge, new service purchase or production identity removal.
