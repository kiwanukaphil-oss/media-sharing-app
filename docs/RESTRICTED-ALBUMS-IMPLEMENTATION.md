# Restricted albums: access contract

P4-01 / D08, 22 September 2026. The standing execution authority covers these implementation decisions. This document defines the policy; restricted albums are **not available or enforced in production yet**. No existing file or audience changes during this design increment.

## Access belongs to the asset

Each shared-space asset belongs to exactly one access scope: the general library or a named restricted scope. Every album also belongs to one scope; sections inherit it. An album reference is valid only when the asset and album have the same space and scope. Identical audience lists do not make two scopes interchangeable: their future grant changes could diverge.

Files keep their scope when an album is archived, removed or restored. Restricted files without an active album remain in restricted recovery/unorganised storage. General library queries exclude restricted assets even for a person who has a restricted grant. An explicit restricted view, and a separately labelled Everything I can access view, may include permitted restricted content.

Scope never changes by adding/removing an album reference or renaming a section. Moving content across scopes requires an explicit independently verified copy with an audience preview. A general original remains generally exposed until separately removed; making a restricted copy cannot recall existing copies or links. An already shared file must never be described as newly confidential.

## Membership and administrator access

- Restricted scopes require a current account membership and an explicit active grant to that exact membership. Legacy device credentials cannot access restricted content, including explicitly claimed legacy credentials; sign-in is required.
- Space roles still limit actions. A grant gives audience access, not a promotion: Viewer stays read-only, Contributor edits attributable files, and Editor organises. Owner-only actions remain Owner-only.
- Shared-space owners manage scope grants but do not silently read restricted files. An owner who lacks a grant must deliberately request their own administrator access, with a named audience confirmation and a durable audit event. The owner must already belong to that shared space. This does not create access to another person's personal space.
- The owner-only access-administration screen may list opaque scope IDs, creators and current membership grants so the owner can manage access or request their own audited grant. This is an explicit administrative metadata permission, not a content permission: no album/file titles, covers, item counts or activity content are disclosed without a grant. Ordinary readers cannot enumerate that catalog.
- Initial restricted-scope creation includes an explicit creator grant and a preview of the selected current memberships. Only owners manage audiences in the first increment; editors with access organise within the existing audience.
- Leaving/removing a shared membership revokes its restricted grants in the same transaction. Rejoining, matching an email or restoring an old backup does not revive them. Role changes within an uninterrupted membership change capabilities under the same audience; they do not create grants.
- Personal spaces keep their existing owner-only policy. Shared-space administration can neither enumerate nor grant access to personal-space content.

## Disclosure contract

| Surface | Required behaviour |
| --- | --- |
| Feed, search, suggestions, counts and covers | Filter by current audience before ordering, counting or choosing covers. No restricted names, totals or empty-group hints for a person without a grant. |
| Albums, sections and filename collision checks | Require the same current scope. Collision messages may refer only to accessible same-scope content. |
| Original/preview URLs and ranges | Recheck audience before bytes or a new signed capability. Existing signed URLs retain their documented bounded lifetime; downloaded copies cannot be recalled. |
| Upload queue, publication and import layout | Capture the intended scope at selection time. Recheck at reservation, every new capability and the ready-state commit. A changed destination never falls back to general storage. |
| Rename, organisation, Trash and permanent deletion | Require both current scope and role/attribution for every selected item in the committing statement. Mixed selections fail as a whole. |
| Favourites, metadata exports and future packages | A bookmark cannot outlive read authority as an access grant. Exports require all selected scopes at creation and retrieval; no partial disclosure. |
| Activity and in-app notices | Every referenced resource must remain readable. Hide the whole event if any reference is outside the current audience; hidden events cannot affect notices or pagination counts. Removed restricted resources retain their scope attribution in history. |
| Storage and administration | Ordinary readers see accessible content only. An owner may see a clearly labelled aggregate billed/reserved total for the shared space, but no hidden filenames or item counts. The separate owner-only access catalog exposes only the administrative fields described above. These exceptions support quota/access management, not browsing. |
| Browser state and recovery | Clear cached results after access loss and re-evaluate grants on refresh/restore. Restore quarantines memberships and restricted grants. No rollback to code that ignores populated restricted scopes. |

## Implementation sequence and acceptance

- [x] Define asset/album compatibility, inherited sections, personal-space exclusion, administrator grants and offboarding rules.
- [x] Introduce additive scope/grant/audit records and central SQL predicates on the isolated development branch; private-export rehearsal passed. No remote migration.
- [x] Integrate and hosted-verify the disclosure surfaces, including current activity/portability work. Production scope creation remains disabled.
- [x] Add and hosted-verify explicit scope management, audience preview, restricted navigation and cross-scope copy.
- [x] Exercise owner-without-grant, Viewer, Contributor, Editor, legacy, private-space and multi-album adversarial cases, revocation races and restored quarantine in the local/hosted suites.
- [x] Complete hosted and private-export migration/restore rehearsal.
- [ ] Complete the independent production backup gate, remote migration and live verification before enabling scope creation.

