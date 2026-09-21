# Authenticated erasure decisions during restore

Status: verification boundary and isolated snapshot integration implemented and locally tested on 21 September 2026. **No production signing key, hosted ledger, decision writer or production erasure executor is provisioned.** P2-06 remains open.

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
- [ ] Provision separately protected ledger storage, an operator-only signing key and independently recoverable public-key/current-head trust. No production credential is created by the local tests.
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

Output remains limited to the named legacy device profiles with `cutoverAllowed: false` and `cloudErasureVerified: false`. Deliberately shared filenames, organisation and original-file metadata remain governed by the shared-content retention policy; these tests do not claim complete anonymisation.
