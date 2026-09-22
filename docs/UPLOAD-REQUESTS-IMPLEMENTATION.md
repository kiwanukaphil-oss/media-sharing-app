# Bounded upload requests

P3-04/P3-05 implementation contract, 22 September 2026. This increment is isolated preparation, not a live collection feature. No invitation is sent and no production access is granted.

## Initial workflow

A shared-space owner chooses one existing album and optional section, reviews the audience, enters one recipient email and creates a collection request. The owner must currently read the destination audience. The destination and limits become immutable; changing them requires a new request. A copyable link is the initial delivery mechanism. The recipient signs in with the invited verified email and accepts a grant tied to their person identity, without receiving a membership. There is no anonymous or passcode fallback in the first release.

Show the recipient a deliberately public request title, receiving library, expiry and remaining limits. Do not expose private album/section/scope titles, existing files or other submissions. The organiser previews exactly this disclosure before creating the link. Profile display names are self-reported; email verification proves control of that email, not a person's legal identity.

Default limits: 24-hour expiry, 20 files, 250 MiB per file and 1 GiB total. Owners can lower limits; hard ceilings are seven days, 100 files, 250 MiB per file and 1 GiB total. At most ten open requests per space. Creation reserves the total allowance against the existing space quota, so several requests cannot promise the same free storage. Normal uploads, copies and intake all use the same media-based quota accounting. Committed submissions exchange unused reservation bytes for their staged file bytes in one transaction; retries reuse an exact stable file ID and do not spend another allowance.

## Authority and confidentiality

Request authority requires an active, unexpired request, its original owner's continuing Owner membership, current destination audience grant, available album/section, and an active recipient session matching the accepted person. Matching an email after acceptance cannot transfer the grant. Password recovery, disabled identity, departure, demotion, expiry or revocation stop new capabilities and visibility commits. Owner re-entry never silently revives a closed request; restoration quarantines requests and grants.

Acceptance is atomically bound to the current verified email and person; concurrent acceptance cannot rebind it. The link is a secret locator plus invitation, never a library credential. Use a URL fragment for a copyable secret and send it only in a bounded POST body, with no-referrer/no-store responses; do not put the token in logs, history query strings or email automatically. Hash the secret at rest. A receipt requires the accepted account and reveals only that person's submissions to this request, without original download or library access.

## Incoming files and honest status

Store incoming originals outside the ordinary feed until an authorised owner reviews them. A contributor cannot choose a new space/scope/album/section, modify limits, enumerate storage keys or use ordinary library APIs. Preserve the original filename as untrusted text and serve no active content inline. Do not process previews or extract embedded metadata before review; original bytes remain immutable.

Status progression is reserved, uploading, received for review, verified and accepted. A request-body completion or multipart response is not an independently verified original. Acceptance verifies the expected byte length and SHA-256 before making the asset visible to the reviewed audience. Corrupt/incomplete data remains out of the feed. Destination deletion/access loss never silently reroutes to the general library. Receipts must say whether bytes are only received or actually verified and accepted.

Reserve and rate-limit before storage work; bound part count/size, retry count and outstanding capabilities. Expiry/revocation stop new part URLs and finalisation. Already issued capabilities and in-flight writes retain their documented limitations and custody records. Cancellation does not report physical erasure until reconciliation proves it. The Cloudflare multipart-quiescence question remains a physical-deletion release gate.

## Storage, recovery and abuse response

A request's unused allowance can be released by an authenticated metadata transition after revocation; retain enough reserved capacity for every admitted unfinished or staged file. No automatic permanent deletion of originals or rejected submissions is authorised by this feature. Owners can revoke intake immediately; operators can disable creation globally and inspect opaque volume/error metrics. Default-on anonymous intake, unattended content scanning and external AI processing are excluded.

Restore quarantines requests, recipient acceptance and outstanding multipart operations. Extend account-erasure inventory, backup minimisation, pending-writer custody and all-version reconciliation before enabling new tables. Remove invitation email/contact details during relevant identity minimisation; retain shared accepted files with pseudonymous attribution under the existing shared-content policy. Never mistake a expired link for proof that every in-flight upload stopped.

