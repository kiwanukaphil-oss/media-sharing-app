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
- [x] P5-02 implementation: private draft, sender review, deliberate issue/revoke and recipient-only presentation pass local/hosted checks. Live release remains separate.
- [x] P5-03 bounded first implementation: in-tab export jobs, complete manifests and independently checked original bytes pass local/hosted checks. Unattended jobs are deferred; live acceptance remains separate.
- [x] P5-04/P5-05 implementation: metadata/import integration, original-package manifests and accurate privacy/status copy pass local/hosted checks.
- [ ] P5-06: test access loss during reads/jobs, expired capabilities, stale selection, partial failure, restore quarantine, recipient usability and operational costs; record deployed verification.

The original design checkpoint is followed by implementation and verification evidence below. Neither a purchase nor Phase 5 production completion is implied.

## Isolated implementation checkpoint

Named-recipient authority preparation now passes real D1 tests. The draft grants no access; acceptance binds the invited verified account without membership or source audience grants. Every delivery read requires all captured originals and the sender's current authority. Snapshot labels survive working-file renames; Trash, source removal and sender grant loss suspend the whole issued delivery, with no automatic revival. Revoked/recovered sessions, expired deliveries and reassigned email addresses cannot inherit access. Historical restore quarantines issued deliveries.

At this initial checkpoint, prototype tables remained outside the migration journal. Sender draft/issue/revoke, recipient routes/UI and bounded download capabilities now pass local checks. Lifecycle/minimisation, original packages and live acceptance remain outstanding. This preparation creates no live grants and sends no invitations.

Sender management preparation also passes D1: drafts capture one audience and up to 100 distinct originals, with up to 20 distinct named recipients and at most 100 unexpired drafts/issued/suspended deliveries per source space. Exact concurrent retries create one selection and grant set. Missing/mixed-scope/stale selections are rejected as a whole. Issuance requires the original sender's current Owner/grant authority; suspended snapshots can be explicitly re-reviewed while preserving captured labels. Current owners with the source audience can revoke access, which cannot be silently reopened. Recipient-insert collisions roll back the whole draft.

Disabled owner/recipient routes now pass actual built-Worker D1/R2 tests with closure tracking: explicit issue, hidden restricted source labels, named acceptance without source membership, captured labels after rename, original-byte downloads, whole-snapshot denial after Trash and deliberate reactivation/revocation. Two invitation emails later bound to the same verified person do not duplicate the file selection. Delivery-specific download admission is capped at 60 seconds and the delivery expiry; actual provider signing/live retry evidence remains a release gate. No capability claims instantaneous recall or successful saving.

### Sender and recipient UI checkpoint, 22 September

- [x] Implement selection-based creation, explicit public sender/title labels, complete source/recipient/expiry review, deliberate publication, per-recipient copy links and revoke/reactivation controls.
- [x] Implement secret-fragment sign-in handoff and explicit named-account acceptance, with no source membership or private working-library labels exposed.
- [x] Verify mobile and desktop presentation, native download wording, streamed checksum-verified saving and removal of displayed filenames on access loss. Corrected mobile file layout after screenshot inspection.
- [x] Verify actual built-Worker native and verified-download endpoints, captured attachment names and original bytes. The browser's native-download fixture uses an actual local HTTP server because Chromium bypasses route interception for download navigation; endpoint authorization is independently checked in the Worker suite.
- [x] Subsequently complete hosted verification, lifecycle/minimisation and prepared migration 0026. Operational release gates remain outstanding before enabling deliveries.

The public sender label is explicitly reviewed and captured, rather than disclosing the source library's current name. An accepted invitation is labelled as acceptance, never as a read or save receipt. Native downloads say requested; only the supported streamed save reports verified bytes after the writer closes. Delivery tables remain outside the active migration journal, and the feature flag remains absent from production.

### Lifecycle and migration checkpoint, 22 September

