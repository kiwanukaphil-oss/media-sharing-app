# Duplicate assistance

P7-02 implementation, 22 September 2026. This feature helps people reuse an existing original without deleting or merging files. It builds on the settled audience rules; production activation remains behind the pending migration/backup gates.

## Workflow and boundaries

Select one active original and choose Find duplicate originals. The server accepts that file ID and current revision, never an arbitrary caller-supplied hash. It returns at most 50 same-size/fingerprint candidates within the exact same space and audience. An explicitly combined view does not widen the lookup; an owner without a restricted grant cannot probe restricted originals. Trash and unfinished uploads are excluded. A generic conflict response does not distinguish absent files from unavailable access.

The first label is **Matching recorded fingerprint**. A recorded upload hash alone is not proof of matching stored bytes. Verify originals streams both files, independently checks their lengths and SHA-256, and rechecks the current pair before reporting **Identical bytes verified**. Verification is bounded to 250 MiB per original, keeps no saved copy, and supports cancellation. Larger candidates remain explicitly unverified.

An Owner or Editor can choose a same-audience album and add the verified existing original using the ordinary guarded album-reference operation. This does not change either original, merge metadata, move bytes, widen an audience or remove an existing relationship. Undo removes only the reference actually added by that operation, with the returned revision. Viewers can inspect and verify but receive no organisation action. There is no automated deletion, automatic deduplication or cross-account existence signal.

While the dialog is open, current access is checked every 15 seconds in a visible tab; failed access clears candidate names and cancels active verification. Each stream also uses normal current download admission, and the pair is revalidated before verification success or reuse. Previously admitted downloads retain the application's documented capability lifetime; no instantaneous recall is claimed.

## Acceptance

- [x] Real D1 tests cover source revisions, restricted/combined/foreign-space isolation, revoked grants/sessions, hidden Trash, a 50-result bound and no storage-key/contact disclosure.
- [x] Independent stream checks cover matching bytes, false recorded hashes, truncation, denial, final access loss, cross-audience refusal, size limits and cancellation.
- [x] Mobile browser checks exercise candidate wording, verification, deliberate album reuse, Undo and revoked-name clearing. Screenshot inspection confirms fitting controls and wrapping names.
- [x] Prepared migration 0027 adds only an index for bounded fingerprint lookups. Query-plan tests use it. No table, content row, grant or byte changes are introduced.
- [x] Private production-export rehearsal preserves all original fields/rows in 25 existing tables through prepared migrations 0026/0027; restored indexes, protective triggers and access quarantine survive. Snapshot minimisation still passes and the table-shape digest remains the reviewed 0026 digest.
- [x] Hosted full regression at `676a370` passes both jobs in run `35752042399`; merged into main.
- [ ] Live migration/activation and deployed multi-person acceptance.

The 50-result limit is disclosed; this is a focused assistance tool, not a whole-library duplicate-cleaning service. No new service, email, AI processing or purchase is required.

Additional local Chromium, Firefox and WebKit checks pass verification, album reuse/Undo, focus return and revoked-name clearing. The dialog now restores its initiating button explicitly, including WebKit.
