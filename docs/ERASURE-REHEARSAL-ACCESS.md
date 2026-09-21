# Isolated backup-erasure rehearsal access

Status: prepared on 21 September 2026; Backblaze browser sign-in required. No new credential has been created and no backup version has been deleted.

## Purpose and exact boundary

Exercise removal of obsolete versions of generated personal test data, preservation of a separately retained shared copy, and restoration of a minimised test snapshot. Use only generated identities, SQL and byte fixtures under `relay/erasure-rehearsal/2026-09-21/` in the existing private backup bucket. Production originals and snapshots live under different prefixes and are outside this test credential's scope.

Existing production roles remain unchanged: upload-only writer; read/list-only restore reader. A rehearsal credential must be limited to the existing bucket, this exact test prefix and a short expiry (one day at most). Necessary capabilities are list/read/delete files for verification and cleanup of generated versions; uploads use the existing writer. Do not grant bucket deletion, key management, retention bypass or access to production prefixes. If the dashboard cannot express that scope, prepare a safer supported route before requesting access approval.

The browser confirmation policy requires approval at the point of granting new security-sensitive access. Stage and show the exact achievable scope first. Store the credential through the existing ignored encrypted local handoff; never chat, Git or public CI. A signed-in account is needed to reach that concrete step. This document itself authorises no credential grant or production purge.

## Required evidence before execution can be considered complete

- [x] Current all-version backup listing uses read-only access and includes hidden/old versions and unfinished uploads.
- [x] Local minimisation uses an isolated database, binds the historical identity, preserves shared originals and disables restored access.
- [ ] Create and verify a narrowly scoped, expiring rehearsal credential after the required browser approval.
- [ ] Upload generated fixture versions and record a pinned manifest; reject any pre-existing or unexpected object in the rehearsal scope.
- [ ] Verify removal is limited to the generated manifest's exact versions; preserve the test shared copy and minimise the replacement snapshot.
- [ ] Independently list versions and restore the surviving test records/bytes; verify no removed identity or private original is reconstructed.
- [ ] Verify the independent erasure-ledger authority and replay/restore reconciliation; document any remaining retention limitations.
- [ ] Retire the temporary credential and record final evidence. Production lifecycle release remains gated until the full executor and operator workflow are verified.

No real account has requested erasure. No personal or shared production original is a candidate for deletion in this rehearsal.