- [x] Add prepared migration `0026_motionless_wildside`: three delivery tables and 12 protective triggers, no existing-row mutation or new grants.
- [x] Revoke every restored delivery and recipient grant permanently. Membership reconciliation cannot revive historical delivery links.
- [x] Remove captured item metadata when its source is permanently removed. Sender minimisation clears public labels, intent hash, captured items and recipient contacts/tokens; recipient minimisation affects their grant without altering shared originals or other recipients.
- [x] Integrate exact-person inventory with the read-only erasure plan and the snapshot minimiser. Email matching only clears contacts; it never establishes file ownership. Narrow irreversible redaction exceptions cannot restore contact values or rebind recipients.
- [x] Verify migration, minimisation, existing intake/account lifecycle, actual built-Worker delivery routes, type checks and lint locally.
- [x] Rehearse against the private production-schema export: all 25 existing tables preserved, no grants invented, protective triggers and access quarantine retained on restore. Source digest `fe005a714436264b1c0e07c4b22a652627db264389ece63fab93519877272f36`; reviewed schema digest `7e7140a337f88704a4ce4df05807d22010144e600424e03fcc8abfbf365f9495`.
- [x] Subsequently complete hosted verification and bounded original package jobs.
- [ ] Complete live operational acceptance. No migration or flag has been applied in production.

This checkpoint supersedes the earlier prototype-only status. The prototype remains a historical reference and retirement candidate; the migration journal owns the current schema. Snapshot minimisation still requires the existing global-backup-only protocol restrictions and never authorises real deletion or restore cutover.

### Bounded original package decision and implementation

The first package job runs in the open browser tab, with progress and cancellation. This deliberately bounds the initial promise: it does not continue after the tab closes, and retry restarts the complete reviewed selection. Direct file saving streams up to 2 GiB / 100 originals without retaining all bytes in memory; other browsers have a 64 MiB original-byte cap and bounded ZIP/manifest overhead. One package runs per tab. Larger or unattended jobs remain a separate expansion requiring demand and operational evidence.

This replaces the initial server-artifact implementation proposal for the bounded first release. There are no new cloud package writers, storage copies, retention bills or cleanup races. This is a product implementation decision within the standing authority, not a claim that unfinished provider-erasure gates have cleared. A saved local archive cannot be recalled.

- [x] Implement stored ZIP entries with UTF-8 collision-safe paths, CRC32, per-original SHA-256 verification and manifest inclusion. Library manifests preserve names, dates, albums and sections; delivery manifests contain only captured public selection labels.
- [x] Recheck the entire selection at creation and immediately before committing the archive, plus normal current download authority for each original. Stale revisions, unavailable originals, corruption or revoked access fail the entire job.
- [x] Support progress, cancellation, fresh retry and capability fallbacks. A native file writer commits only after verification; the small browser-download fallback reports a request, never a verified local save.
- [x] Independently extract the generated ZIP with Python's standard reader, checking CRCs, manifest and original bytes. Verify an 80 MiB streamed fixture uses at most 1 MiB output chunks, without retaining output; test bounds, traversal, duplicate IDs, corrupt/truncated/oversized responses, final access loss and cancellation.
- [x] Verify actual library Viewer and delivery-recipient browser package downloads, scoped calls, source-organisation separation and access-denial retry.
- [x] Complete hosted package verification in `35751118759`.
- [ ] Complete production/browser operational acceptance. A full 2 GiB generated stream also passes locally with at most 1 MiB output chunks. This checks the writer limit, not real-device disk performance; device performance and live provider retry evidence remain release checks.

Format and save semantics reviewed against [PKWARE ZIP specification](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT) and [FileSystemWritableFileStream](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemWritableFileStream). No sanitised derivative is offered: it could otherwise imply removal of sensitive metadata without a tested format-specific implementation.

Hosted run `35749765799` passed verification and browser jobs at `c0a5151` for the delivery lifecycle/schema increment. Earlier `35749339230` passed verification and delivery browser checks but failed a repeated folder-import browser step; the unchanged folder workflow passed locally and in the subsequent complete hosted run. Package changes require their own hosted run.

Package run `35750453833` passed verification but caught a mobile selection-toolbar overflow in the album-section browser. The new package action exceeded the old no-wrap toolbar. Wrapping is restored; the affected real album-section, library-package and delivery-package browser tests pass locally. A corrected hosted run is required before merge.

Corrected hosted package run `35751118759` passes verification and browser jobs at `5c66996`; package work is merged into main with production unchanged. The full 2 GiB generated-stream writer test also passes locally.
