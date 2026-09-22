# Snapshot deliveries: implementation contract

P5-01 / D09, 22 September 2026. **Design complete; delivery creation and recipient access are not implemented or enabled.** These defaults are selected under standing project authority. No recipient has been granted access and no message has been sent.

## The practical workflow

A sender selects existing originals, chooses Create delivery, reviews the exact files and recipient access, and publishes an immutable selection. A recipient sees a focused delivery page with only those files, clearly labelled original downloads and an expiry. Adding a new draft to the working album does not change the delivery. Updating a delivery creates a new reviewed snapshot; it never silently replaces an already issued version.

The existing media ID identifies immutable original bytes. Capture that ID, the selected revision, recorded original fingerprint, byte length and display metadata at publication. An organisational edit does not create a new original; the snapshot must state which labels/dates it captured. Recorded fingerprints are not described as independent verification until bytes have actually been checked. Creative version lineage is optional future metadata, not a prerequisite for snapshot deliveries.

## Sender and recipient authority

Initial publishing is owner-only: personal-space owners may publish their own content; shared-space owners need current read grants for every selected scope. An owner without a restricted grant cannot publish it. Viewer, compatibility Member, Contributor and Editor may use their existing authorised downloads but cannot mint external delivery grants in the first increment. This avoids treating organisation permission as authority to expand an audience.

The first recipient mode is named, verified account access, including people without source-space membership. Acceptance grants access to this delivery only. Bind the accepted grant to the verified person identity; subsequent email matching or rejoining cannot revive a revoked grant. The restricted identity pilot still limits which accounts can participate until its release gates clear.

A public bearer link or passcode-protected guest mode is **not an implicit fallback** when sign-in is unavailable. Such a mode needs separate implementation and abuse/expiry/revocation tests. Its preview must explicitly say anyone possessing the necessary link/secret can use it and that the recipient's identity is not verified. A passcode is an access gate, not encryption of originals. Do not transmit recipient invitations automatically: the first sender workflow can offer a copyable link; email sending remains a separately authorised product action.

## Review before publishing

Show the sender the destination title, file count/bytes, complete selection, source audience(s), recipient identities, allowed actions and exact expiry with timezone. Keep general/restricted source labels visible. A delivery may initially contain one source space and one asset scope; reject mixed-scope selections as a whole and explain how to create separate deliveries.

- Default capability: browse the delivery and download the selected originals. No source-library browsing, upload, edit, comments, onward invitations or automatic membership.
- Default expiry: seven days; allow a deliberate shorter period and cap the initial implementation at 30 days. No non-expiring option initially. Show the actual timestamp before publication.
- Default selection: at most 100 ready originals, matching current selection limits. Package/export limits are separately bounded; a valid delivery does not promise a single archive of any size.
- Restricted-source publication needs a distinct audience-expansion confirmation naming the external recipients. Explain that their downloaded copies cannot be recalled. Sections, album titles and filenames never confer approval.
- Preview is private and revocable. Issuance is idempotent against a stable draft ID and exact reviewed selection; a changed revision, recipient list, expiry or scope requires a fresh review.

## Continuing access and honest revocation

Delivery access requires the current recipient grant, an unexpired/unrevoked snapshot, current source availability and the sender's continuing authority to share that source. Recheck at page data, thumbnail/original URL issuance, range access where mediated, package creation and package retrieval. Expired or revoked access must not reveal filenames, counts or which recipient was removed. Return a neutral unavailable state.

Revoking a delivery stops new access and new capabilities. Source Trash/removal, sender access loss or loss of the sender's restricted grant suspends affected content immediately; do not silently omit items from a supposedly complete package. Returning a source from Trash does not automatically reactivate a suspended delivery: require sender review. Do not keep hidden original copies alive solely to defeat the source's removal policy.

Already downloaded files cannot be recalled. Already issued object URLs keep their bounded capability lifetime; URL expiry is not proof that a previously started download has ended. The UI must state this when expanding or revoking access. Use short delivery-specific signing lifetimes after testing the actual storage/download behavior; do not claim instantaneous byte revocation with bearer storage URLs. The exact lifetime and retry experience are a release gate, not an unverified number in this design.

## Status language

| Recorded evidence | Permitted status | What it does not prove |
| --- | --- | --- |
| Snapshot committed with reviewed grants | Published | Anyone received or opened it |
| Authorised recipient page fetched | Opened | The intended human read every item |
| Download capability requested / response started | Download started | The browser saved a complete original |
| Relay explicitly verified saved bytes through a supported flow | Verified save | The recipient retained, reviewed or approved the content |
| Package writer independently verifies its manifest and every member | Package ready | Recipient download completion |

No read receipt, approval or successful save is inferred from a click, signed URL, generated archive or browser download event. Preserve the existing distinction between originals, metadata-only manifests and any separately labelled sanitised derivatives. Originals may contain EXIF/location information.

## Storage, lifecycle and operations

Snapshot rows reference immutable source assets; they do not duplicate originals by default. Generated packages are private temporary artifacts with bounded size, concurrency, retries and retention, never permanent public objects. Cancellation and account erasure must account for in-flight writers and late artifacts. The existing provider-quiescence blocker remains relevant to guarantees about physical deletion; do not bypass it by inventing a new delivery bucket.

Extend backup/export/minimisation schemas before enabling any delivery table. Preserve opaque audit evidence while removing recipient contact/session secrets according to the erasure contract. Restored snapshots and recipient grants remain quarantined until revalidated against current access, expiry and erasure receipts. An old backup cannot revive a link.

## Acceptance and implementation sequence

- [x] Define immutable asset selection, default recipient mode, sender authority, review, expiry, capabilities, updates and revocation limits.
- [x] Resolve D09 for the initial named-account snapshot mode. Guest bearer/passcode modes remain explicitly gated expansion.
- [ ] P5-02: build private draft, sender review, deliberate issue/revoke and recipient-only presentation.
- [ ] P5-03: implement bounded export jobs, complete manifests and independently checked original bytes.
- [ ] P5-04/P5-05: integrate existing metadata/import work and accurate privacy/status copy.
- [ ] P5-06: test access loss during reads/jobs, expired capabilities, stale selection, partial failure, restore quarantine, recipient usability and operational costs; record deployed verification.

This contract completes design only. It neither approves a purchase nor marks delivery implementation or Phase 5 complete.

## Isolated implementation checkpoint

Named-recipient authority preparation now passes real D1 tests. The draft grants no access; acceptance binds the invited verified account without membership or source audience grants. Every delivery read requires all captured originals and the sender's current authority. Snapshot labels survive working-file renames; Trash, source removal and sender grant loss suspend the whole issued delivery, with no automatic revival. Revoked/recovered sessions, expired deliveries and reassigned email addresses cannot inherit access. Historical restore quarantines issued deliveries.

Prototype tables remain outside the migration journal. Sender draft/issue/revoke workflows, recipient routes/UI, download capabilities, lifecycle/minimisation and original packages are still outstanding. This preparation creates no live grants and sends no invitations.
