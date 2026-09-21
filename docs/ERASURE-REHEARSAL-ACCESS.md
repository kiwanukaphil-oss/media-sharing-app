# Isolated backup-erasure rehearsal access

Status: generated-only cloud erasure/restore rehearsal passed on 21 September 2026. Both the initial overbroad key and the later key whose one-time value appeared in browser output were revoked unused. An equivalent replacement with a shorter 3,300-second lifetime was independently scope-verified, encrypted locally, used only for the isolated test, then revoked after verification. Production data and credentials were unchanged.

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
- [x] Obtain revised-scope approval, create the isolated-bucket credential and verify/store it through the local encrypted handoff. Correct the handoff Referrer-Policy to same-origin so browser POST retains the required Origin; cross-origin requests remain rejected.
- [x] Upload generated fixture versions and record a pinned manifest; reject any pre-existing or unexpected object in the rehearsal scope.
- [x] Verify removal is limited to the generated manifest's exact versions; preserve the test shared copy and minimise the replacement snapshot.
- [x] Independently list versions and restore the surviving test records/bytes; verify no removed identity or private original is reconstructed.
- [ ] Verify the independent erasure-ledger authority and replay/restore reconciliation; document any remaining retention limitations.
- [x] Retire the temporary credential and record final evidence. Production lifecycle release remains gated until the full executor and operator workflow are verified.

No real account has requested erasure. No personal or shared production original is a candidate for deletion in this rehearsal.

## Cloud evidence

Run `cde4ced5-c85f-43fd-945c-14cb84373485`, verified at 2026-09-21T11:52:55.320Z using `scripts/run-erasure-backup-rehearsal.mjs`:

- Five encrypted generated versions uploaded: two versions of an old synthetic SQL snapshot, one private byte fixture, one independent shared fixture with the same bytes, and one minimised snapshot.
- All versions matched the generated manifest before mutation. Both preservation controls were downloaded and hash-verified first.
- Three obsolete generated versions removed by exact version ID/name. Independent final listing contained only the two preservation controls. Both restored with matching hashes.
- Restored SQL had one shared media record, no former provider identity, revoked device access and valid database relationships.
- Temporary credential was removed from the dashboard after verification. Two generated control objects remain as evidence and retirement candidates; they contain no production data.
- The independent authenticated erasure ledger, real-provider lifecycle and full live executor remain unverified; P2-06 is still open.

Private manifests and verification are under ignored `.sites-runtime/operations/erasure-rehearsals/<run-id>/`. The runner refuses a nonempty test prefix, production bucket credentials, missing preservation controls or unexpected versions. It cannot be rerun over existing evidence without a separately reviewed new test scope.
