# Bounded upload requests

P3-04/P3-05 implementation contract, 22 September 2026. This increment is isolated preparation, not a live collection feature. No invitation is sent and no production access is granted.

## Initial workflow

A shared-space owner chooses one existing album and optional section, reviews the audience, enters one recipient email and creates a collection request. The owner must currently read the destination audience. The destination and limits become immutable; changing them requires a new request. A copyable link is the initial delivery mechanism. The recipient signs in with the invited verified email and accepts a grant tied to their person identity, without receiving a membership. There is no anonymous or passcode fallback in the first release.

Show the recipient a deliberately public request title, receiving library and organiser, expiry and remaining limits. Do not expose private album/section/scope titles, existing files or other submissions. The organiser previews exactly this disclosure before creating the link. Profile display names are self-reported; email verification proves control of that email, not a person's legal identity.

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
- [ ] Add tracked transfer custody and reconcile the new staging states before routing this preparation.
- [ ] Implement owner creation/revocation/review and recipient-only upload/receipt routes behind a disabled feature flag.
- [ ] Integrate bounded byte transfer, checksum-verified acceptance, capability custody and shared quota reservations.
- [ ] Build mobile/desktop owner and recipient workflows, interrupted retry/recovery and clear abuse/error states.
- [ ] Extend lifecycle/minimisation/restore contracts and test cross-account, revoked, expired, concurrent and malformed requests.
- [ ] Hosted verification, independent recovery point, migration, pilot verification and operational limits before activation. General onboarding remains subject to Phase 2 gates.


## Quota preparation evidence

`upload-request-reservations.ts` exchanges one media-based allowance for staged originals in a D1 transaction, keeping total charged bytes constant. The same `SUM(size + preview_size)` is already used by ordinary uploads and publications. Draft activation establishes an expired, non-authenticating attribution record, a `collecting` allowance and then the open request. Submission rows retain immutable person/request/size/hash intent, while staged media remains `receiving`, never `ready`. These are prototype states only; the active migration journal is unchanged.

Current acceptance and submission SQL also carries account-closure admission authority when supplied. R2 work, multipart capability custody, lifecycle inventory/minimisation, reserved-state storage UI and restore compatibility must be integrated before activation. In particular, the current production object inventory deliberately does not accept the new staging states yet; do not deploy this preparation by itself.
