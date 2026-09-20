# Relay development roadmap

**Last updated:** 20 September 2026
**Scope:** Web app and supporting backend; preserve compatibility with existing clients. Native UI development is outside scope.
**Product reference:** [Product direction, organisation and privacy](PRODUCT-DIRECTION-AND-PRIVACY.md)
**Purpose:** Living development guide and source of truth for progress, outstanding work, decisions and release evidence.

## Current position

Autonomous development is authorised, including incremental commits and pushes. Phases 0 and 1 are complete. Custom album sections are live. Phase 2 has tested Auth0 protocol and one-time D1 transaction adapters; the Relay Web application is created and its exact redirect URLs are saved; secure local credential handoff is complete; live integration and recovery-policy verification remain outstanding. Existing functionality is recorded separately below; its presence does not mean the proposed identity, privacy or collaboration model is already implemented.

**At a glance:** 2 phases complete; 11/47 parent work items complete; 1 external recovery-email setup dependency; backup automation restored and verified. Auth0 adapter commit `85e5775` passed web CI. Live Worker: `76609db5-810c-4c08-8968-6c8b4dcd97d7` at 100%.

**Next action:** Complete **B01**: verify production recovery-email settings and integrate server sessions; the client secret is now stored in ignored local configuration. Auth0 dashboard access and application registration are resolved. **B02** is resolved: hosted backup and restore verification passed. [Phase 2 setup and design](IDENTITY-AND-SPACES-IMPLEMENTATION.md) explains the concrete dependency. No credentials should be sent through chat. Resume P2-01 when resolved.

**Execution authority (19 September 2026):** The user instructed autonomous work, commits and pushes, stopping only for a blocker requiring their input. This supersedes the earlier per-phase confirmation and no-auto-commit preferences for this roadmap. Continue through resolved phases without repeated permission requests. Record assumptions and evidence; ask only when a material decision cannot be safely resolved. No provider purchase or irreversible data deletion is inferred from this authority.

| Phase | Outcome | Status | Completed work items | Main dependency |
| --- | --- | --- | --- | --- |
| 0 | Agreed product contract and measurable baseline | Done | 5/5 | [Implementation contract](ALBUM-SECTIONS-IMPLEMENTATION.md) |
| 1 | Albums with custom sections | Done | 6/6 | Live; hosted and recovery checks passed |
| 2 | People, recoverable accounts and personal/shared spaces | In progress | 0/7 | Application registered; B01: production recovery-email setup |
| 3 | Useful collaboration and upload requests | Not started | 0/6 | Phase 2 |
| 4 | Restricted albums with consistent access enforcement | Not started | 0/6 | Phase 2 and Phase 3 role/access foundation |
| 5 | Deliberate deliveries and portable exports | Not started | 0/6 | Phase 2 and Phase 3 role/access foundation; Phase 4 integration if present |
| 6 | Versions, comparison and review | Not started | 0/5 | Phase 5; validated creative-team demand |
| 7 | Retrieval, media breadth and validated expansion | Not started | 0/6 | Dependencies recorded per work item |

Counts describe completed parent work items, not effort or percentage of the product delivered. Phase 7 is a prioritised expansion backlog, not a commitment to build everything. Phases 4 and 5 can be reordered by explicit decision: useful deliveries need not wait for restricted albums, but must respect them if they exist.

## How to keep this document current

Update this file in the same change set as meaningful development work, and again after a release. Do not leave the tracker describing the state before the change.

1. At phase start, record approval, scope, owner, branch/change reference and the first active work item. Dates are targets only when explicitly agreed.
2. Mark active items `In progress`. Record missing decisions in the decision register and actual impediments in the blocker register.
3. For each finished work item, check its box and add evidence to the work log: implementation location, verification result and remaining limitations. Record partial completion without checking the parent box.
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

Current limitations: identities remain device-based; albums and sections are not privacy boundaries; Original/Final remains a compatibility field behind secondary controls; version relationships are absent. Custom sections are now live. Proposed personal spaces, restricted albums, guest requests and deliveries must not be described as available until released.

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
**Status:** In progress; production activation blocked on B01. Owner: Codex (implementation), user (provider account/access). Standing execution authority applies. [Implementation design and setup requirements](IDENTITY-AND-SPACES-IMPLEMENTATION.md) prepared; protocol/configuration and one-time transaction storage tests pass, but live login, person/session storage and identity migration remain outstanding.

