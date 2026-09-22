# Relay development roadmap

**Last updated:** 22 September 2026
**Scope:** Web app and supporting backend; preserve compatibility with existing clients. Native UI development is outside scope.
**Product reference:** [Product direction, organisation and privacy](PRODUCT-DIRECTION-AND-PRIVACY.md)
**Purpose:** Living development guide and source of truth for progress, outstanding work, decisions and release evidence.

## Current position

Autonomous implementation, verification, commits, pushes and phase progression are authorised through project completion; stop only for a blocker requiring the user. The latest standing instruction is preserved in [AGENTS.md](../AGENTS.md). Phases 0 and 1 are complete. Custom album sections are live. Phase 2 has tested Auth0 protocol and one-time D1 transaction adapters; the Relay Web application is created and its exact redirect URLs are saved; secure local credential handoff is complete; account/session routes, person persistence and a responsive account screen are implemented and locally tested. Memberships, explicit legacy owner claims and account-scoped library access are live for the designated-account pilot; live sign-in/recovery/claim checks passed. General release and remaining operational gates are outstanding. Existing functionality is recorded separately below; its presence does not mean the proposed identity, privacy or collaboration model is already implemented.

**At a glance:** 2 phases complete; 15/47 parent work items complete. Phase 2 is deployed as a restricted designated-account pilot; general account access remains closed; the designated-account personal pilot has a 1 GiB total allocation. Live Worker: `2b08bccf-a9ce-4962-8942-7c698d99c613` at 100%; live library metadata authority, both-origin health and hosted section/exact-byte checks pass. Remote migrations remain through 0018. Latest independent backup/restore `35663011013` verified all 25 originals (321,680,743 bytes), including the latest generated verification files. The preceding storage reconciliation recorded 32 objects and no anomalies, before the latest 65-byte hosted fixture. No user original was removed.

**Next action:** Complete account lifecycle execution and backup/restore reconciliation; confirm the already-sent monitor email receipt and collect continued monitoring capacity evidence. Independent scheduled checks passed at 15:19, 15:49 and 16:19 UTC; optimised runs used 8 ms and 5 ms CPU on Workers Free. Live personal upload, deliberate publication and independent backup verification passed. Isolated cloud interruption/retry, revocation and cancellation checks also passed; the rehearsal endpoint is disabled. The designated-account pilot remains restricted while lifecycle and general-release gates remain open. See [Phase 2 release gates](PHASE-2-RELEASE-GATES.md).

**Recovery custody verified:** Owner submission completed; the encrypted cloud vault was independently downloaded, decrypted and checked. The single-operator intent synchronization command now reads live requests, signs permitted intent changes and independently verifies immutable archive publication; real empty revision 2 and both retained versions passed readback. Continue lifecycle and backup-writer fencing; no real deletion decision or restore cutover is authorised.

**Execution authority (renewed 20 September 2026):** The user explicitly instructed autonomous work through project completion, stopping only when their input is needed to resolve a blocker. This supersedes the earlier commit and phase confirmation preferences and retains the earlier explicit authority to commit and push completed work. See [persistent project instructions](../AGENTS.md). Required tool/security handoffs still apply. No purchase, irreversible deletion or unrelated external communication is inferred.

| Phase | Outcome | Status | Completed work items | Main dependency |
| --- | --- | --- | --- | --- |
| 0 | Agreed product contract and measurable baseline | Done | 5/5 | [Implementation contract](ALBUM-SECTIONS-IMPLEMENTATION.md) |
| 1 | Albums with custom sections | Done | 6/6 | Live; hosted and recovery checks passed |
| 2 | People, recoverable accounts and personal/shared spaces | In progress | 4/7 complete features in restricted pilot | Deletion/retention execution and remaining operational gates |
| 3 | Useful collaboration and upload requests | Not started | 0/6 | Phase 2 |
| 4 | Restricted albums with consistent access enforcement | Not started | 0/6 | Phase 2 and Phase 3 role/access foundation |
| 5 | Deliberate deliveries and portable exports | Not started | 0/6 | Phase 2 and Phase 3 role/access foundation; Phase 4 integration if present |
| 6 | Versions, comparison and review | Not started | 0/5 | Phase 5; validated creative-team demand |
| 7 | Retrieval, media breadth and validated expansion | Not started | 0/6 | Dependencies recorded per work item |

Counts describe completed parent work items, not effort or percentage of the product delivered. Phase 7 is a prioritised expansion backlog, not a commitment to build everything. Phases 4 and 5 can be reordered by explicit decision: useful deliveries need not wait for restricted albums, but must respect them if they exist.

## How to keep this document current

