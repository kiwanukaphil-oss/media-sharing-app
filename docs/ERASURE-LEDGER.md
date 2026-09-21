# Authenticated erasure decisions during restore

Status: verification boundary, isolated snapshot integration and local durable-journal transaction prototype implemented and tested on 21 September 2026. **Owner-protected signing custody and an initial empty independent archive are verified. General decision publishing and production erasure execution remain unimplemented.** P2-06 remains open.

## Why this is separate from the backup

A valid old backup can predate an account deletion or a withdrawal. Restoring its request table is therefore insufficient. Recovery needs current decision evidence stored outside the recovery point, with an independently trusted public key and current manifest head. The application and backup uploader must not acquire ledger-signing authority.

The verifier uses Node's standard [Ed25519 signature verification](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptoverifyalgorithm-data-key-signature-callback). A signature authenticates a statement; it does not prove that data was actually erased or that an operator included every decision. Those remain executor and independent verification obligations.

## Implemented contract

`verifyErasureLedger(envelope, trust, now)` verifies an exact signed JSON payload. The envelope contains only base64url `payload` and `signature`. Signed bytes are `relay-erasure-ledger-v1` followed by a newline and the exact UTF-8 payload. No algorithm or key supplied by the envelope is trusted.

The payload includes format version, ledger ID, key ID, positive revision, issue/expiry times and decision records. Records include opaque person/request IDs, issuer/subject digest, current state, update time and an evidence digest only for fulfilled decisions. There is one current record per person, request and provider identity. Prior decision history must be retained separately by the future writer. Emails, names, object keys and provider subjects are excluded.

The separate trust input pins the public key, ledger/key IDs, exact revision and SHA-256 payload digest. Its current head must have been independently checked within five minutes. A manifest expires within one hour of issue; freshness refresh must preserve all decisions. Replayed signed revisions and same-revision forks cannot match the independent current digest. Unknown fields, ambiguous JSON, invalid encodings, duplicate identities and oversized payloads fail closed.

**Trust inputs must not be read from the restored SQL, its backup manifest, or the submitted envelope.** The library cannot prove where its caller obtained them. Supplying a self-declared digest or simply resetting `headCheckedAt` defeats the currentness guarantee. A deployed, authenticated head reader with protected monotonic revision updates is still required. Until it exists, this is an isolated verification component, not production restore clearance.

`reconcileErasedSnapshot` requires a verified current fulfilled decision before invoking the existing in-memory transformation. Pending, withdrawn, review-required and missing decisions cannot authorise it. Identity binding is checked again against the historical provider identity. Output remains quarantined with `cutoverAllowed: false` and `cloudErasureVerified: false`; the wrapper never modifies live data or cloud objects. The original low-level minimisation helper remains for synthetic rehearsals; it is not a production restore entry point.

## Acceptance and remaining work

- [x] Verify authentic signatures and exact independent heads; reject wrong keys, tampering, rollback, forks, stale/future heads and expired manifests.
- [x] Reject ambiguous/unknown schemas, duplicate identity decisions and incomplete fulfilment evidence references.
- [x] Confirm pending/withdrawn/review-required decisions do not trigger minimisation.
- [x] Exercise the verified wrapper against the actual schema, preserving shared copies and quarantining access.
- [x] Provision protected operator signing custody, an encrypted portable cloud vault and immutable archive storage. Pin the public verification root independently in `deploy/erasure-ledger-public-root.json`; a separate read-only CLI verified the initial head without the application database or private key.
- [ ] Implement atomic append/history and monotonic head updates; prove decisions survive loss of the application database and stale-backup restore.
- [ ] Connect request/withdrawal/fulfilment transitions, current provider/live-object/backup evidence and write-freeze enforcement. An evidence digest alone is not independent evidence validation.
- [ ] Reconcile every relevant person and historical snapshot, including missing or older-schema identities, before any production cutover.
- [ ] Rehearse the complete cloud/provider lifecycle with concrete irreversible-operation authority and independently verify retained copies.

All tests generate disposable signing keys in memory. They do not sign real fulfilment statements, install service credentials or erase production data.

## Pre-account device profiles

The seven older production SQL versions match two actual migration shapes: **0002** and **0006**. Neither has person or personal-space tables. `minimise-legacy-device-snapshot.mjs` now rehearses these exact schemas with synthetic records. It preserves shared original references and organisation, replaces only explicitly bound device names/credentials, and quarantines all restored access. Unknown schema shapes and a device appearing in a different space fail closed; missing device bindings remain explicit unresolved evidence.

The additional evidence artifact is exact JSON with `formatVersion`, `personId`, `identityDigest`, `sourceSnapshotDigest` and `legacyDevices` (`deviceId`/`spaceId` pairs). Its SHA-256 must equal the current fulfilled ledger record's `evidenceDigest`. The evidence must match the same person/provider digest, use unambiguous identifiers and contain no duplicate device bindings. This binds the operator's historical association statement to the signed decision; it does not independently prove the original claim ceremony or execution outcome. The future producer must verify the source snapshot and immutable claim records before signing.

