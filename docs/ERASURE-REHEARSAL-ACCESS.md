# Isolated backup-erasure rehearsal access

Status: Backblaze sign-in verified on 21 September 2026. The first approved dashboard key was created, inspected and immediately revoked unused because its bundled role included bucket-setting writes. No backup object was changed. A replacement key form is staged for a separate empty private test bucket; revised-scope approval is pending.

## Purpose and exact boundary

Exercise removal of obsolete versions of generated personal test data, preservation of a separately retained shared copy, and restoration of a minimised test snapshot. Use only generated identities, SQL and byte fixtures under `relay/erasure-rehearsal/2026-09-21/` in the separate private, encrypted bucket `relay-erasure-rehearsal-20260921-a72c` (ID `ddc78f086527c63bae090c11`). Production bucket `6d377f58d5e7b62bae090c11` is explicitly rejected by the test credential validator.

Existing production roles remain unchanged: upload-only writer; read/list-only restore reader. The dashboard's Read and Write role also grants bucket settings, including encryption, lifecycle, logging, notifications and replication. File prefixes do not make that role acceptable on the production bucket. The revised proposal isolates those permissions to the new test bucket, additionally restricts file names to the test prefix, disables listing all bucket names and expires after 3,600 seconds. No key administration, bucket deletion or retention/governance bypass is accepted. New test uploads use this test credential; the production writer cannot access the isolated bucket.

The browser confirmation policy requires approval at the point of granting new security-sensitive access. Stage and show the exact achievable scope first. Store the credential through the existing ignored encrypted local handoff; never chat, Git or public CI. A signed-in account is needed to reach that concrete step. This document itself authorises no credential grant or production purge.

## Required evidence before execution can be considered complete

- [x] Current all-version backup listing uses read-only access and includes hidden/old versions and unfinished uploads.
- [x] Local minimisation uses an isolated database, binds the historical identity, preserves shared originals and disables restored access.
- [x] Verify signed-in access; reject and revoke the first overbroad dashboard key unused.
- [x] Create a separate private encrypted empty test bucket and stage a one-hour key with the exact test prefix.
- [x] Test production-bucket/prefix rejection, unexpected permissions/versions, checksums and preservation controls.
- [ ] Obtain revised-scope approval, create the isolated-bucket credential and verify/store it through the local encrypted handoff.
- [ ] Upload generated fixture versions and record a pinned manifest; reject any pre-existing or unexpected object in the rehearsal scope.
- [ ] Verify removal is limited to the generated manifest's exact versions; preserve the test shared copy and minimise the replacement snapshot.
- [ ] Independently list versions and restore the surviving test records/bytes; verify no removed identity or private original is reconstructed.
- [ ] Verify the independent erasure-ledger authority and replay/restore reconciliation; document any remaining retention limitations.
- [ ] Retire the temporary credential and record final evidence. Production lifecycle release remains gated until the full executor and operator workflow are verified.

No real account has requested erasure. No personal or shared production original is a candidate for deletion in this rehearsal.