**22 September provider rehearsal:** Passed after owner-performed secret rotation. Exact generated identity creation/removal and independent absence verification succeeded; temporary API and connection access are revoked. [Evidence and checked milestones](PROVIDER-ERASURE-REHEARSAL.md#rotated-continuation--passed) record the writer token expiry. Full lifecycle and backup execution remain outstanding; parent counts are unchanged.

Update this file in the same change set as meaningful development work, and again after a release. Do not leave the tracker describing the state before the change.

1. At phase start, record approval, scope, owner, branch/change reference and the first active work item. Dates are targets only when explicitly agreed.
2. Mark active items `In progress`. Record missing decisions in the decision register and actual impediments in the blocker register.
3. For each finished work item, check its box and add evidence to the work log: implementation location, verification result and remaining limitations. For partial completion, add and maintain individual milestone checkboxes beneath the parent: check completed milestones, keep outstanding milestones unchecked, and leave the parent unchecked until its full acceptance criteria are met. Label completed work as live/configured or implemented and locally tested, as appropriate. Update these checkboxes alongside the narrative on every meaningful change.
4. Update the phase count and status. Keep implementation, verification and release state distinct. A completed local change is not a deployed feature.
5. Before phase closure, fill in the phase-closeout record. A phase is `Done` only when all agreed deliverables and release gates are satisfied, with release evidence for deployable changes and a recorded closeout under the standing execution authority.
6. At handoff or pause, update **Current position**, the next action and outstanding items. A future contributor should be able to continue without reading the entire conversation.
7. If scope changes, log the reason, approval and affected IDs. Do not erase unfinished work to improve the completion count; mark it deferred with its destination and recalculate the agreed scope explicitly.

| Status | Meaning |
| --- | --- |
| Not started | No implementation work has begun. Dependencies may still be outstanding. |
| In progress | Work is actively underway within the approved scope. |
| Blocked | Progress requires a named decision or external change, recorded below. |
| In review | A concrete result is ready; review or required verification is outstanding. |
| Ready for release | Agreed implementation and checks are complete; release remains outstanding. |
| Done | Agreed scope is accepted and, where applicable, deployed and verified. |
| Deferred | Intentionally removed from the active sequence by a recorded decision. |

Use stable work-item IDs in commits, change descriptions and evidence notes. A checkbox means the item meets its acceptance criteria, not merely that code exists. Never mark a proposed capability complete based on this roadmap alone.

## Existing baseline to preserve

These capabilities are documented in the existing implementation and release records. This roadmap does not constitute a new production audit. Reverify the affected baseline as each phase changes it.

| Existing capability | Evidence | Continuing obligation |
| --- | --- | --- |
| Original-byte transfers, resumable uploads and derived previews | [Architecture](PRODUCT-ARCHITECTURE.md) | Preserve original bytes and metadata; keep truthful progress and recovery. |
| Albums, multiple album membership, search, dates and upload batches | [Web library](WEB-LIBRARY.md) | Preserve file identity and existing references during migration. |
| Device pairing and owner/member access within a space | [Readiness record](PHASE-1-READINESS.md), [authentication](../lib/server.ts) | Preserve legitimate access; do not infer person identity from device names. |
| Refined web controls, selection, direct actions, confirmations and Undo | [Visual polish](WEB-DESIGN-POLISH.md), [Interaction polish](WEB-INTERACTION-POLISH.md) | Extend the existing visual language and reassess interactions where new consequences warrant it. |
| Trash, revision checks and recovery paths | [Library API](../lib/library-api.ts), [Interaction polish](WEB-INTERACTION-POLISH.md) | No silent overwrites, scope widening or accidental permanent deletion. |
| Documented monitoring and independent backup/restore activation | [Operations](OPERATIONS-ACTIVATION.md), [Backup and recovery](BACKUP-RECOVERY.md) | Extend coverage as the data model grows; verify current health before relying on a recovery point. |

Current production limitations: identities remain device-based; albums and sections are not privacy boundaries; Original/Final remains a compatibility field behind secondary controls; version relationships are absent. Custom sections are now live. Proposed personal spaces, restricted albums, guest requests and deliveries must not be described as available until released.

## Product rules that guide every phase

- Structure: **person → personal/shared space → album → custom sections → files**. A delivery is a separate, intentional handoff.
- Sections organise content and inherit the album audience. Names such as Private, Approved or Final do not create permissions or review state.
- A file can appear in multiple albums. Within an album it has zero or one section. Album membership alone must not broaden access.
- The default library is scoped to the active space. Personal content never appears implicitly in a shared library. Restricted content later has an explicit browsing scope.
- Personal means server-enforced privacy from other application users. Do not promise end-to-end encryption or confidentiality from the service operator.
- Publishing across privacy boundaries is explicit, with an audience summary. Prefer a verified independent copy initially; explain that source deletion cannot recall it.
- Originals remain immutable. Previews, sanitised exports and later edits are separately identified derivatives or versions.
- Reversible organisational actions should offer reliable Undo. Consequential audience changes and permanent deletion require proportionate confirmation. Review existing permission and confirmation behaviour rather than preserving it automatically.
- Selection counts describe the actual selected scope. Keyboard, touch and screen-reader users must be able to complete every essential workflow.
- Flag legacy fields, navigation and behaviour as retirement candidates before removal. No silent destructive migration or automatic duplicate deletion.

These are recommended defaults carried forward from the assessment. Phase 0 records acceptance or amendments before dependent implementation.

## Phase 0 — Product contract and baseline

**Outcome:** Implementation begins with agreed semantics and evidence rather than assumptions.
**Entry:** Review the assessment and this roadmap.
**Status:** Done. Owner: Codex. Authority: autonomous execution instruction, 19 September 2026. Evidence: [implementation contract](ALBUM-SECTIONS-IMPLEMENTATION.md); product/source review, not customer interviews.

- [x] **P0-01 — Confirm audience and sequence.** Agree personal/small-group use as the initial focus, whether privacy needs bring Phase 2 forward, and the exact first release scope.
- [x] **P0-02 — Settle organisation and audience rules.** Resolve D01–D04 below with concrete scenarios, including multi-album placement and private-to-shared publication.
- [x] **P0-03 — Establish baseline evidence.** Inventory relevant routes, data relationships, supported clients and existing checks. Record current transfer, recovery and usability behaviour without exposing user content or credentials.
- [x] **P0-04 — Validate representative journeys.** Review solo transfer, family collection, creative handoff, sensitive media, mistaken deletion and lost-device recovery. Record whether evidence comes from product review or actual user research; do not conflate them.
- [x] **P0-05 — Approve first implementation contract.** Produce a concrete UX/data proposal, migration preview, test plan and rollback boundaries for the first feature phase. Identify dependencies and estimates only after scope is understood.

**Exit criteria:** D01–D04 have recorded outcomes; first-phase deliverables and acceptance scenarios are agreed; outstanding provider or retention decisions have owners and due-before milestones. Research requiring participant contact or analytics collection remains separately authorised.

## Phase 1 — Flexible album organisation

**Outcome:** Users organise events and projects in their own language without global Original/Final constraints.
**Entry:** Phase 0 decisions; standing autonomous execution authority.
**Status:** Done. Owner: Codex. Authority: standing autonomous execution instruction. Released 19 September 2026; closeout below.

- [x] **P1-01 — Review album/section experience.** Design desktop and narrow-screen navigation, All in this album, Unsectioned, Unorganised, counts, empty states and clear action labels. Review a concrete prototype before broad implementation.
- [x] **P1-02 — Add section storage and APIs.** One level; unique names within an album; editable name, order and cover; section placement belongs to an album membership. Enforce same-album references and concurrency checks.
- [x] **P1-03 — Build organisation workflows.** Create, rename, reorder, move and remove sections; support individual and bulk placement, keyboard/menu alternatives and Undo. Removing sections preserves files under Unsectioned; removing albums preserves files and access.
- [x] **P1-04 — Bind uploads to destinations.** Capture space/album/section when queued; display the destination and handle destination deletion or revoked access without silently rerouting an upload.
- [x] **P1-05 — Migrate categories safely.** Offer blank or optional Originals/Final cuts templates and an explicit per-album mapping preview. Retain legacy categories and unfiled content; flag global category UI for retirement only after compatibility is proven.
- [x] **P1-06 — Verify and release organisation.** Exercise migrations, multi-album isolation, concurrent edits, Undo, queued transfers and responsive/accessibility behaviour. Record release and regression evidence.

**Acceptance scenarios:** A file in Album A/Shortlist and Album B/References moves within A without changing B or original bytes. Section removal preserves all files. Navigating elsewhere does not redirect a queued upload. No section is represented as private. Existing clients remain compatible or receive an explicit supported response.

**Outside this phase:** Person accounts, restricted sections, arbitrary folder depth and approval state inferred from section names.

## Phase 2 — Identity and personal/shared spaces

**Outcome:** One person can safely use several devices and spaces, with a recoverable private library.
**Entry:** Phase 0; D05–D07 resolved for this scope; reconcile the current organisation schema.
**Status:** In progress; restricted production pilot active; general release awaits operational gates. Owner: Codex (implementation), user (provider account/access). Standing execution authority applies. [Implementation design and setup requirements](IDENTITY-AND-SPACES-IMPLEMENTATION.md) prepared; protocol/configuration and one-time transaction storage tests pass, and person/session persistence, route orchestration and account UI now pass local checks. Real login, recovery, logout and the approved legacy owner migration are verified; general release remains outstanding.

- [ ] **P2-01 — Select and review identity design.** Compare suitable authentication providers, recovery, passkey/sign-in options, costs and operational dependencies. Review the trust model before choosing; use mature authentication rather than custom cryptography.

  - [x] Compare providers, select Auth0 and document the identity/access trust model. **Design complete.**
  - [x] Register Relay Web, save exact callback/logout URLs and securely supply the client secret. **Configured.**
  - [x] Connect `relayalbums.com`, verify HTTPS and update exact-origin R2 access. **Live.**
  - [x] Verify the Resend sender, connect Auth0, deliver a test email and confirm inbox receipt. **Verified with the user.**
  - [ ] Finalise production sign-in methods and confirm post-trial/free-plan suitability, including social-provider configuration.
  - [x] Implement authenticated recovery events, monotonic password-change tracking and signed-login reconciliation; revoke older sessions without changing library membership. **Locally tested; migrations 0016-0017 and Auth0 Action sources prepared.**
  - [x] Verify real password recovery, pre-login notification-driven revocation, fresh sign-in and provider logout. **Live designated-account verification complete; automated failure monitoring remains a separate release gate.**

- [x] **P2-02 — Implement person and session foundations.** Add identities and space memberships, link authorised sessions, enforce requested-space access on the server, and support session listing, temporary/trusted sessions and remote sign-out.

  - [x] Implement stable provider identities and separate, hashed account-session storage. **Locally tested; migration 0008 prepared.**
  - [x] Implement one-time, browser-bound sign-in transactions and replay protection. **Locally tested; migration 0007 prepared.**
  - [x] Connect login/callback/session/list/revoke/logout routes with expiry, credential rotation and cross-site request protection. **Locally tested.**
  - [x] Build responsive account and browser-session controls, including failed-request recovery. **Browser tested with mock account data.**
  - [x] Add person-to-space membership storage and a membership-scoped library list. **Locally tested; migration 0009 prepared.**
  - [x] Enforce person membership and explicit requested-space context at the shared file/library API boundary; connect account libraries, previews, edits and captured upload destinations to the UI. **Locally tested; migration 0010 prepared.**
  - [x] Implement temporary/trusted session choices and connect account sessions to authorised space access. **Locally tested; migration 0012 prepared. Temporary defaults to 8 hours; trusted is an explicit 7-day choice.**

- [x] **P2-03 — Migrate legacy access deliberately.** Provide verified account/space claims and recovery; separate Connect my device from Invite a person. Never merge users by device labels, overwrite existing memberships or relabel shared spaces as personal.

  - [x] Implement owner-claim preview and confirmation using a verified account plus a current owner-device credential. **Locally tested.**
  - [x] Bind claims to a recent account session, expire previews after five minutes, prevent replay/conflicting claims and record immutable claim evidence. **Real-D1 race and revocation tests passed.**
  - [x] Add the named library/account preview, Cancel and explicit confirmation to the account screen. **Phone/desktop browser checks passed with mock account data.**
  - [x] Complete account-based file/library access with stable upload attribution across account sessions. **Locally tested.**
  - [x] Separate signing in on another device from email-bound person invitations, with preview/explicit acceptance and owner revocation. **Implemented and locally verified; migration 0013 prepared.**
  - [x] Add owner-only paired-device inventory, verified claim labels, individual disconnection and explicit retirement of all paired access while preserving account ownership and files. **Locally tested, including pairing races.**
  - [x] Review the actual legacy-device audience and verify the complete migration flow with the real provider. **User-approved live claim completed on 21 September: original desktop owner and phone member retained; new primary-origin owner device explicitly linked to the designated account.**
  - [x] Verify claims and recovery with the real provider, apply migrations through 0018 and release within the designated-account pilot. General onboarding remains gated by P2-07.

- [x] **P2-04 — Deliver My space and the space switcher.** Show active identity, destination and role. Clear selection/search on switch; preserve queued transfers at their original destination with a return link. Personal spaces start separately and remain inaccessible to shared-space owners.

  - [x] Open an explicitly selected library from Account; carry scope through previews, filters, mutations and transfer manifests. Reset mounted library state on navigation and clear rendered content when access is denied. **Locally tested.**
  - [x] Add My space with a fixed 1 GiB allocation per person and an explicit operator-set total allocation budget, disabled by default. Preserve existing shared-space quotas. **Locally tested; migration 0011 prepared.**
  - [x] Add a grouped library switcher, cross-space queue restoration and destination links. Only current account memberships can restore local manifests; upload/cancel/restart retain the manifest destination. Full navigation warns for active transfers and reselecting the original resumes in its captured library. **Browser tested with identity fixtures.**
  - [x] Configure a 1 GiB total pilot allocation and verify My space, upload destination, separate shared counts and switching with the real designated identity. Cross-person denial and transfer retention pass the actual-schema/browser suites.
- [x] **P2-05 — Provide explicit publication.** Implement the approved private-to-shared copy flow with source/destination permission checks, audience confirmation, storage accounting, verified completion and clear independent-copy semantics.
- [ ] **P2-06 — Complete account lifecycle and retention rules.** Recovery, ownership transfer, leaving a space, offboarding, account-deletion handling and shared-content ownership have explicit policies and supported flows. Preserve deletion/revocation decisions through restore.

  - [x] Invalidate restored account sessions and pending sign-in attempts so old credentials cannot revive. **Restore tests passed.**
  - [x] Implement ownership handover, leaving and removing account members with revision checks, atomic last-owner protection, linked-device revocation and preserved files. **Implemented and locally verified; migration 0013 prepared.**
  - [x] Implement deletion review, recent-sign-in/ownership-handover checks, idempotent pending requests, withdrawal and restore holds. Record actual live/backup retention and operator execution gates. **Locally tested; migration 0018 prepared; [retention runbook](ACCOUNT-DELETION-AND-RETENTION.md).**
  - [ ] Complete and verify real account recovery, comprehensive legacy offboarding and account-deletion rules.
  - [ ] Finalise retention and shared-content ownership policies, including restoration of future membership/deletion records.

- [ ] **P2-07 — Verify and release identity/privacy.** Test cross-person and cross-space denial, legacy claims, recovery, sign-out/caches, in-flight transfers and backup restoration of new tables. Record capability handling for older clients and safe rollback limits.

  - [x] Pass local signed-token, real-D1 identity/session, callback replay, cross-account revocation and CSRF checks. **Local security evidence recorded.**
  - [x] Pass existing API regressions, account UI checks, build, lint, TypeScript and backup-restore checks. **Local verification complete for the current increment.**
  - [x] Commit and push the tested account/session increment and supporting documentation. **`0218360` on main.**
  - [x] Verify real Auth0 sign-in, recovery and provider logout end to end. **Live temporary/trusted sign-in, password-change revocation and provider audit evidence recorded.**
  - [x] Verify live claim/migration and personal/shared UI boundaries; actual-schema cross-person/cross-space and browser in-flight destination tests plus legacy API regressions pass. Hosted isolated D1/R2 publication race checks also pass.
  - [x] Apply migrations through 0018, activate restricted pilot sign-in and record hosted verification and rollback boundaries. General release remains closed until operational/lifecycle gates pass.


**Checkbox guide:** P2-02 through P2-05 are completed features in the restricted live pilot, supported by local/hosted evidence. Phase 2 and general onboarding remain incomplete because P2-01/P2-06/P2-07 still have release gates. Checked milestones above are complete at the stated level. Unchecked parent items still contain outstanding work; locally tested code is not yet a live feature. Phases 0 and 1 remain fully checked off.

**Acceptance scenarios:** Joining Family does not expose My space or replace Studio membership. A lost device can be revoked without deleting shared work. Recovery requires ownership proof. Personal content cannot be discovered through counts, covers, search, activity, Trash or original download routes. Restoring a backup does not revive revoked sessions.

**Outside this phase:** End-to-end encryption, hidden private albums inside an otherwise shared device-only library, and silent background publication.

## Phase 3 — Collaboration and controlled collection

**Outcome:** Collaborators can contribute and organise without becoming administrators; occasional contributors can submit without browsing the library.
**Entry:** Phase 2; approved role matrix and guest intake policy.
**Status:** Implementation not started; [role and intake contract](COLLABORATION-IMPLEMENTATION.md) prepared under standing authority. Owner: Codex. Phase 2 remains the implementation/release dependency; preparation does not satisfy the role-delivery acceptance criteria.

- [ ] **P3-01 — Deliver scoped roles.** Owner, Editor, Contributor and Viewer have server-enforced capabilities; prioritise Editor. Distinguish viewing, downloading, contribution, organisation and access administration without exposing a complex matrix on every menu.

  - [x] Prepare a source-reviewed role/intake contract, explicit invitation defaults and compatibility rules. Existing Member must not be silently upgraded to Contributor or Editor; live permissions are unchanged.
  - [ ] Implement and verify central server capabilities, additive person roles and every affected API/UI path after Phase 2 gates.
- [ ] **P3-02 — Make access understandable.** Invitations, member management, audience summaries and previews of consequential changes explain who gains access. Removing members preserves space-owned work and ends future authorised access.
- [ ] **P3-03 — Build private favourites and scoped activity.** Person-owned bookmarks do not act as public approval. Durable action history includes actor/time and distinguishes reversible, conflicting and irreversible events. Start notifications in-app with privacy-safe text.
- [ ] **P3-04 — Build bounded upload requests.** Explicit destination, expiry, revocation, file/size/storage limits and invited or passcode-protected intake. Show recipient and limits before upload; provide a receipt without library access. Mark unverified contributor names as self-reported.
- [ ] **P3-05 — Establish guest abuse and cost controls.** Quota reservations, rate/volume limits, safe content disposition and preview processing, reporting/operational response and truthful completion states. No unbounded anonymous storage.
- [ ] **P3-06 — Verify and release collaboration.** Test each role and guest capability on APIs and UI, concurrent quota use, expiry/revocation during uploads, history visibility and recovery. Record operations guidance and release evidence.

**Acceptance scenarios:** An Editor organises without administering membership. A Contributor cannot delete someone else's files. An upload-only guest cannot enumerate files, see others' submissions or use an upload grant to download. Revoked/expired requests fail safely without bypassing quotas.

**Outside this phase:** Full enterprise administration, public discovery and review links that grant general workspace membership.

## Phase 4 — Restricted albums and consistent privacy

**Outcome:** Smaller audiences inside a shared space are protected across every access path.
**Entry:** Phase 2 and P3-01/P3-02; D08 resolved; central access policy reviewed.
**Status:** Not started. Owner: unassigned. Approval: not recorded.

- [ ] **P4-01 — Define asset access scopes.** Restrict album membership to compatible asset scopes. Sections inherit the album audience. Define explicit and audited administrator grants; never imply shared-space administrators own personal spaces.
- [ ] **P4-02 — Implement restricted album management.** Specific people, access preview, scoped organisation and explicit cross-scope publication. Adding an album reference cannot silently union audiences or remove prior exposure.
- [ ] **P4-03 — Apply policy to every surface.** Feed, search, suggestions, counts, covers, preview/original URLs, range requests, exports, activity, notifications, Trash, caches and administrative totals follow the agreed disclosure policy.
- [ ] **P4-04 — Refine library navigation.** Shared library shows general space content. Restricted albums appear only to authorised people. Any combined Everything I can access view is deliberate and clearly scoped; no misleading All files label.
- [ ] **P4-05 — Preserve privacy through lifecycle changes.** Restricted album removal retains files in equally restricted recovery/unorganised storage. Restore re-evaluates grants. Older clients/routes cannot bypass policy; rollback never reinstates code that ignores restrictions.
- [ ] **P4-06 — Verify and release restrictions.** Execute adversarial multi-user/multi-album tests, indirect-disclosure checks, revocation during open views/transfers, migration and restore exercises. Document signed-URL limits and any changed delivery architecture.

**Acceptance scenarios:** An unauthorised person cannot infer an album or file through secondary surfaces. Removing an album cannot publish its assets. Restore cannot reinstate revoked shares. A file already generally shared is not described as made confidential by adding a restricted reference. Issued URLs and downloaded-copy limitations are explained accurately.

**Outside this phase:** Arbitrary per-file exceptions, section-specific permissions and confidentiality from administrators without a different trust/encryption design.

## Phase 5 — Deliveries and portability

**Outcome:** Recipients receive an intentional selection, and users can export useful, complete collections.
**Entry:** Phase 2 and role/access foundations; integrate Phase 4 scopes if released; D09 resolved.
**Status:** Not started. Owner: unassigned. Approval: not recorded.

- [ ] **P5-01 — Define immutable delivery selections.** Snapshot explicit asset versions by default; do not require the later creative lineage UI. Review audience, expiry, authentication/passcode and recipient capabilities before publishing.
- [ ] **P5-02 — Build recipient and sender workflows.** Focused branded presentation, predictable downloads, revoke/update controls and a sender preview of exposed content. A live collection is a separately approved optional mode, never an implicit default.
- [ ] **P5-03 — Deliver selected-file download/export jobs.** Bounded background packages with progress, cancellation, retries, collision-safe names and limits; avoid huge browser-memory archives. Check permissions at job creation and retrieval and define loss-of-access behaviour.
- [ ] **P5-04 — Provide portable metadata and import mapping.** Export originals with names, dates, albums, sections and available relationships in a manifest. Preview directory-import mapping and name collisions; support browser fallbacks without claiming universal folder APIs.
- [ ] **P5-05 — Clarify metadata and delivery status.** Explain EXIF/location exposure in original files; assess an explicitly labelled sanitised derivative option. Distinguish viewed, download started, verified save and recovery status using real events only.
- [ ] **P5-06 — Verify and release handoff.** Recipient usability, byte integrity, scope/expiry/revocation, large jobs, partial failures, operational costs and export completeness. Confirm export artifacts also expire and follow access policy.

**Acceptance scenarios:** A new draft in the working album never appears in an existing snapshot link. Recipients cannot browse the source library. Expired grants cannot generate new access. Exported originals are byte-identical and the manifest explains organisation. Source deletion is not represented as recall of downloaded copies.

## Phase 6 — Creative versions and review

**Outcome:** Creative teams can compare and discuss the right version without losing originals.
**Entry:** Phase 5, evidence of demand and approved review scope.
**Status:** Not started. Owner: unassigned. Approval: not recorded.

- [ ] **P6-01 — Validate the smallest useful review workflow.** Confirm actual needs for related versions, comparison, comments and approvals. Record what will be omitted from the first release.
- [ ] **P6-02 — Add explicit version relationships.** Add related version, lineage and current-version navigation while preserving immutable assets. Similar filenames may suggest a relationship but do not silently create it.
- [ ] **P6-03 — Build appropriate comparison and feedback.** Photo/video comparison, version-specific comments and, if validated, time-based annotations; include accessible alternatives and scoped moderation.
- [ ] **P6-04 — Add version-specific approvals.** Record actor, time and exact version. A later upload does not inherit approval; moving to a section called Deliverables does not approve it. Delivery updates stay deliberate.
- [ ] **P6-05 — Verify and release review.** Exercise deleted/restricted versions, revoked reviewers, historical feedback, restored relationships and recipient clarity. Extend export and backup manifests to cover new records.

**Acceptance scenarios:** Users can identify the reviewed version and compare it with the source. New versions leave past approvals attached to their original targets. Feedback never exposes inaccessible versions or broadens a guest's grant.

## Phase 7 — Retrieval, media support and selective expansion

**Outcome:** Improve discovery and media handling based on observed needs without weakening the core product.
**Entry:** Prioritise each item after its prerequisites under standing execution authority; unresolved consent, purchasing or account-access requirements still need user input.
**Status:** Not started. Owner: unassigned. Approval: not recorded.

- [ ] **P7-01 — Better retrieval.** Permission-aware type/uploader/date/album/section filters and useful saved views. Requires identity/access foundations; may be brought forward after Phase 2 by recorded decision.
- [ ] **P7-02 — Exact duplicate assistance.** Scope-safe verified-hash matching with reuse choices, no cross-account existence disclosure and no automatic deletion. Requires settled access-scope rules.
- [ ] **P7-03 — Broader media relationships and previews.** Prioritise RAW/JPEG companions, sidecars, Live Photo components and unsupported-format fallbacks from real demand. Bound preview costs and preserve bytes; disclose import/export limitations.
- [ ] **P7-04 — Focused home and presentation privacy.** Current-space recent albums and interrupted transfers; evaluate deliberate thumbnail/name concealment for presentations. Concealment is a presentation feature, not authorisation.
- [ ] **P7-05 — Notification preferences and quiet digests.** Extend scoped in-app activity only after demand is demonstrated; include consent/preferences and no sensitive content leakage through notification previews.
- [ ] **P7-06 — Evaluate optional semantic search.** Discovery only until explicit approval: processing consent, cost, retention, index authorisation and deletion propagation must be agreed before a pilot. Default-on AI or face identification is not included.

**Acceptance:** Each approved item has its own measurable user benefit, scope, acceptance scenarios and release record. Discovery that results in a documented decision not to build counts as completed discovery, never as a shipped feature.

## Gates applied to every feature release

Record applicability and evidence; do not mechanically rerun unrelated tests or treat every gate as a new approval request.

| Gate | Required evidence |
| --- | --- |
| Product and visual quality | Agreed journeys work with consistent controls, typography, spacing, empty/loading/error states and clear audience/destination labels. Review desktop and narrow-screen layouts. |
| Accessibility | Keyboard completion, sensible focus/dialog return, meaningful labels, touch alternatives, contrast, reduced motion and accessible progress for affected flows. |
| Data integrity | Original-byte integrity, preserved metadata/references, revision conflict handling and appropriate migration fixtures. |
| Access and recovery | Relevant denial tests, no indirect metadata disclosure, current grant evaluation on restore, and safe session/share revocation. |
| Transfers and resilience | Appropriate large-file, interrupted/retried upload/download, navigation and partial-failure checks; accurate rather than optimistic success states. |
| Migration and operations | Recovery point when needed, restore coverage for changed tables, rollout/rollback constraints, quotas/costs and operational guidance. |
| Compatibility | Supported existing clients tested; incompatible paths gated explicitly, never allowed to bypass privacy. |
| Documentation and acceptance | Tracker, user-facing semantics and known limitations updated; phase approval and applicable release authorisation recorded. |

For identity or access changes, test loss of access during an open viewer, queued upload, running export and active download. Existing signed URLs may remain usable until expiry; stronger revocation claims require a tested architectural change. A downloaded copy cannot be recalled.

## Decision register

`Proposed` means a recommended direction, not a recorded user decision. Add outcome, date and evidence when resolved. Select providers, retention periods and architecture alternatives through a concrete review rather than silently choosing.

| ID | Decision | Recommended direction | Status / needed before |
| --- | --- | --- | --- |
| D01 | Primary users and sequence | Personal and small-group media first; sections next unless privacy is urgent | Resolved: recommended default / standing execution authority |
| D02 | Organisation semantics | One section level, optional templates, zero/one placement per album, many albums per asset | Resolved: recommended default / standing execution authority |
| D03 | Default browsing scope | Active space only; general Shared library distinct from restricted content later | Resolved: recommended default / standing execution authority |
| D04 | Cross-audience publication | Explicit verified independent copy initially; no automatic union of album audiences | Resolved: recommended default / standing execution authority |
| D05 | Identity/provider and legacy claims | Recoverable person identity, mature auth, explicit ownership proof | Auth0 email/password selected; recovery, logout and explicit owner claim verified in restricted pilot. Free-plan follow-up/general-release gates remain tracked under P2 |
| D06 | Ownership and offboarding | Shared work belongs to the space; personal work remains separate; explicit transfer/recovery | Proposed / P2 lifecycle design |
| D07 | Retention and deletion | Document Trash, history, backups, account deletion and restore reconciliation separately | Open / P2 lifecycle design; revisit guest artifacts in P5 |
| D08 | Restricted content and administrators | Explicit audited administrator grants; no access to members' personal spaces | Proposed / P4 design |
| D09 | Delivery and revocation guarantees | Snapshot default; explicit guest capabilities; honest bearer-URL limits | Proposed / P5 design |
| D10 | Creative workflow investment | Validate need before versions, comments and approvals | Open / P6 start |
| D11 | Expansion investments | Prioritise measured friction; optional AI needs separate consent/cost review | Open / each P7 item |

## Risks, blockers and deferred scope

Planning dependencies are not incidents. Current access, operational and verification dependencies are:

| ID | Affected work | Required input | Owner | Opened | State |
| --- | --- | --- | --- | --- | --- |
| B01 | P2-01 and dependent identity/privacy/collaboration phases | Relay Web is registered and exact URLs saved. Client secret received through ignored local storage; relayalbums.com is purchased and live; Resend account created; sender domain verified and scoped sending key created; Auth0 provider saved and verified; test and recovery emails delivered; restricted runtime, recovery and owner claim verified. No secrets in chat or Git. | Codex | 2026-09-20 | Resolved for restricted pilot: provider access, recovery, logout and owner connection verified; general-release operations tracked separately |
| B02 | Next release / recovery reliability | Scheduled backup run 35486931770 failed with a read-only D1 query HTTP 400. Cause reproduced: SQL expression depth exceeded D1 limit. Balanced concatenation passes local D1/API tests and a live read-only snapshot restore. Hosted backup, Backblaze restore and verification passed in run 35491216252. | Codex | 2026-09-20 | Resolved |
| B03 | P2-06 cloud erasure rehearsal | Sign-in and revised isolated-bucket access approved. Generated-only cloud version removal/restoration passed; temporary credential revoked. [Evidence](ERASURE-REHEARSAL-ACCESS.md). | Codex | 2026-09-21 | Resolved for this rehearsal; independent ledger, live/provider executor and lifecycle release remain open |
| B04 | P2 monitoring reliability/capacity | Independent Cloudflare cron passed at 15:19 and 15:49 UTC with signed delivery and healthy readback. Optimisation reduced the observed CPU sample from 10 ms to 8 ms on confirmed Workers Free. [Evidence](SCHEDULED-IDENTITY-MONITOR.md). | Codex: capacity/continued coverage; user: pending alert receipt and earlier subscription clarification | 2026-09-21 | Scheduled execution verified; expansion capacity and external alert receipt remain open. No paid change made |
| B05 | P2-06 independently recoverable signing custody | Owner saves a unique recovery password and enters/confirms it in the staged local form. The form and encryption/recovery tests pass; existing scoped B2 access is verified. | User: password-manager/form handoff; Codex: verify resulting custody and continue archive/executor integration | 2026-09-21 | Resolved: owner submission, pinned encrypted-vault recovery and initial empty archive verification passed; no real erasure decision signed |

Phase 2 account/session, membership/claim, scoped library and personal-space foundations are deployed in the designated-account pilot. Live callback/recovery/logout, owner claim, 1 GiB pilot allocation and migrations through 0018 are verified. Lifecycle execution, real decision integration, continued monitoring evidence and general-release acceptance remain open.

| ID | Risk / response | Owner | State |
| --- | --- | --- | --- |
| R01 | Mistaken legacy identity claims: require proof, recovery review and migration fixtures | Codex | Claim proof and migration fixtures verified; historical completeness remains under review |
| R02 | Multiple album references widen visibility: explicit asset scopes and negative tests | Codex | Phase 4 planning risk; present references stay within their space |
| R03 | New policy bypassed by old clients/caches/exports: central policy and capability gates | Codex | Ongoing release requirement; current pilot compatibility checks pass |
| R04 | Guest intake, copies, versions and exports increase storage/processing costs: quota reservation and bounded jobs | Codex | Bounded personal/publication pilot verified; future intake/export limits remain open |
| R05 | Restore revives access or deletion state: extend backup schema and verify reconciliation | Unassigned | Open planning risk |
| R06 | Scope expands beyond useful core workflows: phase-specific acceptance and demand gates | Unassigned | Open planning risk |

When blocked, add: `Blocker ID | affected item | observed problem | required action/decision | owner | date | resolution`. Preserve resolved blockers as history.

**Deferred unless separately approved:** Unlimited nesting; arbitrary per-file/section permission exceptions; end-to-end encrypted vault; default AI tagging; face identification; browser media editor; public discovery/marketplace; automatic deletion; full enterprise administration. These are outside the committed phase scope, not quietly forgotten features.

## Validation and progress evidence

Proposed research tasks: place private/shared media correctly; explain who can see a multi-album file; organise and retrieve using custom sections; contribute without browsing; deliver selected versions without drafts; recover an accidental action or lost device; remove a collaborator safely.

Establish baselines before choosing numeric targets. Track task completion, mistaken-audience choices, time to first successful handoff, retrieval success, transfer/recovery failures and repeated useful collaboration. Do not substitute upload volume for product success. Operational and product analytics must avoid filenames, signed URLs, image content and private search terms. Research recruitment and new analytics collection need their own authorised scope.

### Work log

Append concise entries; link to detailed evidence instead of pasting entire test logs. This initial entry records documentation only.

| Date | Item | Completed / evidence | Outstanding / next action |
| --- | --- | --- | --- |
| 2026-09-19 | Planning documents | [Assessment](PRODUCT-DIRECTION-AND-PRIVACY.md) and phased roadmap created; local document links validated | Phase 0 decisions, feature approvals and all implementation items |
| 2026-09-19 | P0-01?P0-05 | Product defaults and section implementation contract recorded; baseline `8820a84` pushed | Phase 1 implementation followed |
| 2026-09-19 | P1-01?P1-06 | `78b7b96` pushed, CI passed, migrations and Worker release verified; full closeout below | Phase 2 provider dependency |
| 2026-09-19 | P2-01 preparation | Identity/spaces proposal and provider setup requirements written | B01: awaiting user-owned provider selection/access |

For subsequent entries use: `Date | work-item ID | concrete change and file/PR/test evidence | remaining work`. Record verification failures and material limitations as well as successes. Do not call work deployed without a release reference.

### Phase closeout record

Copy this block for each phase; replace placeholders with evidence. Retain past records.

```text
Phase:
Agreed scope / approval reference:
Owner and dates:
Completed work-item IDs:
Deferred IDs, reason and approved destination:
Implementation references:
Verification results and evidence:
Migration / backup / recovery evidence (or applicability):
Known limitations and unresolved risks:
Release authorisation and deployment reference (or non-deployable phase):
Post-release verification:
User acceptance / phase closure:
Next proposed phase and outstanding decision:
```

### Roadmap change history

| Date | Change | Basis |
| --- | --- | --- |
| 2026-09-19 | Created the living guide; separated collaboration, restricted albums, deliveries and expansion into independently reviewable phases | User requested a phased development guide incorporating the product assessment and showing completed/outstanding work |

Latest milestone: Phase 1 deployed and verified on 19 September 2026. Auth0 application registered on 20 September; secure credential handoff remains B01. Scheduled backup failure B02 is fixed and verified.

| 2026-09-19 | Autonomous execution authorised; Phase 0 started | User explicitly instructed continued work, commits and pushes, stopping only for blockers |

### Current execution evidence

- `8820a84` pushed to `origin/main`: prior approved UI polish and planning baseline. Web lint and TypeScript passed.
- Phase 0 closed by product/source review under standing authority; [section implementation contract](ALBUM-SECTIONS-IMPLEMENTATION.md) records semantics, migration and tests.
- Phase 1 implementation verified: section schema/APIs, bulk placement/Undo, queued destinations, templates, ordering and covers. Original/Final controls are secondary and retained for compatibility. Tests cover API regression, migration, browser journeys, keyboard/mobile and recovery. Production release and hosted verification passed.
- Template preview intentionally maps at most 100 existing files per operation, matching bulk-selection limits. Larger albums can create empty template sections and move selected batches.
- Fresh production export restored in isolated SQLite and D1; migrations rehearsed against it with all media records and memberships preserved. Private evidence: `.sites-runtime/sections-release/`.


### Phase 0 closeout ? complete

- Authority: user instruction to work autonomously, commit and push, 19 September 2026.
- Completed: P0-01?P0-05; recommended D01?D04 defaults recorded in the [implementation contract](ALBUM-SECTIONS-IMPLEMENTATION.md).
- Evidence: source/product review and baseline lint/TypeScript; no invented customer interviews or analytics. Baseline preserved in `8820a84`.
- Non-deployable planning phase. Outstanding provider, ownership and retention decisions remain in Phase 2.

### Phase 1 closeout ? complete

- Completed: P1-01?P1-06; code `78b7b96`, pushed to `origin/main`.
- [GitHub CI passed](https://github.com/kiwanukaphil-oss/media-sharing-app/actions/runs/35431804584): verification and browser jobs.
- Local verification: TypeScript, zero-warning lint, build, full API/security regression, migration preservation, backup/restore tests, existing Chrome/Edge/Firefox/WebKit workflows. New section journeys including cover choice also passed Chrome, Firefox and WebKit. Screenshots reviewed at desktop and 390 px.
- Migration: `0005_album_sections.sql` and `0006_section_covers.sql`; fresh recovery export restored and both migrations rehearsed before application. Existing original media records and album memberships compared successfully after migration.
- Release: standing execution authority; Worker `76609db5-810c-4c08-8968-6c8b4dcd97d7`, 100% allocation. Public entry, headers, readiness and anonymous-feed denial passed.
- Hosted verification: `tests/hosted-sections.mjs` passed create, captured direct-R2 upload destination, move/Undo, remove/restore, deep-link reload and exact-byte download in **Relay verification** only. The first download check hit Chrome's OS picker; the test was corrected to exercise browser-managed download and passed. No product workaround was required.
- Recovery: final production snapshot containing populated section records restored into isolated SQLite and D1 with integrity, foreign keys and all application table counts passing.
- Limitations: template preview maps up to 100 files per operation; larger albums create empty sections and use selected batches. Original/Final schema remains for compatibility behind secondary File labels controls. Sections do not change permissions. WebKit automation is not physical Safari testing.
- Recovery artifacts and logs remain private under `.sites-runtime/sections-release/`; screenshots under `outputs/sections/`. Tiny newly created hosted verification fixtures are retained as removal candidates, not deleted automatically.
- Rollback: previous Worker `178f6f01-879f-4d50-90d6-fb3c06913dd5` can read the additive schema. Prefer a forward fix; old membership remove/re-add code does not preserve section placement, so old code is not a fully equivalent organisation rollback. Never drop section data to roll back the UI.
- Next: P2-01, blocked on B01. [Identity/spaces design](IDENTITY-AND-SPACES-IMPLEMENTATION.md) is ready for provider setup.


### Auth0 preparation update ? 19 September 2026

- User instructed ?proceed as recommended?: Auth0 hosted sign-in selected; no repeat provider-choice approval is needed.
- Opened Auth0 dashboard in the Chrome **Relay sign-in** tab. It displays the Auth0 login screen; the user was asked to sign in/create their account there and report ready. Credentials and account terms stay in that browser flow.
- Implemented `lib/auth0-config.ts`, `lib/auth0-client.ts`, a public setup-settings generator and protocol tests using a simulated provider with real RSA-signed tokens. Tests cover PKCE/state/nonce, issuer/audience/signatures, browser binding, expiry, bad redirects, missing tokens and provider code replay. Tests are wired into CI.
- Local protocol tests, dependency audit (zero reported vulnerabilities), TypeScript, web lint and production build passed. This is preparatory code, not a live sign-in deployment.
- `AUTH0_ENABLED=false` remains the documented default. Account routes, atomic transaction consumption, user/session persistence, legacy claims, recovery and live tenant verification are outstanding. P2-01 remains unchecked until the provider and recovery design are fully configured and reviewed.
- [Exact public callback/logout settings and remaining integration work](IDENTITY-AND-SPACES-IMPLEMENTATION.md#prepared-application-settings).

### Auth0 registration update ? 20 September 2026

- User explicitly approved application creation. Created **Relay Web**, Regular Web Application, in the user-owned tenant. Dashboard confirmed successful save of exact callback, logout and application-login URLs.
- Verified RS256, OIDC conformity and Client Secret (Post). No secret was revealed or committed; no production login was enabled.
- Default connections: email/password and Google enabled; no passwordless connection configured. Production recovery/delivery and social-provider credentials still require review.
- Web CI for `85e5775` passed: https://github.com/kiwanukaphil-oss/media-sharing-app/actions/runs/35478701420. Separate scheduled backup failure recorded as B02; no claim that backup automation is currently healthy.

### Backup repair and secret handoff ? 20 September 2026

- Received client secret through Git-ignored local file, validated its format without printing it, and prepared disabled local Auth0 configuration. Live tenant discovery issuer verified. This does not yet prove a complete user login.
- Fixed read-only backup SQL expression depth with balanced concatenation. Six snapshot tests and full API/security integration suite passed, including a new actual-D1 snapshot/restore regression check.
- Live database read-only query succeeded; the private SQL snapshot restored with counts and relationships verified. Hosted backup completion was subsequently verified; B02 is closed.

### One-time sign-in foundation ? 20 September 2026

- Added hashed, configuration-bound D1 login transactions and an atomic consume operation, ten-minute Secure/HttpOnly browser cookie, expiry cleanup and backup-restore invalidation.
- Migration 0007 is prepared locally only. Actual D1 tests verify one winner in callback races, replay rejection, browser/config isolation and expiry. No account routes or production sign-in were enabled.
- User has no domain or email provider. B01 now requires user-owned domain/sender setup; recommended Resend integration is documented. Person/session integration and legacy-claim work remain outstanding, independently of sender setup.

- Final checks for the transaction foundation: web lint, TypeScript, production build, Auth0 protocol tests, full API/security integration, actual D1 transaction tests and backup recovery/workflow tests all passed.
- B02 closed: [hosted backup and Backblaze restore verification](https://github.com/kiwanukaphil-oss/media-sharing-app/actions/runs/35491216252) passed on commit `69b6843`.

### Custom domain live ? 20 September 2026

- User purchased `relayalbums.com` through Cloudflare. Connected it to the existing production Worker, retaining the previous URL and existing file permissions.
- Applied and read back exact-origin R2 CORS for both domains. Saved and reloaded Auth0 callback/logout settings for the new domain; login remains disabled.
- Passed HTTPS/API health on both domains and hosted upload/section/Undo/byte-identical download checks at `https://relayalbums.com`.
- Deployment configuration now retains the custom domain. No Worker code release or identity migration was applied.
- B01 is now the free Resend account/sender setup. Signup is open for the user; DNS records and email delivery tests follow account access. Existing external monitors still check the workers.dev origin.

- Resend account subsequently created by user. Prepared `mail.relayalbums.com` (Ireland region), with generated DKIM TXT and two DNS-only CNAME records. No DNS sender records or Resend API credentials have been published/created yet; action-time confirmation requested under browser-control policy.

### Verified email sender ? 20 September 2026

- User approved DNS publication, restricted sending-key creation and Auth0 connection. Published the three provider-generated DNS records; public DNS resolves correctly and Resend now shows Verified. Receiving remains disabled.
- Created **Relay Auth0 account emails**, Sending access restricted to `mail.relayalbums.com`. No secret was printed or written to Git.
- Prepared Auth0 Resend provider with `Relay <accounts@mail.relayalbums.com>`. Key copied in browser; user must paste into the focused API Key field and save under the browser-control credential handoff rule. User subsequently saved the provider; reloaded Auth0 confirms Resend enabled, the intended From address and an enabled test-email action. One user-authorized Auth0 provider test email was subsequently sent and marked Delivered by Resend.
- B01 remains open for actual recovery verification and live integration; provider delivery is verified. No account routes, migrations or Worker code were deployed.

### Account/session integration - 20 September 2026

- User confirmed receipt of the Auth0 provider test email. Sender setup is complete; actual account recovery is a separate remaining verification.
- Added `people` keyed by issuer/subject and hashed, configuration-bound `account_sessions` in additive migration `0008_mean_aqueduct.sql`. Equal emails never merge accounts. Verified email is required; disabled people cannot sign back in. No production migration applied.
- Added disabled-by-default login/callback/session/list/revoke/logout routes. Callback attempts are consumed before provider exchange, credentials rotate on login, sessions expire after seven days, and account mutations enforce exact Origin even with an Authorization header. Login allocates no space, quota or membership.
- Added responsive `/account` with browser-session controls and friendly failed/verification-needed sign-in messages. Legacy connected-library access remains separate and is labelled explicitly. Provider SSO logout, temporary/trusted session choices, membership links and account recovery are still outstanding.
- Restore sanitization revokes every restored account session. Real-D1 tests cover same-email separation, concurrent identity creation, wrong-client denial, expiry, disablement, rotation, cross-account revocation denial, CSRF and callback races/replay.
- Validation passed: web lint, TypeScript, production build, signed-token protocol tests, full API/security/D1 integration, seven backup recovery tests and account browser checks at phone/desktop sizes. Browser signed-in data was mocked; this is not a live Auth0 sign-in test. Screenshots inspected in ignored `.sites-runtime/account-preview`.
- User approved committing and pushing this tested increment. Production activation is not part of this source update. No Worker release, live sign-in activation or identity migration was performed. P2 parent counts remain unchanged.

### Persistent autonomous execution - 20 September 2026

- [x] Save the latest user instruction in root `AGENTS.md` so future sessions inherit autonomous execution through project completion. Routine commit and phase confirmations are superseded.
- [x] Expand Phase 2 into checked completed milestones and unchecked outstanding milestones, retaining honest parent counts and local/live distinctions.
- Continue Phase 2 from the next action above; ask only for blockers requiring user input.

### Membership and explicit owner claims - 20 September 2026

- [x] Add migration `0009_married_silvermane.sql` for memberships, short-lived claim attempts and permanent claim evidence. Existing devices/files/spaces are preserved.
- [x] Implement membership-scoped library listing and claim preview/confirm endpoints. Confirmation is carried in a request header rather than a URL, and Origin checks remain mandatory.
- [x] Recheck current device ownership, account/session validity, recent sign-in, claim expiry and absence of a previous claim within the atomic write. Concurrent accounts cannot claim the same device; revoked membership cannot be silently restored with another legacy device.
- [x] Invalidate pending claim attempts on backup restore. Completed claim evidence is preserved.
- [x] Pass build, lint, TypeScript, full API/security/D1 regression, claim races/revocation tests, eight restore tests and responsive claim UI checks. UI identity responses are mocked; no live provider login is claimed.
- [x] Live provider dependency: user completed database connection sign-up/sign-in and email verification; Auth0 shows VERIFIED. Relay callback and recovery remain separate outstanding checks.
- [ ] Remaining implementation: account membership enforcement across existing file APIs, personal spaces/quotas, switcher, lifecycle and provider recovery/logout verification. Parent Phase 2 items remain unchecked. No production migration or Worker deployment in this increment.

### Live provider verification - 20 September 2026

- [x] Confirm the hosted database connection test reports Successful transaction and the user account exists.
- [x] With explicit user approval, send a verification email; Resend reports Delivered for **Verify your email**, message `01a0bf75-43bc-754c-ba8f-4d0605de55c0`.
- [x] User clicks the email verification link; Auth0 user details confirmed VERIFIED after reload on 20 September 2026.
- [x] Investigate reported spam placement: Gmail original-message summary shows SPF PASS, DKIM PASS for `mail.relayalbums.com`, and DMARC FAIL. Gmail describes similarity to past spam; the exact classification cause is not established.
- [x] Publish the missing `_dmarc.mail.relayalbums.com` TXT record, `v=DMARC1; p=none;`, and confirm Cloudflare saved it and authoritative/Google public DNS resolve it. This initial policy does not enforce rejection or collect reports.
- [x] Confirm DMARC PASS and inbox placement on the fresh, user-authorised recovery message on 21 September; SPF/DKIM also passed. Future reporting/enforcement review remains separate from this completed delivery check.
- [x] Verify real password recovery, Relay callback/session integration, old-session revocation and fresh sign-in on 21 September. Evidence is recorded in the Phase 2 release gates.


### Account-scoped library access - 20 September 2026

- [x] Add additive migration `0010_gifted_pandemic.sql` for `account_space_actors`; preserve existing media/device foreign keys and every existing record. Attribution rows expire at zero, contain a non-credential marker and cannot authenticate or issue invitations.
- [x] Require explicit space context and live account/session/membership checks for account file APIs. Invalid scope and denied account access never fall back to a legacy cookie. Current membership role supplies authority; the attribution record does not.
- [x] Connect Account library links and all library API clients, thumbnails, previews, section covers, original downloads and queued upload/preview publication to immutable scope. Keep legacy clients compatible and account/device controls distinct.
- [x] Pass real-D1/R2 production-route tests for competing actor creation, cross-browser upload resumption, cross-space denial, exact original bytes, owner/member checks, CSRF, revoked membership/session and disabled account denial. Snapshot export/restore includes the new relationships.
- [x] Pass lint, TypeScript, production build, full API/security regression, original-save/preview checks, eight recovery checks and the full browser suite (Chrome/Edge/Firefox/WebKit baseline; dedicated account library checks). Recheck account UI after the final stale-response clearing change. Browser account responses are fixtures; no live provider callback is claimed.
- [x] Inspect desktop/mobile screenshots. No production identity migration or Worker release has been performed.
- [x] Commit and push the tested account-library increment with user approval on 21 September 2026. Production activation remains outstanding.
- [ ] Remaining Phase 2: bounded personal spaces, dedicated switcher and cross-space queue, trusted/temporary sessions, person invitations/device linking, lifecycle, live callback/recovery/logout and production release. Parent counts remain 0/7.


### Personal spaces and library switching - 21 September 2026

- [x] Add migration `0011_brown_ego.sql` for one personal space per person. Existing spaces remain shared. Shared-style memberships, device credentials and pairing links cannot bypass the personal owner boundary.
- [x] Allocate only on explicit creation, with 1 GiB per person and `PERSONAL_STORAGE_BUDGET_BYTES=0` by default. Count promised allocations against the global budget atomically, including concurrent creation. Lowering the budget does not remove existing space access or recorded quotas.
- [x] Enforce the stored quota for original and preview reservations and show it in Storage. Existing shared libraries retain 100 GiB.
- [x] Add Create My space, grouped library switching, personal titles and audience text. Reset filters/selection on switching; restore only manifests associated with the signed-in account's current memberships and show destination return links.
- [x] Verify real-D1 allocation races, retry idempotence, isolation despite erroneous membership, legacy-device/claim/pairing denial, full quota rejection, cancellation and revoked membership denial. Full existing API/security regressions and snapshot restore passed.
- [x] Pass lint, TypeScript, build, full API/security/D1 checks, eight backup-recovery checks and the four-browser regression suite. Account browser fixtures verify personal-creation failure recovery, mobile switching, filter reset, cross-space queue visibility, other-account manifest exclusion and cancellation at the original destination. Screenshots inspected.
- [x] Commit and push this increment under the standing project authority. No production migration, new storage budget or Worker release has been applied.


### Browser session choices and sign-out - 21 September 2026

- [x] Bind the temporary/trusted choice to the one-use login transaction. Default temporary access has an 8-hour server expiry and a session cookie; explicit trusted access has a 7-day expiry and persistent cookie. Callback parameters cannot change the choice.
- [x] Require fresh provider authentication with `prompt=login`, `max_age=0` and signed `auth_time` validation. Revoking Relay access cannot be undone by silent reuse of provider SSO.
- [x] Revoke Relay access before directing current-browser sign-out to the fixed Auth0 OIDC logout endpoint. Store only the signed provider session hint, never provider tokens; remote revocation does not redirect the current browser. Provider consent remains enabled; no federated social-account logout is requested.
- [x] Display session type and expiry, explain restored-browser-session limitations and make the trusted choice explicit. Check mobile/desktop layout and signed-out choice interactions.
- [x] Pass lint, TypeScript, build, signed-token protocol checks, full API/D1 regression, account-space/personal-space checks, eight backup checks and account browser fixtures. Hosted CI also passed earlier commits `55abfd9`, `25ccf71` and `a1c29c1`.
- [x] Subsequently verify the real provider logout, recovery and callback flow on 21 September. Migration 0012 and the later migrations through 0018 are now applied in the restricted production pilot.


### People, invitations and membership lifecycle - 21 September 2026

- [x] Add migration 0013 for email-bound person invitations, membership revisions and durable membership events. Invitation links remain distinct from device-pairing links.
- [x] Require current owner authority to create/revoke links; cap outstanding invitations at 20 per library, limit membership to 100, expire links after 7 days and require the invited verified email. Preview grants no access; acceptance is atomic and one-use.
- [x] Implement people/role controls and explicit ownership handover: promote another member, then demote or leave. Concurrent departures cannot remove the last active account owner. Personal spaces reject all shared membership administration.
- [x] Revoke/demote explicitly claimed legacy devices with membership changes and invalidate their unused pairing invitations. Other legacy devices remain a separate audience, shown in the owner UI; do not infer their human owner from names.
- [x] Suspend restored memberships and expire person invitations, retaining records and earlier revocations. A fresh sign-in alone cannot revive access from an old snapshot; operator reconciliation is required.
- [x] Pass lint, TypeScript, build, schema-generation consistency, full API/security/D1 regression, account-space/personal-space checks and nine backup checks. The full Chrome/Edge/Firefox/WebKit baseline and dedicated account/people browser fixtures passed; phone/desktop screenshots inspected.
- [ ] Verify real-provider and legacy migration/offboarding flows before production release. No production migration or Worker deployment in this increment.


### Verified private-to-shared copies - 21 September 2026

- [x] Add migrations 0014/0015 for durable publication intent and bounded attempt-key history. A confirmed copy reserves quota as an unpublished media row; legacy upload completion cannot mark it ready.
- [x] Stream original bytes directly through R2 with its SHA-256 check; preserve original name, capture date and available previews. Independent keys survive source deletion. Recheck personal ownership, destination membership, source revision and album/section availability before publication.
- [x] Add a visible publish action in the personal-file viewer, destination selectors, audience/metadata explanation and explicit Publish copy. Reload/retry retains the operation and destination; completed history prevents accidental duplicate retries. Another copy requires an explicit new action.
- [x] Pass lint, TypeScript, build, full existing API/security regression, account/personal/people/publication D1/R2 checks, ten backup checks and targeted publication/account-library/people/media browser checks. Phone/desktop publication screenshots inspected. Hosted CI passed the preceding people increment `c8efe69`.
- [ ] Verify live publication and recovery before activation. The initial flow copies one original at a time, up to 1 GiB (the current personal allowance); bulk publication and larger allocations are future enhancements. No production migration or Worker deployment in this increment.

### 21 September 2026 - Password-change session invalidation

- [x] Require a signed password-change claim and authentication time when exchanging Auth0 credentials. Missing/malformed claims fail closed; email never links identities.
- [x] Verify bounded, timestamped HMAC recovery notifications; serialize reset/sign-in races and preserve newer sessions during duplicate or delayed delivery. Record resets received before the first Relay sign-in.
- [x] Prepare scoped Auth0 Post Login and Post Change Password Actions with bounded delivery retries and redacted failure reporting. Add Action tests to hosted CI.
- [x] Pass signed-token protocol/Action tests, real-D1 recovery/race tests, full API/security and account-access regressions, backup checks, lint, TypeScript and production build.
- [ ] Install and configure Actions and the matching Worker secret, verify actual password recovery and delivery-failure monitoring, and activate only after the live release gates pass. Auth0's asynchronous notification is not an instantaneous or guaranteed revocation channel; next sign-in also reconciles the signed password-change timestamp.
- [ ] Reconcile recovery watermarks against current provider state before restored identities regain access. Existing restore handling revokes all sessions/memberships; no automatic access restoration is introduced.

### 21 September 2026 - Legacy access reconciliation

- [x] Let current account owners review the actual paired-device audience from People & access, including owner/member roles and only proven owner-claim identity links. Unlinked device names never assign identity.
- [x] Support explicit individual disconnection and retirement of all paired access, including the last paired owner, while retaining the active account owner, other memberships and files. Invalidate unused links from revoked devices atomically; a concurrent pairing cannot survive full retirement.
- [x] Pass lint, TypeScript, production build, account-access/security/D1 regressions and phone/desktop browser confirmation tests. Inspect the updated phone screenshot.
- [ ] Review live devices with their owners before retirement. No production device was revoked. Native clients retain compatibility until an owner explicitly retires their paired access; native account sign-in is outside web scope.

### 21 September 2026 - Account deletion review and retention

- [x] Add an explicit account-deletion review with shared-owner handover links, fresh-authentication protection, pending status and withdrawal. Submitting a request changes neither access nor files.
- [x] Document present retention honestly: Trash has no automatic expiry; B2 retains versions without pruning; no instant or 30-day erasure promise. Add a private read-only operator queue query and concrete execution/verification runbook.
- [x] Hold restored pending requests for renewed review, preserving withdrawals. Pass real-D1 ownership/recency/race/isolation/CSRF tests, account browser tests, 11 backup checks, lint, TypeScript and production build. Inspect the phone deletion-status screenshot.
- [ ] Before release, establish request monitoring and rehearse authorised live/provider/backup erasure and restore reconciliation. No deletion executor or automatic purge is exposed. P2-06 remains incomplete.

### 21 September 2026 - Release preparation and provider handoff

- [x] Rehearse migrations 0007-0018 on a populated Phase 1 fixture and verify all legacy access, original metadata/keys, Trash, multipart uploads, albums, sections/covers and revisions remain unchanged. No identities or memberships are inferred.
- [x] Add validated public identity deployment settings, explicitly disabled with a zero personal-space budget. Keep secrets out of this configuration and preserve the fixed production origin.
- [x] Add migration/configuration checks to hosted CI and consolidate remaining release gates in [Phase 2 release gates](PHASE-2-RELEASE-GATES.md).
- [x] Restore Auth0 dashboard access on 21 September. Provider preparation is recorded below; recovery-email authorisation remains unanswered.

### 21 September 2026 - Auth0 provider preparation

- [x] Verify restored dashboard access and review the tenant application inventory (Relay Web and Default App).
- [x] Review free-plan baseline and retain email/password for initial launch. Disable Google for Relay Web because the connection uses development keys; no paid upgrade selected.
- [x] Create and deploy Relay password-change claim with the Relay client scope. Pass the hosted test with the expected claim and reset timestamp.
- [x] Prepare Relay recovery notification with the exact issuer/origin and verify saved code against the tested repository source. Generate the recovery secret in an ignored file without exposing it.
- [x] User connected and applied the deployed login Action; verified its presence in the flow and All changes are live on 21 September.
- [x] User saved the recovery secret; verified the setting name and saved draft without reading the value. Matching Worker receiver and monitoring remain outstanding.
- [x] Subsequently complete the authorised real recovery-email, callback and logout tests on 21 September. The restricted pilot is deployed; this earlier preparation increment itself sent no email or deployment.
- [x] Hosted CI passed source commits 89e78a4, 76e9232, 89db785, 7871635 and 22f024e. Phase 2 parent counts remain unchanged.

### 21 September 2026 - Restricted identity pilot preparation

- [x] Add explicit pilot/open rollout configuration. Pilot requires a private, bounded provider-subject list; missing/invalid settings fail closed. No identity list enters public configuration.
- [x] Enforce pilot audience after signed-token verification and before account/session writes. Bind sessions and pending callbacks to the current audience; matching email never grants pilot access.
- [x] Pass protocol/configuration tests, real-D1 session/transaction checks, full API/security and account-access regressions, lint, TypeScript, build and deployment dry run.
- [x] Rehearse all pending migrations against a fresh private production export; existing legacy access, media and organisation rows remain unchanged, integrity checks pass and new identity tables are empty.
- [x] Obtain approval for one recovery-test email to the designated account. Send only when the receiver and live sessions are ready.
- [x] Independently restore the fresh backup, verify all 20 originals, apply migrations 0007-0018, and compare all legacy rows after migration. Deploy disabled first; pass hosted library regression and public health checks, then activate only the designated-account pilot.
- [x] Install private Worker identity/recovery/pilot bindings; confirm signed synthetic recovery succeeds and unsigned events fail. Verify Auth0 hosted notification succeeds with matching secrets.
- [x] Verify real pilot callback and an eight-hour temporary session on 21 September at 09:37 Nairobi; no library membership inferred. Verify the recovery Action is connected and All changes are live.
- [x] Send the single authorised recovery email through Universal Login; Resend confirms Delivered, message 01a0c2b0-56c2-723b-aeff-b671fdde0bf5. Hosted CI passed f0c19a8.
- [x] User changed the password; verify the pre-reset browser is signed out before fresh login. D1 confirms the sole old session revoked 416 ms after the provider reset timestamp.
- [x] Verify the received recovery message has the Gmail Inbox label and SPF/DKIM/DMARC PASS.
- [x] Verify fresh sign-in with the changed password and provider logout: D1 revocation, return to registered home, and Auth0 Success Logout at 06:54:00.602 UTC.
- [x] User approved trusted-browser persistence and signed in; UI expiry is 28 September and D1 confirms trusted mode with exactly seven days.
- [x] Connect the existing library through its current owner browser. User approved primary-origin pairing, promotion and account ownership; completed and verified Owner / Account access plus the three-device audience. General activation and personal allocation remain closed pending release gates.
- [x] Add a direct Account & libraries entry to the signed-out welcome page and correct outdated account-free wording. Build/static checks, deployment dry run, live health and desktop visual/navigation checks pass; released as f8ba096e-cb97-41b0-bf67-cc7bcecfee4d.

## 21 September 2026 - Approved owner migration verified

- [x] User explicitly approved pairing the primary-domain browser, promoting that device and connecting Our shared space to the designated account. Completed via existing owner controls and the recent-authentication claim preview/confirmation.
- [x] Account shows Owner; account-scoped library shows Owner / Account access, two live files, one Trash item, Random Stuff with two items, and unchanged 130.7 MB storage.
- [x] People & access shows one account owner and three paired devices: original desktop owner and phone member remain unlinked; only My desktop · relayalbums.com has the verified account claim. No devices retired or files changed.
- [ ] Complete operational monitoring, lifecycle execution/rehearsal, bounded personal allocation and hosted publication gates before general release.

## 21 September 2026 - Operational monitoring increment

- [x] Implement private, aggregate-only identity operations checks using the existing D1 read-only credential. Real-schema tests cover pending/withdrawn/restored requests, unknown states, recovery watermark mismatch, disabled people and expired/revoked session boundaries.
- [x] Expand scheduled public health probes to both relayalbums.com and the legacy origin. Primary-domain live probe passed.
- [x] Verify hosted identity operations ([run 35576462943](https://github.com/kiwanukaphil-oss/media-sharing-app/actions/runs/35576462943)) and both-origin health ([run 35576467793](https://github.com/kiwanukaphil-oss/media-sharing-app/actions/runs/35576467793)). End-to-end alerts and missed-run detection remain outstanding.

- [x] Prepare and locally test dedicated read-only Auth0 failure and password-reset reconciliation monitoring. [Runbook and exact access proposal](RECOVERY-MONITORING.md) record the scopes, data minimisation, cost basis and response procedure. Manual workflow is prepared but not activated.
- [x] Subsequently authorise the dedicated Relay Recovery Monitor client with exactly read:logs/read:users, securely install its credential and pass hosted verification on 21 September. External test-alert receipt remains separately unchecked below.

## 21 September 2026 - Provider monitoring activation

- [x] User authorised dedicated provider access; exact read:logs/read:users grant and main-only encrypted GitHub credential storage verified. Extra read:logs_users selection removed.
- [x] Hosted Web checks passed source 256a614 (run 35576738489).
- [x] Resolve the first hosted provider request rejection (run 35579243839); safe stage/status diagnostics isolated profile field selection. Corrected hosted run 35579499914 passed.

- [x] Hosted provider reconciliation passed (run 35579499914); Auth0 profile inclusion rejected the reset field, so supported exclusions now minimise the response.
- [x] Implement signed aggregate health reporting with fail-closed 90-minute freshness and real R2 race/replay tests. The independent backup heartbeat remains separate. The earlier billable-label interpretation was incorrect: the published Free allowance covers the additional monitor.
- [x] Deploy and verify signed health reporting on Worker 75e9e54e-c94b-47e4-91d7-3d3d0608855e at 100%. Combined run 35580179355 passed; live signed failure produced HTTP 503, and real rerun 35580503181 restored HTTP 200. Unsigned writes return 403.
- [x] Create external monitor 4956708 on the existing Better Stack Free plan; verify Up, exact HTTP 200, three-minute checks/confirmation/recovery, TLS verification and email-only alerts. No paid upgrade.
- [x] Send the user-authorised monitor test alert; Better Stack confirms sent.
- [x] Configure twice-hourly combined checks at minutes 13 and 43 UTC, after hosted receiver/failure/recovery and external Up verification.
- [ ] Confirm the already-sent test-email inbox receipt.
- [x] Observe independent scheduled combined runs at 15:19 and 15:49 UTC on 21 September, with signed health delivery and healthy public readback.
- [x] Rehearse operator repair in isolated actual-schema D1 with designated synthetic identities and provider fixtures; detection, signed repair, independent readback, session isolation and unchanged library fingerprints passed. This is not a production-account repair.

## 21 September 2026 - Bounded personal-space pilot

- [x] Choose 1 GiB total personal allocation for the designated-account pilot, matching the existing 1 GiB per-person allowance. Concurrent allocation remains capped server-side. No expansion of the private pilot subject list or existing shared quotas.
- [x] Record the cost basis: the latest independent inventory protects 304,872,656 original bytes. A 1 GiB personal allocation is deliberately below the [R2 Standard included 10 GB-month allowance](https://developers.cloudflare.com/r2/pricing/), leaving headroom for derived objects and existing shared use. This is an allocation ceiling, not a global cloud-billing cap: retained B2 versions, shared uploads, snapshots and requests remain separate. No paid plan or subscription change.
- [x] Deploy the bounded setting as f096dd18-8262-46b8-af0c-fa7e23a87da3 at 100%; public health passed. Create My space through the real signed-in account and verify Personal / Only you, upload destination, separate shared counts and grouped switching.
- [x] Publish the synthetic 1,127-byte PNG only after the live dialog explains the shared audience and independent-copy semantics. Copy published successfully; original-byte backup verification follows.
- [x] Independently restore snapshot 2026-09-21T09-04-10-836Z-76478b50-0d2d-4ba9-97a3-73fea8e7536b: 23 originals / 304,899,366 bytes, every hash and database relationship verified. Personal test source and shared copy have distinct object keys/spaces and matching expected SHA-256. All 20 baseline original rows remain unchanged.
- [x] Fix misleading initial account-library labels and publication progress: opening a personal library no longer briefly says Shared library / Not paired; active publication/cancellation has accurate progress wording. Lint, types, build, deployment and live opening-state readback passed (fe4fa894-f45e-4c7d-93a6-4ced1a355774 at 100%).
- [x] Pass separate cloud D1/R2 rehearsal of normal copy, interruption/retry, destination revocation before visibility and cancellation; all four generated sources survive, two intended copies remain, no unfinished operations. Rehearsal endpoint disarmed after verification.

## 21 September 2026 - Account-erasure review inventory

- [x] Add a read-only private erasure planner for a local database snapshot and an existing request. Exact personal ownership determines scope; shared attribution never makes shared files deletion candidates.
- [x] Verify actual-schema cases: personal Trash and unfinished uploads included, shared copies retained, other people's personal files excluded, B2 duplicate-content dependencies identified, last-owner and withdrawn/restored intent blocked. Planning makes no database changes and always remains non-executable.
- [ ] Complete provider/live-object/all-backup-version inventory, write freeze, minimisation and restore-ledger execution/rehearsal. Concrete irreversible-operation authority remains required; no real account deletion was requested or performed.

## 21 September 2026 - Isolated hosted publication rehearsal

- [x] Prepare a separately authenticated, expiring test Worker with dedicated D1/R2 resources and generated fixtures. Initialisation refuses any populated app database/bucket; no production credentials or provider calls.
- [x] Seed and independently inventory four synthetic cases, then run the unchanged production copy/session/membership modules against actual cloud D1/R2: normal copy; post-write interruption and retry; destination revocation during the write; cancellation during the write.
- [x] Verify four sources survive and two independent copies have matching hashes. Final D1 state: six ready originals, two ready publications, two cancelled publications and zero unfinished publications. Temporary copy attempts are cleaned by the tested workflow; generated source originals remain retained.
- [x] Disarm/expire the dedicated test endpoint after verification. Separate resource IDs, versions and reproducible checks are in [the rehearsal record](HOSTED-PUBLICATION-REHEARSAL.md). Resources are flagged for later retirement, not purged.

P2-02, P2-03, P2-04 and P2-05 are now checked as implemented, released and verified within the restricted pilot. Operational/lifecycle general-release gates remain explicit; this does not open sign-up or change the pilot audience.

## 21 September 2026 - Complete backup-version catalog

- [x] Add read-only pagination across all B2 file versions and unfinished uploads using the existing least-privilege reader; reject incomplete/ambiguous responses and keep identifiers private.
- [x] Verify old/hidden versions, both pagination formats, duplicate/out-of-scope records, unknown actions, missing cursors and service failures; add regression coverage to CI.
- [x] Run against the live backup prefix: 43 versions, zero unfinished uploads, private report saved. No objects or credentials changed.
- [ ] Reconcile historical snapshot identity references, live R2/multipart state, write freeze, minimisation and independent erasure-ledger evidence. A complete catalog is not an atomic inventory or deletion authority; P2-06 remains unchecked.

## 21 September 2026 - Isolated erased-snapshot minimisation

- [x] Implement and test an in-memory snapshot transformation bound to the historical provider identity; future tables/columns require explicit review.
- [x] Remove synthetic private-library records and identifying account fields while retaining independent shared originals, other personal libraries and valid tombstone references. Verify replay stability and disabled restored access.
- [x] Pass all 11 existing backup recovery tests plus the new actual-schema minimisation suite. No production snapshot, original, account or backup version changed.
- [ ] Authenticate the external erasure ledger and complete live/provider/object/all-version execution and end-to-end restore verification. Rehearsal output remains quarantined and does not claim cloud erasure.

## 21 September 2026 - Isolated erasure access safeguards

- [x] Verify Backblaze sign-in and stage the approved prefix-limited key. Inspect issued permissions and revoke it unused when the dashboard includes bucket-setting writes. No secret stored and no backup data changed.
- [x] Create separate empty, private, encrypted test bucket; stage a one-hour replacement key restricted to that bucket and test prefix. Revised scope awaits browser-required approval.
- [x] Add guards/tests that reject the production bucket, wider prefixes, unexpected permissions, mismatched/unknown versions and missing shared-copy/snapshot preservation controls. Prepare same-origin, one-use, encrypted local credential handoff.
- [x] Hosted Web checks passed the previous minimisation and documentation increments (35584536808 and 35584707696).
- [x] Complete the generated cloud erasure/restore rehearsal after the narrowly scoped access handoff: run `cde4ced5-c85f-43fd-945c-14cb84373485` at 11:52 UTC on 21 September. Only generated rehearsal versions were removed; the temporary key was revoked. Full provider/ledger lifecycle acceptance remains open.

## 21 September 2026 - Generated cloud erasure and restore verified

- [x] Independently verify the approved isolated-bucket credential and save it encrypted locally. Revoke a browser-exposed initial value unused; use an equivalent shorter-lived replacement.
- [x] Upload five generated versions, match every pinned ID/name/hash, verify preservation controls, remove three obsolete versions and independently restore the two remaining shared/snapshot controls. No production data changed.
- [x] Verify restored shared-copy bytes, minimised identity, revoked access and valid relationships. Revoke the temporary key; retain generated control evidence. [Cloud record](ERASURE-REHEARSAL-ACCESS.md).
- [ ] Complete authenticated external erasure ledger, provider/live-object execution and full lifecycle acceptance.
- [x] Detect stale unattended-monitor evidence: the active GitHub schedule had not dispatched a recovery run since 09:05 UTC; public health correctly returned 503. Real manual combined run 35596479265 passed and restored 200.
- [x] Establish an independent unattended schedule and observe two actual cron successes with signed delivery, rather than relying on manual runs. Continued CPU capacity and external-alert receipt remain open in B04.

## 21 September 2026 - Independent scheduled monitor prepared

- [x] Share the existing provider, identity and signed-report logic between GitHub and a dedicated Cloudflare scheduled Worker; retain fixed read-only database access and no public trigger.
- [x] Pass existing provider/identity/R2 regressions and actual Workers scheduled success/failure tests; bound response sizes, read duration and pilot capacity. Correct runtime redirect handling without allowing redirects.
- [x] Pass lint and TypeScript; deploy the independent Worker disabled, without credentials or cron triggers. [Activation record](SCHEDULED-IDENTITY-MONITOR.md).
- [x] Obtain the required approval, install the four existing credentials encrypted and activate the twice-hourly cron. Version `7c5a2bcd-ae1a-47b8-bd0c-8f0cb859a7e2` verified at 100%; no additional provider permissions.
- [x] Verify the first real cron invocation at 15:19 UTC: success, no exceptions, signed R2 report readback and HTTP 200 health. Hosted timing: 3,225 ms wall / 10 ms CPU.
- [ ] Resolve Free-plan CPU headroom, continued coverage and pending external-alert receipt. Current Workers Free confirmed in dashboard; earlier $5 subscription note requires clarification before any billing change.
- [x] Remove unnecessary Node compatibility from the dedicated monitor using bounded native decoding and Web Crypto. Regressions, real Workers runtime, TypeScript and lint pass; deployed version `49576315-efae-4b4d-b815-29532e4aac8d`. Reported startup fell 8 ms to 3 ms; actual scheduled invocation CPU remains to be measured.

## 21 September 2026 - Authenticated restore decision boundary

- [x] Implement Ed25519 ledger verification with independently pinned current revision/digest, bounded freshness, strict schema and duplicate-identity rejection. No production signing key was generated.
- [x] Test tampering, wrong keys, rollback, same-revision forks, stale/future heads and expired manifests. Pending, withdrawn and review-required decisions cannot authorise minimisation.
- [x] Integrate verified decisions with the actual-schema isolated snapshot transformation; preserve shared originals and keep cutover disabled. [Contract and remaining gates](ERASURE-LEDGER.md).
- [ ] Provision the independent ledger authority/head reader and connect real decision transitions, evidence verification and complete historical reconciliation. Local signature tests do not prove cloud erasure or production recoverability; P2-06 stays open.

## 21 September 2026 - Historical backup SQL inventory

- [x] Add a read-only, exact-version SQL inventory with digest checks and independent before/after catalogs. Tests cover superseded versions, older schemas, shared/private same-byte references, malformed versions and incomplete catalogs.
- [x] Inspect all eight retained SQL upload versions in B2; seven need historical-schema minimisation review. Save private identity/content dependencies in ignored operations storage; no names, credentials or object keys printed. Both catalog reads matched.
- [x] Reconcile all eight retained manifest versions with exact SQL and original catalog versions, table counts and file metadata; zero unreferenced SQL versions. Tests reject mismatched, missing and duplicate references. This is metadata verification, not another original-byte restoration.
- [ ] Reconcile older schema minimisation, live R2/multipart state and current ledger evidence under a write freeze. Pre-identity snapshots need authenticated legacy-device mappings; a current provider digest alone is insufficient. Catalog stability is not atomicity or deletion authority.
- [x] Recheck full local browser suite after a hosted intermittent Firefox reload timeout; Chrome, Edge, Firefox, WebKit and all account/library/publication fixtures pass. The subsequent hosted run `35616790390` also passed. No speculative product change or relaxed assertion was made; recurrence requires further diagnostics.

## 21 September 2026 - Live R2 and database reconciliation

- [x] Add read-only fixed-bucket S3 object/multipart inventory using existing encrypted credentials, bounded secure XML parsing and complete pagination. No new access grant or dependency package.
- [x] Test encoded keys, duplicate/missing records, continuation loops, entity rejection, GET-only signing and exact scope. Test actual-schema reconciliation of originals, previews, Trash, shared copies, publication attempts and unfinished transfers.
- [x] Run against production read-only: **31 objects, zero unfinished uploads, zero review anomalies**. Before/after database and object fingerprints agree; private details remain in ignored storage.
- [ ] Verify an authorised write freeze, in-flight capability expiry/reconciliation, historical-schema treatment, independently recoverable ledger and full erasure execution. Read consistency is not an atomic inventory, byte-integrity proof or deletion authority.

## 21 September 2026 - Pre-account backup treatment

- [x] Identify the seven older SQL snapshots as actual migration shapes 0002 and 0006, both predating person/private-space tables.
- [x] Add digest-bound, authenticated legacy-device evidence and isolated transformations for these exact schemas. Synthetic tests preserve shared originals/other profiles, quarantine restored access, reject wrong-space/altered/withdrawn evidence and expose missing bindings.
- [ ] Produce verified real association evidence through the independent ledger/executor. No real fulfilment decision or production snapshot transformation was made; shared metadata is retained under the explicit content policy.

## 21 September 2026 - Recorded historical claim evidence

- [x] Add and test unsigned association evidence preparation from an independently digest-pinned source snapshot. Check exact provider identity, recorded claim/session/membership relationships, space agreement and chronology; never infer ownership from matching labels.
- [x] Prepare private evidence from the verified production backup for one person and one recorded legacy claim. No account, original or backup changed; no fulfilment decision was signed.
- [ ] Independently establish historical completeness and retain provenance through the deployed ledger workflow. Local preparation explicitly reports incomplete verification and cannot authorise erasure or restore cutover. See [erasure ledger](ERASURE-LEDGER.md).

## 21 September 2026 - Transfer commit revocation safeguards

- [x] Recheck current account/session/recovery/membership or legacy-device authority atomically when reserving uploads and publishing completed originals/previews. Reject cached request authority after revocation; clean up rejected new allocations and previews.
- [x] Verify real D1 revocation, expiry, cross-person/space denial, personal ownership and recovery-watermark cases. Production-module API suites pass, including existing multipart, quota, publication and library workflows.
- [x] Finish full local browser checks and hosted CI `35621810303`; deploy Worker `59b996f4-aea4-4ece-a808-3798a2d783b3` at 100%. Hosted private-access boundaries, direct multipart/CORS, cross-session visibility, exact-byte download and receiver revocation passed in the isolated verification library. This is a prerequisite for lifecycle freezing; issued capabilities and other writers still need coordinated fencing. P2-06 remains unchecked.
- [x] Add failure artifacts for an intermittent hosted WebKit offline-test error seen in run `35620693844`; keep the strict no-page-error assertion. No speculative frontend change or relaxed assertion is included.

## 21 September 2026 - Scheduled monitor optimisation verified

- [x] Observe the actual 15:49 UTC cron on optimised version `49576315-efae-4b4d-b815-29532e4aac8d`: success, no exceptions, 8 ms CPU / 2,776 ms wall time. Independently verify delivered R2 status and public health HTTP 200.
- [ ] Collect continued coverage and expansion capacity evidence; confirm alert receipt. The limited improved samples do not establish broad Free-plan capacity. No plan upgrade or purchase was made.
- [x] Observe another successful cron at 16:19 UTC on the same optimised version: 5 ms CPU / 3,113 ms wall time, independently delivered signed success and public health 200. Optimised samples are now 8 ms and 5 ms; broader capacity remains unclaimed.
- [x] Document the [closure execution contract](ACCOUNT-CLOSURE-EXECUTION.md), including pending-request withdrawal, explicit irreversible-operation authority, durable writer fencing and backup coordination. Implementation and generated-identity end-to-end acceptance remain open.

## 21 September 2026 - Page lifecycle polling repair

- [x] Hosted failure artifacts identify WebKit fetches from a page being unloaded, from the library's background poll. Pause polling and abort its requests on pagehide, resume once on back/forward-cache return, and skip hidden/offline pages and overlapping refreshes.
- [x] Test navigation cancellation, queued stale callbacks, bfcache resume, hidden/offline behaviour and genuine failure reporting. Keep strict browser error assertions.
- [x] Complete full local browser and hosted CI verification, then deploy with the transfer-commit safeguards in Worker `59b996f4-aea4-4ece-a808-3798a2d783b3`. General-release and full account-closure gates remain unchanged.

## 21 September 2026 - Durable decision journal prototype

- [x] Implement an independent local journal with signed predecessor links, immutable public root, atomic history/head advancement and stale-writer rejection. No application migration or production signing key is introduced.
- [x] Exercise real SQLite writer contention and interrupted-write rollback; preserve withdrawn/replaced requests and terminal fulfilled decisions. Keep expired historical audit separate from current restore authority, then pass existing erasure/legacy regression checks.
- [ ] Provision independent recoverable custody, production head retrieval and actual transition/executor integration. Synthetic signed fixtures do not establish real erasure or clear P2-06. See [ledger contract](ERASURE-LEDGER.md).

## 21 September 2026 - Signing-key recovery handoff prepared

- [x] Implement and test a password-encrypted portable signing vault plus Windows-protected local custody, using standard crypto primitives and strict format/root checks.
- [x] Test and open the single-use local recovery form; existing scoped Backblaze writer/reader access passes. The owner must save and enter their own unique recovery password; it must not enter chat or logs.
- [x] Complete the owner handoff and verify the actual pinned cloud vault download/decryption, establishing recoverable custody. No real signing decision or account erasure is performed by this setup. Production ledger/executor integration remains outstanding.

## 21 September 2026 - Independent ledger archive reader

- [x] Implement immutable signed-revision export and complete all-version archive audit, with replay-resistant head selection and fail-closed conflict/missing-history checks.
- [x] Add a read-only B2 adapter that repeats the ledger catalog and enforces current manifest expiry before returning a checked head. Test genuine signed conflicts, stale uploads, wrong roots, tampered bytes and changing catalogs.
- [x] Publish initial empty production archive revision 1 and independently verify it using the read-only B2 adapter. One immutable revision/version verified; no fulfilment record or restore clearance.
- [ ] Connect actual request/executor transitions and coordinated writers; initial empty archive verification does not complete lifecycle execution.
- [x] Prepare and test empty-only archive bootstrap: verified protected/public key agreement, idempotent setup, retained freshness renewal and refusal to act on populated journals. Actual empty publication subsequently passed after owner custody; this tool cannot sign a real person's deletion decision.
- [x] Hosted verification for source `30c9edc` passed: [Web checks 35624742424](https://github.com/kiwanukaphil-oss/media-sharing-app/actions/runs/35624742424), including custody/archive/bootstrap checks, API and account-access integration, and the complete browser suite. This verified the prepared implementation; owner custody and initial empty publication subsequently passed as recorded below.

- [x] Recovery custody usability: accept password-manager-generated passwords from 15 characters in the form and encryption validation. Verified exact 15-character encryption/recovery and form submission, rejection below 15, wrong-password/tampering protection and single-use admission. Owner submission subsequently passed; encryption parameters are unchanged.

- [x] Correct recovery form refusal: use same-origin referrer policy so native form POSTs preserve the Origin required by the unchanged exact-origin check. Null and foreign origins still fail. Handoff unit tests and an actual Chrome native form submission with synthetic data and a no-op provisioner passed; no real key was created by that test. Owner form reopened and actual custody subsequently passed.

- [x] Owner custody completed and real empty archive bootstrap/readback passed. Fixed the bootstrap CLI storage transport import during preflight; the CLI and separate read-only command both verified revision 1. Private-key material, encrypted vault and archive evidence remain outside Git.

- [x] Pin the non-secret public verification root independently in the repository and read the real cloud archive using that root, without the application database, local journal or signing key. Revision 1 verified; populated-decision loss/recovery and executor integration remain outstanding.

- [x] Lifecycle request authority hardening implemented and locally verified: preview, request and withdrawal reject a cached session authenticated before the current credential-change watermark. Withdrawal timestamps advance even within one millisecond, preserving strict decision ordering. Actual D1 account-access integration, lint, TypeScript, production build and deployment dry run pass. Deployed Worker `2241047a-0bd9-441f-b0fd-bf301c4004f5` at 100%; both origins return health/operations 200, primary anonymous account access is 401 and legacy-origin account access remains 403. Hosted [Web checks 35652294580](https://github.com/kiwanukaphil-oss/media-sharing-app/actions/runs/35652294580) passed both verification and browser jobs.

## 22 September 2026 - Independent journal recovery

- [x] Implement a read-only archive-to-new-journal recovery command using the independently pinned public root. It refuses existing or changed destinations, audits all signed versions before importing and preserves complete authenticated history.
- [x] Prove synthetic pending/withdrawn history survives loss of the source journal and application database, including expired manifests, replay uploads, missing revisions and signed forks. Recovery never grants currentness or activates a writer.
- [x] Run the real read-only recovery command against the existing cloud archive: one revision restored, zero person decisions. Existing operational journal, signing key and application database were not opened or changed.
- [ ] Connect real intent transitions, coordinate writers and rehearse the complete executor. The recovered history remains a quarantined review artifact.

## 22 September 2026 - Recorded-intent producer

- [x] Implement and test a restricted local signer for pending, review-required and withdrawn intent. Reconstruct missed pending/withdrawal pairs from retained timestamps, preserve earlier request IDs and reject missing rows, provider changes, rollback, overlapping requests and fulfilled-state input. Interrupted batches resume from their authenticated prefix.
- [x] Implement a bounded, complete atomic D1 intent projection and read-only live review adapter. Repeated reads reject observed changes; freshness expires after 30 seconds. Live verification found zero requests and proposed only an empty-head freshness renewal; no signing or mutation was performed.
- [x] Test exact intent transitions, signer/root mismatch, chronology, complete-source checks, renewal preserving record times, preparation expiry and unchanged journal during review. Add the suite to hosted CI.
- [x] Connect single-operator archive publishing and independent current-head readback; verify real empty revision 2 against live D1 intent. Fulfilment and cloud erasure remain disabled.
- [ ] Add lifecycle/backup-writer fencing and verified execution evidence before any fulfilled decision.

## 22 September 2026 - Live intent/archive synchronization

- [x] Connect the existing protected signer to read-only live D1 intent and existing B2 reader/upload-only roles. All local publishing entry points share an exclusive lock; stale locks require inspection and are never stolen by age. Only the existing operator host is authorised to sign.
- [x] Verify remote history before and after local recording, upload only missing immutable entries, independently check the exact current head and re-read live intent. Changed intent or expiry cannot report synchronization success. Interrupted signed/uploaded prefixes remain available for reviewed retry.
- [x] Run the real synchronized path: zero requests, renewed empty revision 2, both retained archive versions independently verified. No application mutation, new credential, account erasure or live Worker deployment.
- [x] Test withdrawal during publication, interrupted upload and retry, remote-ahead/history conflicts, idempotence and lock contention; hosted CI now includes the publication suite.
- [ ] Coordinate application and backup writers for closure and complete a generated-identity end-to-end erasure rehearsal with concrete irreversible-operation authority.

## 22 September 2026 - Closure fence protocol

- [x] Implement isolated D1 primitives for tracked account/linked-device/global-backup admission, closure-generation commit checks, atomic reviewed-intent fencing and scoped credential revocation. Current request revision, provider binding and last-owner handover are rechecked in the fence transaction.
- [x] Verify actual D1 batch rollback on injected interruption, exact retry, denied post-fence commits, unrelated member/device preservation, registered-work drain and persistent uncertainty. A drained registered set still reports executable false. TypeScript and focused lint pass.
- [x] Track exact storage effects before dispatch and prevent admission settlement while effects are unresolved. Local R2/D1 tests cover a deliberately stalled late write, denied new dispatch, multipart allocation/abort, lost storage response and failed database acknowledgement. Existing prototype commit `86fe584` passed hosted CI `35660998430`; these additional tests remain isolated, not deployed.
- [ ] Integrate every application/storage/backup writer and review the schema for migration/restore compatibility before activation. `deploy/closure-fence-prototype.sql` is intentionally outside the migration journal; no production fence or schema change occurred.

## 22 September 2026 - Provider removal rehearsal preparation

- [x] Prepare the [exact generated-account proposal](PROVIDER-ERASURE-REHEARSAL.md) and locally test the provider adapter. It rejects real, pre-existing, linked, activated or changed identities, requires durable intent and independently checks absence; ambiguous responses never retry deletion automatically.
- [x] Obtain specific approval for the separate `create:users`/`delete:users` grant and permanent removal of the named generated fixture. The tenant-wide grant and token lifetime limits were explicitly approved.
- [x] Complete the live provider component rehearsal and remove its temporary grant/connection access. Creation, exact-profile checks, removal and independent absence passed at 06:08 UTC; writer expiry is 23 September approximately 06:08 UTC. Full lifecycle execution and P2-06 remain open.

## 22 September 2026 - Backup writer coordination preparation

- [x] Implement the dedicated bounded HMAC admission/settlement adapter and wrap snapshot creation with an inactive-by-default client. Preserve existing D1 read-only access and backup/restore credential separation.
- [x] Verify isolated D1 transaction rollback, duplicate/snapshot collision handling, fence ordering, storage-effect settlement guards, final receipt binding and irreversible uncertainty. Client tests prove admission precedes export/copy and acknowledgement follows awaited effects. Existing backup recovery and workflow separation tests pass; TypeScript and focused lint pass.
- [ ] Review new-table restore quarantine, expose/deploy the coordinator with a separate secret, activate hosted writer configuration, and verify an actual coordinated backup before any production fence. Existing scheduled backup remains on its current path until that coordinated release.
- [x] Add actual-schema restore quarantine for the complete closure/backup protocol family: preserve disabled fences for review, retain completed evidence and hold interrupted operations as uncertain. Partial schemas fail and roll back. All 13 backup-recovery tests and focused lint pass.
- [ ] Review personal-data minimisation for new protocol references before migrating production; the current transformer deliberately remains restricted to schema 0018. The provider component rehearsal is complete; whole-lifecycle execution remains outstanding.

## 22 September 2026 - Metadata authority race correction

- [x] Recheck live account/session/membership, recovery watermark and current owner role inside album, section, rename, organisation and capture-date mutations. Direct archive/restore and upload-restart commits also recheck authority. Personal-space allocation and existing-space retries now reject authentication predating password recovery.
- [x] Exercise real library route helpers against isolated D1 with a previously authenticated principal: disabled account, revoked session and downgraded owner attempts leave metadata unchanged, while current-owner workflows succeed. TypeScript, lint and build pass; full local legacy API regression passes.
- [x] Complete account-access and hosted checks (`35662558689`), deploy source `df7f4b3` as Worker `2b08bccf-a9ce-4962-8942-7c698d99c613`, and confirm 100% deployment. Both origins pass health/operational-health and deny anonymous feeds. Primary-origin hosted sections passed create/upload/move/Undo/remove/restore/deep-link/exact-byte download in the isolated verification library; the tiny generated original remains for review. No new schema or closure executor activation.
- [x] Refresh independent backup and restore: `35663011013` passed inventory/copy/independent verification for snapshot `2026-09-21T22-31-05-943Z-8d72d96c-46cb-402f-a6f5-57c8e8bad75b`, protecting 25 originals and 321,680,743 bytes. One original uploaded, 24 reused, all independently restored with access revocation verified.
- [ ] Finish remaining compatibility-actor, claim and people-management writer coverage recorded in the closure contract. Provider removal approval remains pending.
