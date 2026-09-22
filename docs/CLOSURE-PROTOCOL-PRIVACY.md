# Closure protocol privacy review

Reviewed 22 September 2026. This covers journal migration `0019_wild_nighthawk.sql` (formerly the isolated prototype); backup-only migration activation is tracked separately and this review does not authorise object removal or fulfilled erasure. The snapshot minimiser accepts migration 0018 plus the narrowly reviewed global-backup-only stage below. Account/device/storage closure references remain blocked.

## References and required treatment

| Record | Personal or retained reference | Required treatment before minimisation |
| --- | --- | --- |
| Closure fence | Person, request, decision/approval/plan digests | Retain the minimum pseudonymous decision binding needed to prevent resurrection. A digest is not proof that the underlying evidence is anonymous. Keep detailed evidence in protected operator custody. |
| Account admission | Person ID and timing | Keep unresolved work for reconciliation. A settled row is historical evidence, not independent proof of object removal. |
| Legacy admission | Device ID linked through an actor or recorded owner claim | Resolve all positive person links; never infer ownership from device names. An unbound device requires review, not automatic deletion or reassignment. Preserve other members' access and shared records. |
| Storage effect | Exact object key, multipart upload ID, part number and capability deadline | Preserve while work is unresolved. Clear identifying storage references only after separately verified disposition and a durable minimal receipt. Acknowledged operations can still refer to retained objects. |
| Backup run | Snapshot ID, admission and receipt digest | Treat as global scope. Preserve version dependencies until every affected historical version is reconciled. Never attribute a global backup exclusively to one person. |

## Historical state is not current storage state

A coordinated backup can export its own active admission before it completes. That historical row must not be silently changed to settled, nor mistaken for proof that the current writer is still running. Reconciliation needs separately authenticated completion evidence for the exact run and snapshot, together with present writer fencing. Likewise, an expired upload capability does not prove that a previously admitted request finished.

Restored databases retain the existing quarantine: active admissions/effects become uncertain, fences stay disabled for review, and no historical state enables execution. Partial protocol schemas cannot be treated as complete evidence.

## Implemented review support

- [x] Include a read-only protocol reference inventory in every inspected historical snapshot. Reports remain in the existing ignored private inventory directory; identifying rows are not printed by the CLI.
- [x] Distinguish positively linked account/legacy admissions, unbound legacy devices and global backup scope. Include completed effects because their storage references still matter.
- [x] Preserve unresolved capability evidence after expiry; flag incomplete table families. Reports always state `quiescenceProven: false`, `minimisationReviewed: false` and `cutoverAllowed: false`.
- [x] Verify actual migration-0019 snapshots, unchanged source rows, historical inventory integration and existing minimisation regressions.
- [x] Define and locally verify exact signed disposition-statement bindings and effect coverage; [contract and limitations](CLOSURE-DISPOSITION-EVIDENCE.md). No live receipt is signed.
- [ ] Independently verify external disposition evidence, define minimal retained evidence and integrate the protocol-schema minimisation transform.
- [ ] Prove every application/backup writer is covered and verify the generated-person full lifecycle rehearsal before activating production closure.

The new inventory is evidence for review, not a deletion plan or a schema allowlist expansion.


## Global-backup-only activation stage

The exact combined schema digest `94b6d4de5174007726b87356cec7f5f54272cc2e9d5b34c941f24c0041ab36e5` is conditionally reviewed, not generally allowlisted. `reviewMinimisationSchema` accepts it only while fences and storage effects are empty and every admission is an unambiguously paired global backup run with no person/device link. IDs, snapshot IDs, receipt digests, states, generations and timestamps are validated. Orphans or private free text cause rejection.

These global run/snapshot IDs and digests are retained to reconcile backup versions; no run is reassigned to the erased person. Historical active runs become uncertain through existing restore quarantine. Settled receipts remain intact. Actual-schema minimisation tests verify private-data minimisation, shared-original preservation, retained completed receipts, quarantine and replay stability. Any account/legacy admission, fence or object reference still refuses transformation pending authenticated disposition treatment. The gate applies to the whole snapshot, so another person's unsupported protocol references also require review.

This permits preparation of backup coordination while application closure tracking remains disabled. It does not authorise full closure, clear uncertainty or enable restored access.