- [x] Rehearse both actual historical schemas with authenticated synthetic evidence; preserve other members' names and shared originals, revoke restored access and verify stable replay.
- [x] Reject altered evidence, withdrawn intent, cross-person/provider mismatches, duplicate bindings, wrong spaces and future schema additions.
- [ ] Produce and independently verify real historical association evidence through the deployed ledger/executor workflow. No real account was marked fulfilled and no retained production snapshot was transformed by these tests.

### Recorded-claim evidence preparation

`prepareLegacyErasureEvidence` derives an **unsigned review artifact** from a separately digest-pinned, schema-0018 source snapshot. It verifies the exact provider identity, database integrity, claim/session/membership person agreement, device/space agreement and claim chronology. A later revoked session or demoted membership does not erase the historical association. Unclaimed devices with matching names or email addresses are never inferred to belong to the person. Personal-space claims, tombstoned source identities and unknown schemas fail for review.

- [x] Test the actual schema with conflicting people/spaces, altered source bytes, later revocation, missing identities, tombstones and future schema changes.
- [x] Prepare private unsigned evidence from the already hash-verified production backup: **one person, one recorded legacy claim**. Source and results remain in ignored operations storage; no provider, database or backup was changed.
- [ ] Independently verify the complete historical association set and retain its provenance in the deployed ledger workflow before signing any real decision.

The caller must obtain the source digest from separately verified backup evidence, not from an arbitrary submitted SQL file. The artifact binds the source digest and excludes names, email addresses and credentials. It deliberately reports `historicalCompletenessVerified: false`: a snapshot can establish recorded associations but cannot establish that every earlier relationship was recorded. No production signing key or fulfilment statement is created by this preparation.

## Durable decision journal prototype

`erasure-ledger-journal.mjs` implements an independent SQLite journal for operator-workflow testing. It is **not an application migration** and the initial empty production journal has now been initialised following verified owner custody. The separately supplied Ed25519 public root is immutable within a journal; a private key is rejected as root input. Every manifest is signed, and a separate domain-separated journal signature binds its revision/digest to the accepted predecessor digest. A rejected concurrent proposal therefore cannot be substituted into the historical chain later.

Appending uses an immediate database transaction, an expected-head comparison and a single atomic history/head commit. Stale writers fail for renewed review. Interrupting the head update rolls back the inserted revision. Reads audit a bounded complete sequence and reject missing revisions, changed roots, invalid signatures or head/history disagreement. Size limits require a separate archival design rather than silent history truncation.

The transition policy retains every person and provider binding. New intent begins pending or held for review. Withdrawal requires a distinct new request before a later pending state. Pending cannot jump directly to fulfilled; review must precede it. Fulfilled decisions are terminal. Renewing manifest freshness preserves all decision records and their original update times. Superseded request IDs remain in authenticated history and cannot be reassigned to another person.

`verifyArchivedErasureLedger` audits expired signatures with an explicit `current: false` / `cutoverAllowed: false` result. It does not refresh a trust timestamp or supply an erasure receipt. The existing current verifier still rejects expired manifests and stale independent heads. This separation permits durable audit without treating old evidence as current restore authority.

- [x] Verify actual two-connection SQLite locking, stale-writer rejection, interruption rollback, signed predecessor links, withdrawal/re-request history, terminal fulfilment and freshness-only renewal.
- [x] Re-run current ledger, current-schema minimisation and both legacy-schema/evidence regressions after the shared signature-validation refactor.
- [ ] Provision independently recoverable key/storage custody and a production current-head reader; connect the actual request/withdrawal producer and verified executor.
- [ ] Prove loss of the application database does not lose current decisions, and rehearse complete cloud/provider execution before allowing fulfilment in production.

Local tests use only ephemeral signing keys and synthetic identities. A valid operator signature does not prove physical erasure; the journal does not replace the executor's independent evidence checks. Its return values deliberately lack production restore clearance.

## Signing custody handoff prepared

`prepare-erasure-signing-custody.mjs` provides a short-lived, single-use loopback form. The owner saves a unique recovery password in their own password manager and enters/confirms it in that form. The agent does not choose, read or submit the password. The form has exact Host/path/POST-Origin checks, bounded input, no secret reflection, no caching, framing denial and no external scripts. GET only renders an empty form, including when opened through a browser handoff link; it cannot create a key or upload anything.

