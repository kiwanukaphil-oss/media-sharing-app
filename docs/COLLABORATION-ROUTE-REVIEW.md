# Collaboration route integration review

Reviewed 22 September 2026 against source `66a14ba`. This is an integration checklist, not a statement that new roles are active. At that review point the prepared policy had no production caller. The subsequent additive Editor increment is tracked in [the implementation contract](COLLABORATION-IMPLEMENTATION.md); general-release dependencies still apply.

## Authority boundaries

`requireAccountSpaceAccess` authenticates a session and resolves an exact membership through `account_space_actors`; its compatibility device is attribution, not a bearer credential. `transferAuthority` repeats live session, recovery watermark, membership and optional closure-admission checks inside mutations. Its current `ownerOnly` boolean is insufficient for the proposed roles: replacing only `requireOwner` would leave writes denied, or could accidentally admit Viewers through the non-owner path.

Resolve file attribution by joining `media.device_id` to `account_space_actors` and independently recorded `legacy_owner_claims`. Require a unique, same-space association to the exact membership, never a matching person/email or a replacement membership after rejoining. Preserve legacy device ownership independently. A conflicting or missing account association cannot grant Contributor editing.

## Required integration map

| Surface and implementation | Required policy and transactional treatment |
| --- | --- |
| Feed, storage totals/transfers, albums/section covers (`web-api`, `library-api`) | Read scope must cover every returned row/count/cover. Replace the owner-only `canCancel` expression with the same cancellation decision used by the mutation. |
| Original, preview, thumbnail and signed-link GETs (`app/api/[...path]/route.ts`, `web-api`) | Read capability plus resource audience. Preserve ready-state checks, private caching and the documented lifetime of already issued URLs. |
| Upload reservation (`server.initializeUpload`) | Upload capability at reservation, destination validity and atomic quota. Viewer must never create a multipart upload through this path. |
| Part signing, local bytes, completion (`route.ts`), restart (`web-api`) | `continue-upload` requires the exact contributing membership/device, even for Owner/Editor. Recheck capability and active upload identity before issuing bytes/capabilities and committing ready state. Preserve part bounds, checksums, closure tracking and idempotency. |
| Thumbnail PUT (`web-api.writeThumbnail`) | `create-preview` requires own contribution and current upload permission. Preserve ready/untrashed state, bounded JPEG, quota reservation and existing-preview immutability. Compatibility Member still needs this upload step. |
| Album CRUD (`library-api`); section create/edit/reorder/cover (`sections-api`) | `organise-albums` permits Owner/Editor. Repeat current role, destination and revision inside SQL. Contributor file ownership does not grant album administration. |
| Rename, capture date, add/remove album membership (`library-api`); section placement (`sections-api`) | `edit-files` over the entire exact selection, current attribution and audience, plus existing revisions, filename conflicts and destination checks. Moving own files is distinct from administering an album. |
| Bulk Trash/restore (`library-api`) and legacy single-file archive/restore (`web-api`) | Same `trash-files`/`restore-files` policy on both routes. Preserve legacy request compatibility; new web commands continue carrying revisions. Undo is another current-authority mutation, never a privileged bypass. |
| Permanent deletion (`web-api.permanentlyDelete`) | Owner only, existing Trash prerequisite, separate confirmation, current authority at tombstone and cleanup. Editor must not inherit deletion through a shared management flag. |
| Upload DELETE (`web-api`) | `cancel-upload`: Owner/Editor all; Contributor/Member own. Recheck before state transition and final metadata cleanup. Publication cancellation is a separate branch requiring the matching publication authority. |
| Publication reserve/finish/cancel (`publications`, `route.ts`) | Personal source ownership remains separate. Destination membership alone currently suffices because all current shared roles upload; future Viewer must be denied at reservation **and** finish. Preserve quota, checksum, destination, revision, identity and retry bindings. Align direct cancellation and upload-DELETE cancellation. |
| People, invitations (`space-people`), legacy review (`legacy-reconciliation`) | Owner administration only; self-leave remains an explicit exception. Extend validated role values and invitation storage/acceptance together. Preserve current-session checks, revisions, last-owner protection, invite revocation and exact verified-email binding. |
| Device administration/pairing (`device-access`, `route.ts`) | Keep legacy Owner/Member contract. Do not write account-only roles into legacy device records. Reconcile claimed credentials on account role changes without silently granting a replacement bearer credential. |
| Web session/feed types, cards, selection toolbar and transfer queue (`contracts`, `relay-app`, `library-tools`, `album-sections`, `space-people`, `account-libraries`) | Use server-derived capabilities and explicit role labels. Remove the assumption that every non-Owner is Member and that all file actions share `isOwner`. Mixed selections explain denial; captured transfers retain their original space. |

The legacy single-file actions and device APIs remain live compatibility paths. Updating only the visible web buttons or the bulk APIs is incomplete.

## Findings incorporated into preparation

- [x] Distinguish upload continuation/preview creation from metadata editing. Prepared policy tests deny another contributor's bytes even to Owner/Editor and deny continuation after demotion to Viewer.
- [x] Identify both publication cancellation paths, all legacy file mutations and the claimed-device role propagation path.
- [x] Identify current boolean authority, role labels and transfer capability metadata that must change together.
- [ ] Implement attribution adapters, current-capability SQL predicates and additive role persistence after the Phase 2 gate.
- [ ] Exercise demotion between reservation, signing, storage completion and metadata commit; test publication destination demotion separately from source access.
- [ ] Verify claimed legacy devices, removal/rejoin, stale Undo, mixed selections and last-owner races on the built Worker before any role activation.

No routes, current permissions, memberships, invitations or stored data were changed by this review.
