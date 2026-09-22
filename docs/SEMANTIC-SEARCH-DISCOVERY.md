# Optional semantic search: discovery decision

P7-06. 22 September 2026. Status: **discovery complete; do not build or enable a pilot now**. This is a product decision under standing execution authority, not a shipped feature or processing consent.

## Why this is the right sequence

Relay already provides filename/original-name search and scoped album, section, date, media-type and uploader filters; saved views are live. No observed search-failure study or participant-approved media collection is recorded in the project. We therefore cannot substantiate that image-content search is the next most valuable use of the budget. The access model, reliable handoffs and portable originals have clearer documented needs and remain the priority.

The promising future job is concrete: someone remembers "the outdoor group photo from that event" but not its filename. Semantic search could rank candidates for that request. It should supplement familiar browsing, not reorganise albums, apply hidden labels, identify faces or decide what users are allowed to see.

## Options considered

| Option | Practical effect | Decision |
| --- | --- | --- |
| Improve ordinary retrieval first | Uses the existing metadata and audience model, with no image processing service | Continue the approved retrieval roadmap |
| Opt-in image-content search within one audience | Could address visual-memory searches, but adds processing, index, retention and deletion obligations | Retain as a future bounded experiment |
| Default-on indexing of every space or identification of people | Introduces unrequested processing and substantially broader product obligations | Excluded from this roadmap |

No provider, model, commercial plan or price has been selected. No image, thumbnail, query or embedding has been sent to an AI service for this discovery. Incremental AI spending authorised by this document is **zero**.

## Evidence needed to reopen a pilot

First run an explicitly authorised, small retrieval study with willing users and media they are entitled to contribute. Record concrete failed tasks using current controls. Use synthetic or participant-approved examples; do not collect filenames, search text or private media in routine analytics.

Before a paid or externally processed pilot, present one concrete proposal that identifies the provider, exact data sent, processing location, retention/deletion terms, model/index storage, included usage, a hard spending ceiling and a shutdown procedure. Verify then-current provider documentation and pricing. An owner agreeing to the product roadmap does not consent on behalf of other people to image processing.

Proposed evaluation: use at least 20 representative, participant-approved retrieval tasks across the existing metadata baseline and the opt-in candidate. Record task success, time, false-positive results and perceived usefulness. Set go/no-go targets from the baseline before running the comparison. Do not use model confidence as a privacy or factual guarantee. No interviews or evaluation runs have occurred yet.

## Non-negotiable pilot boundaries

- Start with a named shared scope and a bounded, explicitly selected collection. Show an audience and processing summary before opt-in. Personal spaces require their owner's separate choice; an administrator cannot opt another person's private collection in.
- Keep the general library and restricted views distinct. Authorise candidates before ranking and again before returning results, counts, suggestions, snippets, thumbnails or URLs. Never retrieve broadly and merely hide unauthorised tiles in the browser.
- Store opaque asset IDs, immutable scope IDs and model/index versions. Treat embeddings, generated captions and cached search results as protected derived data. Do not promise that those derivatives are anonymous.
- A grant revocation blocks new results immediately through current database authority. Previously downloaded copies and already issued bounded links retain the limitations stated elsewhere in the product.
- Source deletion, scope changes through deliberate copies, erasure receipts and restored backups must reconcile every index and cache. Suppression must occur before results can be served; asynchronous physical cleanup is tracked separately. An unavailable authorisation or deletion service fails closed.
- Keep immutable originals unchanged. Labels are suggestions, never approvals, identity claims or version relationships. Include a clear way to disable processing and remove its derived index.
- Bound file types, bytes, image dimensions, queued jobs, retries, concurrency and total index size. Show indexing states truthfully. Exhausted budget stops processing without breaking normal browsing or transfers.

## Acceptance before any pilot can be called successful

- [ ] Actual retrieval demand and baseline measured with authorised participants.
- [ ] Specific processing consent, provider terms, retention and spending cap approved.
- [ ] Restricted/owner/legacy/revoked-user denial tests cover results and indirect metadata.
- [ ] Index deletion, crash recovery and backup restore rehearsed; no erased content reappears.
- [ ] Measured improvement meets the predeclared targets without unacceptable false matches or cost.
- [ ] Accessible empty/loading/error/fallback flows and a usable opt-out are verified.

These are future pilot gates, not outstanding work needed to complete this discovery. Reopen P7-06 with a separately tracked implementation item only after evidence and approval. This decision does not defer or complete the remaining non-AI roadmap items.