- [ ] **P2-01 — Select and review identity design.** Compare suitable authentication providers, recovery, passkey/sign-in options, costs and operational dependencies. Review the trust model before choosing; use mature authentication rather than custom cryptography.
- [ ] **P2-02 — Implement person and session foundations.** Add identities and space memberships, link authorised sessions, enforce requested-space access on the server, and support session listing, temporary/trusted sessions and remote sign-out.
- [ ] **P2-03 — Migrate legacy access deliberately.** Provide verified account/space claims and recovery; separate Connect my device from Invite a person. Never merge users by device labels, overwrite existing memberships or relabel shared spaces as personal.
- [ ] **P2-04 — Deliver My space and the space switcher.** Show active identity, destination and role. Clear selection/search on switch; preserve queued transfers at their original destination with a return link. Personal spaces start separately and remain inaccessible to shared-space owners.
- [ ] **P2-05 — Provide explicit publication.** Implement the approved private-to-shared copy flow with source/destination permission checks, audience confirmation, storage accounting, verified completion and clear independent-copy semantics.
- [ ] **P2-06 — Complete account lifecycle and retention rules.** Recovery, ownership transfer, leaving a space, offboarding, account-deletion handling and shared-content ownership have explicit policies and supported flows. Preserve deletion/revocation decisions through restore.
- [ ] **P2-07 — Verify and release identity/privacy.** Test cross-person and cross-space denial, legacy claims, recovery, sign-out/caches, in-flight transfers and backup restoration of new tables. Record capability handling for older clients and safe rollback limits.

**Acceptance scenarios:** Joining Family does not expose My space or replace Studio membership. A lost device can be revoked without deleting shared work. Recovery requires ownership proof. Personal content cannot be discovered through counts, covers, search, activity, Trash or original download routes. Restoring a backup does not revive revoked sessions.

**Outside this phase:** End-to-end encryption, hidden private albums inside an otherwise shared device-only library, and silent background publication.

## Phase 3 — Collaboration and controlled collection

**Outcome:** Collaborators can contribute and organise without becoming administrators; occasional contributors can submit without browsing the library.
**Entry:** Phase 2; approved role matrix and guest intake policy.
**Status:** Not started. Owner: unassigned. Approval: not recorded.

- [ ] **P3-01 — Deliver scoped roles.** Owner, Editor, Contributor and Viewer have server-enforced capabilities; prioritise Editor. Distinguish viewing, downloading, contribution, organisation and access administration without exposing a complex matrix on every menu.
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
| D05 | Identity/provider and legacy claims | Recoverable person identity, mature auth, explicit ownership proof | Auth0 selected; Relay Web registered; recovery verification pending / P2 implementation |
| D06 | Ownership and offboarding | Shared work belongs to the space; personal work remains separate; explicit transfer/recovery | Proposed / P2 lifecycle design |
| D07 | Retention and deletion | Document Trash, history, backups, account deletion and restore reconciliation separately | Open / P2 lifecycle design; revisit guest artifacts in P5 |
| D08 | Restricted content and administrators | Explicit audited administrator grants; no access to members' personal spaces | Proposed / P4 design |
| D09 | Delivery and revocation guarantees | Snapshot default; explicit guest capabilities; honest bearer-URL limits | Proposed / P5 design |
| D10 | Creative workflow investment | Validate need before versions, comments and approvals | Open / P6 start |
| D11 | Expansion investments | Prioritise measured friction; optional AI needs separate consent/cost review | Open / each P7 item |

## Risks, blockers and deferred scope

Planning dependencies are not incidents. The active external blocker is:

| ID | Affected work | Required input | Owner | Opened | State |
| --- | --- | --- | --- | --- | --- |
| B01 | P2-01 and dependent identity/privacy/collaboration phases | Relay Web is registered and exact URLs saved. Client secret received through ignored local storage; user-owned domain/email sender setup and runtime integration remain. No secrets in chat or Git. | User (email service/domain details); Codex (integration) | 2026-09-20 | Credential handoff complete; recovery email setup pending |
| B02 | Next release / recovery reliability | Scheduled backup run 35486931770 failed with a read-only D1 query HTTP 400. Cause reproduced: SQL expression depth exceeded D1 limit. Balanced concatenation passes local D1/API tests and a live read-only snapshot restore. Hosted backup, Backblaze restore and verification passed in run 35491216252. | Codex | 2026-09-20 | Resolved |

The Phase 2 design, exact Auth0 application settings, provider adapter and protocol tests are prepared. Relay Web registration is complete; personal accounts, runtime session routes and private-space migration remain unimplemented.

| ID | Risk / response | Owner | State |
| --- | --- | --- | --- |
| R01 | Mistaken legacy identity claims: require proof, recovery review and migration fixtures | Unassigned | Open planning risk |
| R02 | Multiple album references widen visibility: explicit asset scopes and negative tests | Unassigned | Open planning risk |
| R03 | New policy bypassed by old clients/caches/exports: central policy and capability gates | Unassigned | Open planning risk |
| R04 | Guest intake, copies, versions and exports increase storage/processing costs: quota reservation and bounded jobs | Unassigned | Open planning risk |
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