The pure policy fixture records expected semantics and is not a substitute for database/route enforcement. P4-01 is a design deliverable; completing it does not complete any of P4-02 through P4-06 or claim deployed privacy.

## Historical isolated schema preparation

This initial checkpoint is superseded by the integrated and hosted-verified implementation below.

`docs/prototypes/restricted-scope-schema.sql` is outside the active migration journal. `lib/asset-scope-authority.ts` is not imported by application routes. The prototype adds immutable asset/album scope references, exact-membership grants, minimal grant events and retained history scopes. Database triggers reject incompatible references and revoke restricted grants on departure.

`tests/asset-scope-authority.mjs` passes with SQLite and Cloudflare's local D1 engine. It verifies owner/legacy denial, explicit Viewer grants, whole-event filtering after the original is removed, leave/rejoin revocation and restore preservation of triggers/quarantine. Existing snapshot tooling preserves triggers after data import. This does not establish runtime coverage: the full inventory above remains the activation gate.

## Historical runtime integration — 22 September 2026

Branch `work/restricted-scopes` is an unfinished development branch, separate from the release candidate. It must not be deployed or merged for release yet. Migration 0023 exists only on this branch; live schema remains 0020 and the main candidate remains 0021/0022.

- [x] Additive scope/grant/audit migration and immutable references tested with local SQLite and D1.
- [x] Current audience predicates integrated into file reads, feed/counts, album/section reads and edits, favourites, selected metadata export and retained activity.
- [x] Activity scopes are captured atomically, validated and immutable. Missing resource attribution aborts the transaction. Permanent deletion retains the server-read scope without returning it in activity resources.
- [x] Explicit upload scope is retained across reservation and retry; a general request cannot enter a restricted album. Preview commits, cancellation, deletion and upload-ready commits include current audience checks.
- [x] Local D1 activity tests cover hidden album discovery, ungranted metadata/bookmarks, owner denial after revocation, scoped upload retry and destination mismatch, and activity privacy after deletion/revocation. Existing library write-authority tests pass, including denied storage dispatch and recovery after interrupted cleanup. TypeScript and focused lint pass.
- [x] Rehearse migration 0020 through 0023 against a private live export: all original columns/rows in 25 tables preserved, no invented grants, restored triggers identical and restored memberships quarantined. Source digest `fe005a714436264b1c0e07c4b22a652627db264389ece63fab93519877272f36`.
- [x] Review minimisation schema `896bd38831c71628bab581dcd4e661273a23a9dbcf9bc9c5e7331c38e94063d2`: explicit exact-membership grant revocation, shared originals/scope records retained, identity minimised and restored grants quarantined. Local populated-scope fixture and existing erased-snapshot tests pass.
- [x] Import/album creation captures an explicit scope. Existing personal publication accepts general destinations only; restricted destinations await the cross-scope workflow. Production-build account integration passes, including original bytes, roles, transfer races, publications, backup export and recovery repair.
- [x] Resource-bound multipart capability admission and built-worker closure integration pass. Revocation denies new part URLs and original links in real local route tests.
- [x] Current restricted browser workflows pass: general/combined navigation, scope-preserving album selection, audience preview, explicit self-access, revoked-content clearing and queue destination capture.
- [x] Add scope management/navigation, audience previews, saved-view scope and durable queue context behind `RELAY_RESTRICTED_SCOPES_ENABLED`. No deployment configuration enables it.
- [x] Add independently verified cross-scope copying with explicit audience-expansion review, locally verified behind the disabled flag.
- [ ] Complete adversarial route/browser coverage, release verification and deployed checks before enabling restricted content.

Owners may see aggregate billed storage across scopes for administration; file lists remain audience-filtered. Storage wording now identifies owner billing totals and audience-filtered lists; mobile and desktop visual checks plus the full local browser regression pass. Existing signed links have their documented bounded lifetime and cannot recall downloaded copies.

### Audience administration preparation

- [x] Unrouted `scope-management.ts` implements atomic owner-only shared-scope creation, stable retry IDs, exact-member validation, bounded catalogs/grants, current role checks and opaque audit-version conflicts.
- [x] Administrator self-access requires its own explicit confirmation and produces an `administrator-grant` event; audit failure rolls back the permission change. Local D1 tests pass.
- [x] Production-build closure-tracking integration exits 0, including resource-bound multipart capability custody and closure fence entry points.
- [x] Route and present controls behind the disabled activation flag. Dedicated built-Worker D1/R2 tests verify CSRF, owner-without-grant denial, Viewer bytes/read-only behavior, metadata/thumbnail/section denial and audited self-access. No production scope or grant was created.
- [x] Full local browser regression exits 0: existing Chrome/Edge/Firefox/WebKit workflows preserved, plus new mobile/desktop audience checks and queue/navigation checks. Production build, TypeScript and full web lint pass.
- [x] Subsequently complete hosted verification, cross-scope copying and lifecycle/disclosure review. Production activation remains outstanding.