On submission, a new Ed25519 key is protected locally using Windows DPAPI. A separate portable vault uses [Node's standard crypto APIs](https://nodejs.org/docs/latest-v24.x/api/crypto.html): fixed scrypt parameters (`N=131072`, `r=8`, `p=1`), random salt/nonce and AES-256-GCM, with the public root authenticated as associated data. Only that encrypted vault is uploaded to `relay/erasure-ledger/key-vaults/<key-id>.json` in the existing `relay-backups-20260918-a72c` bucket. The password is neither saved nor sent to Backblaze. Existing writer/reader roles are reused without broader access or a new subscription.

Setup independently downloads the pinned B2 version, verifies its bytes, decrypts it with the owner's password and tests the recovered signing key against the expected public root. Local plaintext private-key files are never written. Partial encrypted setup is retained for review; the tool refuses automatic replacement. A verified vault establishes key recoverability, not a deployed journal, fulfilled decision or erasure executor.

- [x] Test key recovery, wrong passwords, altered headers/ciphertext, root mismatch, strict size/format bounds and password/private-PEM exclusion from the portable vault.
- [x] Test loopback Host/Origin/path enforcement, password mismatch/duplicate fields, input bounds, no reflection and single-use provisioning; no production key is generated by these tests.
- [x] Verify existing scoped B2 writer/reader access and stage the empty local form for the owner.
- [x] Owner completed password-manager custody and local form submission. Actual pinned encrypted cloud backup download, decryption and recovered-key challenge verification passed.

## Independent archive reader

`prepareErasureArchiveEntries` exports an audited journal as immutable, individually signed revision objects under `relay/erasure-ledger/journal/<ledger-id>/`. These contain private pseudonymous decisions and must remain in the private backup bucket, not the public source repository. Only the public root belongs in a trust record; extra root fields, including private key material, are rejected.

`auditErasureLedgerArchive` verifies every retained version in that prefix, its exact filename/bytes, predecessor signature, complete sequence and decision progression. Re-uploading an old signed object cannot roll back the selected head. Duplicate identical uploads are harmless; competing revisions, including two validly signed alternatives, stop for review. Missing history, hidden records and unknown formats fail closed. Expired manifests may be audited, but this alone supplies no currentness claim.

`readCurrentErasureArchive` repeats the complete ledger catalog after reading the chain, rejects changes, and requires an unexpired latest manifest before returning a freshly checked head. The CLI adapter (`node scripts/read-erasure-ledger-archive.mjs <independent-public-root.json>`) uses only the existing B2 reader and saves details privately. Unrelated original-file uploads do not invalidate a ledger-only read. The independently pinned root must never be chosen from restored application SQL or the archive being assessed.

- [x] Test pinned bytes, full history, withdrawals, old-upload replay, catalog order, identical duplicates, validly signed conflicts, wrong roots, changing catalogs and expiry.
- [x] Implement the existing-reader B2 adapter without write or signing credentials; initial empty production revision 1 was subsequently published and independently read.
- [x] Publish verified initial empty archive revision 1 after custody and verify the actual independent read path: one revision, one version.
- [ ] Connect real transitions, writer coordination and executor evidence.

Even a successful current-head read reports `cutoverAllowed: false` and `cloudErasureVerified: false`. It authenticates current decision evidence; it does not perform account erasure, freeze writers or verify retained original bytes.

## Empty archive bootstrap prepared

After verified owner custody, `node scripts/bootstrap-erasure-ledger.mjs` can initialise and publish an **empty** signed journal using the Windows-protected key. It verifies the protected/public roots agree, audits any existing remote chain, uploads only missing matching immutable revisions and independently reads the final current head. A different/ahead remote history stops for review. All operator details remain private.

The bootstrap is deliberately incapable of creating, changing or fulfilling a person's decision. It refuses any populated journal. Re-running a fresh empty bootstrap is idempotent; an expired empty manifest can be renewed while retaining its earlier signed history. These paths and wrong-key rejection pass synthetic tests. Actual empty bootstrap and a separate read-only archive verification both passed following owner custody. No person decision was signed; no account or original was erased. General decision publishing and coordinated production writers remain separate implementation work.

Output remains limited to the named legacy device profiles with `cutoverAllowed: false` and `cloudErasureVerified: false`. Deliberately shared filenames, organisation and original-file metadata remain governed by the shared-content retention policy; these tests do not claim complete anonymisation.

### Verified custody and archive checkpoint

Owner submission completed on 21 September 2026. The local protected key and password-encrypted cloud vault were independently verified. The bootstrap published empty revision 1; the separate read-only CLI authenticated its exact immutable version and current signed head. Both cutover and cloud-erasure flags remain false. Custody evidence is private under `.sites-runtime/operations/erasure-signing-custody/`; archive readback is private under `.sites-runtime/operations/erasure-archive-reads/`. The manifest expires after one hour; this checkpoint is evidence of a successful read, not an indefinitely fresh head.

The independent non-secret verification root is pinned in `deploy/erasure-ledger-public-root.json`. It contains exactly ledger ID, key ID and the Ed25519 public key, never the signing key or recovery password. A separate cloud read using this repository-pinned root verified revision 1 without application SQL or local journal input. Root changes require an explicit reviewed custody rotation; never replace it with a root advertised by a backup under inspection.
