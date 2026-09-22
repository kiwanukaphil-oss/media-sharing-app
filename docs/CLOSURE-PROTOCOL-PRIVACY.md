# Closure protocol privacy review

Reviewed 22 September 2026. This covers the isolated schema in `deploy/closure-fence-prototype.sql`; it does not authorise production migration, object removal or fulfilled erasure. The snapshot minimiser still accepts only the reviewed migration-0018 schema.

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
- [x] Verify actual migration-plus-prototype snapshots, unchanged source rows, historical inventory integration and existing minimisation regressions.
- [ ] Define and authenticate exact external disposition receipts and minimal retained evidence before adding a protocol-schema minimisation transform.
- [ ] Prove every application/backup writer is covered and verify the generated-person full lifecycle rehearsal before activating production closure.

The new inventory is evidence for review, not a deletion plan or a schema allowlist expansion.