### Cross-audience copy implementation (22 September)

- [x] Owner-only, same-shared-space copies require current grants to both audiences and different explicit source/destination scopes. Existing personal publication remains general-only and passes its full built-Worker regression.
- [x] The original stays unchanged. R2 checks the streamed original checksum; distinct object keys/IDs, quota reservations, exact retry intent, attempt custody and current-authority visibility commits reuse the publication engine.
- [x] New copy review shows source, destination, current named audience and future membership semantics. General-source copying explicitly cannot recall existing access/downloads. Recovery after a lost response keeps the same operation and destination; cancellation releases only the unfinished copy.
- [x] Built-Worker D1/R2 tests cover both directions, missing grants, Viewer denial, incompatible destination album, stale source, independent bytes, exact retry, destination-only history and a grant lost after bytes arrive but before visibility. The last case never publishes and cleans its own attempt.
- [x] Migration 0024 adds only nullable scope references on publication custody plus immutable/compatible audience triggers. Private-export rehearsal preserves all original fields in 25 tables, invents no grants and retains restored triggers/quarantine. Reviewed schema: `73207a15ec5ef28a6fcc7c485c09e484eae28f29792998daab8e13c000f6b2b7`.
- [x] Local production build, TypeScript, full lint and mobile copy/retry/recovery/browser audience checks pass. Mobile success dialog visually inspected. Original personal publication checksum/race/cancellation regression exits 0.
- [ ] Finish final disclosure/lifecycle review, hosted verification, independent backup/restore gate and deployed acceptance. Neither migration 0023/0024 nor the activation flag has been applied remotely.

Retention review: scope references are opaque identifiers. Existing publication custody inventories include same-space jobs; unfinished jobs still block erasure, restored jobs quarantine to cancelling, and minimisation retains shared originals while revoking membership/grants. No new deletion authority is implied. The existing 1 GiB per-copy limit applies. Current named recipients are a review of a managed audience, not an immutable recipient snapshot; the dialog explicitly states owners can change that audience later.


### Disclosure review and corrections

Review performed against the actual route/query implementations, not only the UI policy:

| Surface | Enforcement and evidence |
| --- | --- |
| Feed/search/date/type/favourites/counts | Current audience predicate precedes ordering/pagination; explicit combined scope. Feed now returns the authorised file's immutable `accessScopeId`, asserted by real D1 route tests. |
| Albums/sections/covers/references | Current album audience and immutable same-scope database triggers. A second album cannot broaden a file's scope; removing an album preserves file scope. |
| Bytes/links/parts/commit | `requireMedia` plus resource-bound write/capability guards; explicit scoped reservations and final visibility rechecks. Existing signed URLs remain bounded bearer capabilities, never claimed recallable. |
| Exports/history/bookmarks | Whole-selection current-authority guards; compatible references only; retained event scopes after removal; person-private bookmarks never grant access. Copy arrivals contain only destination references. |
| Storage/admin | Explicit owner aggregate billing exception; filename/unfinished-transfer lists stay scoped. Owner catalog exposes only opaque management IDs unless a separate content grant exists. |
| Browser dialogs/caches | Authoritative feed refresh now clears inaccessible open previews/copy/edit surfaces and selection, including combined browsing. Regression simulates remote revocation while a combined-view preview is open. Grants are not a promise of instantaneous remote erasure from a browser: visible polling is bounded to ten seconds and new requests enforce current authority. |
| Local transfer queue | A user's own selected local files and captured destinations may remain in their local queue; no new server metadata is fetched without current access. Resuming/retrying still checks the exact audience. Navigation never silently retargets uploads. |
| Copy/account closure | New scope-copy routes pass the common tracked-request wrapper; built-Worker copy tests pass with both restriction and closure tracking enabled. Pending custody remains a reconciliation blocker, not an erasure-success claim. |
| Migration/restore/rollback | Additive 0023/0024, no inferred grants, original-field fingerprints and restored trigger/quarantine checks pass. Once restricted records exist, rollback to any pre-scope reader is prohibited; rollback must keep enforcement. |

- [x] Correct missing feed audience DTO and cached combined-view dialog revocation, with real-route and browser regression tests.
- [x] Correct the erasure-plan fixture to create a valid reservation before simulating historical removal, preserving the same custody/reconciliation scenario under the new trigger.
- [x] Copy routes pass with closure tracking enabled. Latest published Workers types `5.20260922.1` and current R2 Workers API reviewed; original copies remain streamed in production, with tiny test-only bridge buffering.
- [x] Complete the final hosted rerun; production backup/deployment acceptance remains separately outstanding. No unrestricted creation or account closure is activated.


### Hosted development acceptance

- [x] Both jobs passed in run `35738388665`, runtime/UI source `3daf07a`, including the copy suite with closure tracking and full browser regression. Merged into main under standing execution authority.
- [ ] Independent backup release gate, remote migrations, both-origin/live pilot checks and explicit feature-flag activation remain outstanding. Production still uses schema 0020; no restricted grant exists remotely.