## Implementation and release checklist

- [x] Define narrow named-account grant, explicit disclosure/destination, limits, quota accounting, review and status semantics.
- [x] Isolated SQLite/D1 acceptance and authority preparation: draft/expiry/session denial, exact verified-person binding, no membership/file disclosure, immutable destination, non-resurrecting issuer/destination revocation and restored quarantine.
- [x] Atomic quota activation and exact submission reservations pass real D1 concurrency tests. Two requests cannot reserve the same free bytes; concurrent retries produce one staged file; file count/size and total allowance are enforced.
- [x] Track transfer custody and reconcile new staging states in the prepared runtime and read-only inventory.
- [x] Isolated owner draft creation/close: exact intent retries, bounded request count, current audience/role and revision checks. Closing releases only unused allowance; staged originals remain charged. D1 rollback test preserves allowance when custody insertion fails.
- [x] Route owner creation/revocation/review and recipient-only upload/receipt flows behind a disabled feature flag; actual built Worker passes with closure tracking.
- [x] Isolated R2 multipart start/receipt and owner-reviewed streaming checksum acceptance pass. A corrupt hash or owner demotion before commit leaves the file outside the feed; accepted arrivals are idempotent.
- [x] Generated 250 MiB maximum-size stream verifies in the actual local workerd runtime (2759 ms local wall time); a mismatched hash is rejected without publication. This is not production CPU/latency evidence.
- [x] Route bounded multipart capabilities with custody; test expiry/revocation races and shared quota/staging lifecycle inventory locally.
- [x] Build and locally verify mobile/desktop owner creation/review, explicit recipient sign-in/acceptance, receipt states and exact interrupted retry. A tab-local intent precedes reservation; original bytes are never persisted in browser storage.
- [x] Owner-only independently verified attachment review and reversible decline/restore pass actual built-Worker and mobile browser checks. Download does not publish; recipient receipts distinguish declined files from deletion.
- [x] Prepare operational abuse handling and a tested admission pause that retains receipts, owner review/close and staged capacity. [Runbook and checks](INTAKE-OPERATIONS.md).
- [ ] Complete physical cleanup/disposition and live operational acceptance before activation.
- [x] Extend lifecycle/minimisation/restore contracts and test cross-account, revoked, expired, concurrent and malformed requests locally.
- [ ] Hosted verification, independent recovery point, migration, pilot verification and operational limits before activation. General onboarding remains subject to Phase 2 gates.


## Quota preparation evidence

`upload-request-reservations.ts` exchanges one media-based allowance for staged originals in a D1 transaction, keeping total charged bytes constant. The same `SUM(size + preview_size)` is already used by ordinary uploads and publications. Draft activation establishes an expired, non-authenticating attribution record, a `collecting` allowance and then the open request. Submission rows retain immutable person/request/size/hash intent, while staged media remains `receiving`, never `ready`. Migration 0025 now defines these states in the prepared release; no intake migration has been applied remotely.

Current acceptance and submission SQL also carries account-closure admission authority when supplied. R2 work, multipart capability custody, lifecycle inventory/minimisation, reserved-state storage UI and restore compatibility must be integrated before activation. In particular, the current production object inventory deliberately does not accept the new staging states yet; do not deploy this preparation by itself.


## Transport and acceptance preparation

Unique, at-most-five multipart attempt keys are recorded before provider creation; late attempts cannot install themselves over a newer lease. Unknown creation/abort outcomes retain custody and reserved capacity. Completion records only received-for-review and rechecks current recipient, issuer, destination, expiry and closure authority. Independent verification incrementally hashes the completed immutable object stream without buffering the original. An authorised owner then commits one ready file, same-scope album placement and destination-only arrival event atomically.

Closing collection stops new contributor writes. Already received shared work remains reviewable by a currently authorised owner, who may deliberately accept it after collection closes; this does not reopen the contributor's grant. Unverified/corrupt/unfinished bytes remain outside the feed and continue consuming reserved capacity. Part-capability issuance now records exact size/key/upload custody with a 60-second admission window and a 200-capability limit; closure tracking adds independent effect custody. Tests cover late completion after closure, settled admission reuse and restored capability retention. Owner/recipient UI and reversible decline are locally verified; physical cleanup and lifecycle release disposition remain outstanding. No prototype table or intake state is active in production.

