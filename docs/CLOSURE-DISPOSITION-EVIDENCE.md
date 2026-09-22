# Authenticated closure disposition evidence

Status: statement verifier implemented and locally tested on 22 September 2026. No live receipt has been signed and no deletion, uncertainty clearance or minimisation is enabled by this helper.

## Trust boundary

`scripts/verify-closure-disposition.mjs` verifies a separately pinned Ed25519 statement with domain `relay-closure-disposition-v1`. The trusted public key, key ID, exact payload SHA-256 and time of independent custody inspection must come from protected operator custody, never the envelope or restored database. Trust inspection expires after five minutes. The expected closure, person, identity digest, generation, plan, approval and inventory digests come from the reviewed fence and inventory.

The payload uses canonical JSON and rejects duplicate keys, unknown fields, noncanonical encoding, oversized input and signatures from the existing erasure-ledger domain. Its effect set must match the independently expected set exactly: no omitted, duplicate or extra effect digest. Each disposition is either `removed` or `retained-shared`, with a pinned evidence digest. Expiry, an acknowledged upload or an empty listing is not a permitted disposition.

Effect digests must bind the exact private inventory rows, including admission, object key, multipart ID, part number and capability deadline. The inventory digest additionally binds the full reviewed inventory, including global backup references and unrelated changes. The protected evidence package must retain the exact digest input bytes; filenames or latest-version aliases are insufficient.

## What authentication does and does not establish

A valid signature establishes the operator statement's authorship and exact binding. It does not inspect the referenced evidence, prove multipart quiescence, authorise irreversible actions, or establish that an external provider performed a removal. Even a valid result returns `executable: false`, `quiescenceProven: false`, `minimisationAllowed: false` and `cutoverAllowed: false`.

The quiescence evidence digest is mandatory so it cannot be silently omitted from a future review package. Its presence is not proof. Direct capabilities remain unresolved until the external evidence is independently evaluated. Historical statements can remain useful evidence; a fresh custody read does not make their observations current.

## Remaining integration

- [x] Validate detached signatures, independent digest pinning, exact identity/generation/scope, complete effect coverage and bounded canonical input.
- [x] Test stale trust, wrong domain, changed scope, missing/duplicate effects and rejected expiry-based assertions. Wire the tests into hosted verification.
- [ ] Produce and independently archive an actual disposition package after the authorised generated-person executor and provider/storage checks exist.
- [ ] Independently evaluate referenced quiescence/removal/retention evidence and exact retained shared dependencies.
- [ ] Bind verified outcomes into the current erasure decision head, then add the separately reviewed protocol minimisation transform.

There is intentionally no CLI signer or cloud writer here. Existing signing custody is not used by these tests; fixtures generate temporary in-memory keys.