## Gated route and browser verification

The actual production build passes recipient-only intake with closure tracking: owner private destination, CSRF rejection, no membership/feed/download access, bounded capabilities, real multipart receipt, independent acceptance, retained original and closure. Browser checks exercise secret removal from the URL, tab-preserved sign-in handoff, explicit acceptance, failed-part recovery across reload with the same submission ID, honest review receipts and owner confirmation at 390 px and desktop widths. Review caught and corrected a refresh hiding transfer errors and an inherited file-input width overflowing mobile. Hosted core run 35741321353 passed before these route/UI additions; their hosted rerun follows this checkpoint.

The feature remains disabled. Migration 0025 is prepared in the journal, with reviewed contact minimisation and staging inventory. Existing pilot users cannot create live requests. Physical custody reconciliation and release gates remain outstanding.

## Lifecycle preparation checkpoint

Exact issuer/accepted-recipient references now enter the read-only account-erasure plan, including every attempt and capability even after expiry. Accepted shared originals appear in the preserve list. Staged work and provider custody add explicit reconciliation blockers; contact email never establishes storage ownership. Snapshot-only contact minimisation closes the relevant request, removes recipient email and disables the token while retaining all media/custody; immutable triggers prevent reopening or rebinding it. Tests also verify historical restore quarantines staging and preserves completed shared originals.

Live object reconciliation understands allowance/staging states and exact late multipart attempts, and refuses intake states without the companion custody inventory. The schema is detected before querying new tables, preserving compatibility with production 0020. Storage totals now include staged intake reservations without exposing their filenames to ordinary library members. Migration 0025 is now allowlisted for the existing global-backup-only snapshot transformation, with populated intake minimisation coverage. Account/device closure protocol records still require their separate review; this is not release or erasure authorisation.

Hosted route/UI source `cd01dcd` passed both jobs in run 35744040823. Subsequent review download and reversible decline/restore changes pass local built-Worker and browser checks; hosted verification will follow this increment. Review attachments are octet-stream downloads with no-store/nosniff headers, current audience checks after verification, and a matching immutable-object ETag. Received and declined bytes remain charged and outside ordinary feeds.

## Migration 0025 recovery acceptance

`0025_clean_ravenous.sql` adds four tables and ten protective triggers, without altering existing records or enabling requests. The Drizzle schema/snapshot match the migration. Schema digest `f7e4763bf86c309c63a6171100b9562d222b2f83b158af9a90c9aa32a67ade5f` is reviewed for exact contact minimisation with staged custody retained. Full populated snapshot transformation preserves accepted shared originals and every attempt/capability, removes recipient contact/token access, and retains restore quarantine.

The private current-schema export (digest `fe005a714436264b1c0e07c4b22a652627db264389ece63fab93519877272f36`) rehearsed through 0021-0025: all original columns/rows in 25 tables are unchanged, no invitations are created, and triggers/quarantine survive export and restore. Synthetic 0020 and 0024 baseline rehearsals provide hosted regression coverage. No remote migration or production activation occurred.

Owner refreshes now discard superseded request responses, and expiry uses server-reported time plus elapsed browser time. Browser coverage includes a clock five minutes ahead with the seven-day limit, avoiding an invalid request caused by workstation clock skew.

Full hosted source `269c1ef` passed both verify and browser jobs in run 35745353865, including migration 0025 and intake lifecycle/review changes. The subsequent server-clock and superseded-refresh correction `1000fd7` passes local lint, TypeScript and browser checks. Ready for integration with activation disabled; physical-cleanup and independent-backup release gates remain open.

Admission-pause preparation now passes built-Worker checks with closure tracking and recipient/owner browser controls. The pause is separate from disabling all intake routes; already-admitted storage capabilities remain subject to the provider-quiescence gate. No production flag changed.
