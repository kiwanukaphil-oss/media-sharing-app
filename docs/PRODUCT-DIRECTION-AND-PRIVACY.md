# Relay: product direction, organisation and privacy

**Assessment date:** 19 September 2026
**Scope:** The web app, its product model, and the backend changes required to support that model. Native-client compatibility is considered; native UI work is outside scope.
**Status:** Findings and proposals for discussion. This document authorises no implementation, migration, sharing changes, commitment to delivery dates, or deployment.

**Development tracking:** See the [living development roadmap](DEVELOPMENT-ROADMAP.md) for phased deliverables, decisions, acceptance criteria and current progress. This assessment remains the product rationale; the roadmap tracks execution.

## 1. Recommended direction

Relay should become **a trusted media workspace for collecting, organising, reviewing and delivering original-quality files**. Its advantage should be confidence: knowing where a file belongs, who can access it, which version matters, and whether the original arrived intact.

The recommended structure is:

**Person → personal or shared space → album → custom sections → files.**

These concepts should answer different questions:

| Concept | Question it answers | Proposed behaviour |
| --- | --- | --- |
| Person | Who am I? | One recoverable identity, usable across devices and spaces. |
| Space | Who am I working with? | A clear ownership, membership, storage and privacy boundary. |
| Album | What is this collection for? | A project, event, client engagement or personal collection. |
| Section | How is this album arranged? | User-defined subdivisions such as Camera originals, Shortlist, Edits, Deliverables or Day 1. |
| File/version | Which actual media is this? | Immutable original bytes, editable organisational metadata, and optional relationships to other versions. |
| Delivery | What exactly am I giving someone? | An explicit selection of versions and an explicit audience, separate from the working library. |

**Yes to flexible sections inside albums. Yes to personal spaces. No to a universal feed that casually mixes personal and shared material.**

Originals and Final cuts can remain as optional section names or a creative-project template. They should stop being mandatory global categories. A section called Final cuts should not automatically mean approved, shared, or immutable; those are separate decisions.

The largest architectural priority is identity and access. New folders alone will not make sensitive material private.

## 2. What the app actually supports today

This assessment combines the current source, recent implementation/release records, and the UI reviewed during the preceding work. Older documents describe earlier releases; their historical deployment status is not treated as current. This is a product assessment, not a fresh penetration test, customer study, or live backup audit.

| Finding | Evidence | Product implication |
| --- | --- | --- |
| Access belongs to paired devices, with owner/member roles. There is no person/account table. | [Schema](../db/schema.ts), [authentication](../lib/server.ts), [access controls](../lib/device-access.ts) | A person's laptop and phone are separate principals. Device labels cannot reliably establish who owns private content. |
| Each device credential belongs to one space; the web uses one `relay_device` cookie. | [Authentication](../lib/server.ts), [contracts](../lib/contracts.ts) | A reliable space switcher needs session/identity work, not merely a dropdown. |
| File reads are authorised by space membership. Albums have no separate audience. | [File authorisation](../lib/server.ts), [feed](../lib/web-api.ts), [album API](../lib/library-api.ts) | An album named Private is visible to the other paired members of that space. |
| Files can belong to multiple albums without duplicating original bytes. | [Schema](../db/schema.ts), [library behaviour](WEB-LIBRARY.md) | Useful flexibility worth preserving, but it complicates future album-level privacy. |
| `original` and `final` are a required binary file category. Sections and version relationships do not exist. | [Contracts](../lib/contracts.ts), [schema](../db/schema.ts) | The app currently asks users to classify workflow stage without providing a real workflow model. |
| Search covers current and uploaded filenames; organisation includes dates, upload batches, albums and Undo. | [Feed](../lib/web-api.ts), [library API](../lib/library-api.ts) | There is a solid foundation for retrieval, but finding visual content remains limited. |
| Owner/member permissions protect actions on the server; members cannot generally organise the shared library. | [Permission contract](PHASE-1-READINESS.md), [library API](../lib/library-api.ts) | Reasonable for trusted device transfer, too coarse for collaborators who need to curate without administering everyone. |
| Original-byte transfers, resumable uploads, separate previews, Trash and revision checks already exist. | [Architecture](PRODUCT-ARCHITECTURE.md), [interaction refinement](WEB-INTERACTION-POLISH.md) | Preserve these strengths as the product grows. |
| Monitoring and independent backup/restore work are documented as activated. | [Operations record](OPERATIONS-ACTIVATION.md), [recovery design](BACKUP-RECOVERY.md) | Do not describe backups as missing. The next gap is understandable product-level recovery and repeatable coverage as the schema grows. |

The current space boundary is intentional, not an identified cross-space security defect. The mismatch is between that boundary and what users may infer from folders, album names, or the word “personal.”

## 3. Who Relay should serve

The following are proposed audiences, not validated market findings. Start by supporting the first two exceptionally well; validate demand before adding every professional workflow.

| Situation | Main job | What would make Relay distinctive |
| --- | --- | --- |
| One person using several devices | Get originals from a phone to a computer and find them later. | Private space, reliable pairing/recovery, quick transfer, clear destination and verification. |
| A family or trusted small group | Collect an event's media without losing quality or confusing ownership. | Shared albums, simple sections, easy contribution, clear membership and recovery. |
| A photographer, editor or small studio | Collect sources, curate work and deliver the correct files. | Upload requests, section templates, version relationships and deliberate deliveries. |
| A client or occasional contributor | Upload or review a small set without joining an entire workspace. | Narrow guest access and minimal setup. |
| Someone holding sensitive media | Keep particular material out of a wider group's view. | Separate personal space initially; carefully designed restricted albums later. |

Relay should not become a social feed, an unrestricted public file host, a full video editor, and a large enterprise asset-management system simultaneously. Each would introduce a different product and operating burden.

## 4. Album sections: flexible structure without a maze

### Recommended first version

Use **one level of custom sections inside each album**, presented as a simple section list or chips with counts. On larger screens a section rail can sit alongside the gallery; on narrow screens use a compact section switcher. Provide an “All in this album” view.

Example:

```text
Studio space
└── Autumn campaign
    ├── All in this album
    ├── Camera originals
    ├── Shortlist
    ├── Retouching
    ├── Deliverables
    └── References
```

For a family album the same structure could be Arrival, Ceremony, Reception and Favourite moments. Names, order and covers should be editable. “Originals / Final cuts” becomes an optional starting template, not a universal rule.

Sections should behave like folders for placement but should initially **inherit the album's audience without exception**. Add a short explanation where people manage sections: “Sections organise this album. They do not change who can see its files.”

### Rules that prevent ambiguity

- A file may belong to several albums. Within each album it has zero or one section. Its placement in Album A does not change its placement in Album B.
- “All in this album” is a view, not another section or another stored copy.
- A file without a section appears under “Unsectioned” within the album. A file without any album appears in the space's Unorganised view. These are different states.
- Uploading inside a section captures both album and section when the upload is queued. Navigating elsewhere must not redirect it.
- Moving between sections changes placement only. Adding to another album creates another reference. Copying to a different privacy boundary is a separate publishing operation.
- Removing a section moves its placements to Unsectioned, preserves files, and supports Undo. Removing an album preserves its files under their existing access policy.
- Default naming is shared across album references, matching today's behaviour. If contextual captions become useful, make them a separate per-album field rather than silently renaming a shared asset differently.
- Allow keyboard and menu-based moves alongside drag-and-drop. Dragging must not be the only way to organise files on touch devices or with assistive technology.
- Keep section names unique within an album, preserve ordering, and handle concurrent changes with revision checks.

### Why not unlimited nested folders immediately?

Nested folders are familiar and useful for large archives, but they introduce breadcrumbs, recursive move/delete rules, long paths, cycles and permission inheritance questions. One level will cover many project and event workflows with less navigation.

Retain a future extension path for deeper nesting, but do not display arbitrary folder depth until repeated real workflows need it. If added, descendants should continue inheriting the album's audience initially; depth must not imply different privacy.

## 5. Personal spaces, shared spaces and identity

### Personal space

Each person should eventually have a private **My space**. Their own authorised devices access it; other members of a shared space do not. New users start here unless they arrived through an explicit invitation to a shared destination.

Personal means private from other application users under server-enforced access control. It does not mean local-only storage, end-to-end encryption, or inaccessibility to the service operator. Those are distinct promises requiring different designs.

A personal space should support albums, sections, transfers and export without forcing collaboration. It is not a “Private” album inside a shared library.

### Shared spaces

People deliberately join named spaces such as Family, Studio or Project team. Membership and ownership belong to people; devices become their authenticated sessions. A workspace switcher shows the active space, its audience and the user's role.

The active destination should remain visible during uploads and downloads. Switching spaces clears the displayed selection and search results but does not silently redirect, cancel or lose transfers already tied to another space. The transfer panel names the original destination and offers a return link.

### Identity approaches

| Approach | Strength | Limitation | Recommendation |
| --- | --- | --- | --- |
| Continue device-only pairing | Very low friction for trusted device transfer. | Weak person-level ownership, recovery, attribution and multi-space continuity. | Keep as the legacy path during migration; do not call it a complete account system. |
| Person identity with recoverable sign-in, plus device pairing | Clear ownership and multiple spaces without re-inviting one's own devices as collaborators. | Requires account recovery, session management and migration. | Recommended foundation for personal spaces and broader collaboration. |
| Separate private “vault” with client-held encryption keys | A stronger potential confidentiality promise. | Substantial consequences for recovery, previews, search and sharing. | A different future product mode, not a checkbox in this release. |

Use a mature authentication solution supporting convenient sign-in and secure recovery rather than inventing authentication cryptography. Passkeys are a candidate; recovery and cross-device usability must be evaluated alongside them. Provider selection and costs need a separate decision.

Retain QR pairing as “Connect my device.” Separate it from “Invite a person.” A code used to connect one's own phone should not accidentally grant a collaborator a year-long workspace credential.

Never infer that two devices belong to one person from names such as “My phone,” the uploader field, IP addresses, or proximity. Claiming legacy devices/spaces requires explicit proof and a reviewed recovery path. Joining a new space must not overwrite access to an existing one.

## 6. What should “All files” mean?

**A library is a view of authorised content, never a permission grant.** Removing an item from the feed or hiding its thumbnail cannot make it private.

### Proposed navigation

```text
Space switcher: My space / Family / Studio

Home
Library
Albums
Favourites
Transfers
Trash

Space settings: People, Devices, Storage, Sharing
```

Home should show recent albums, interrupted transfers and relevant next steps within the active space. Avoid a dashboard full of statistics. Favourites are a person's bookmarks, not an approval status or public popularity count.

| Context | Default library contents |
| --- | --- |
| My space | That person's accessible personal files, across its albums, deduplicated by file identity. |
| Shared space before restricted albums exist | Files in that active space, including unorganised files; no personal-space content. |
| Shared space after restricted albums exist | Rename the default view **Shared library** and show content shared with the space generally. Restricted albums appear separately only to authorised people. |
| Deliberate “Everything I can access in this space” view, if later added | Both general and restricted content the person is authorised to read, with clear location/audience indicators. Never mix other spaces implicitly. |
| Guest delivery or upload request | Only the delivery's explicit files, or the upload form. No general library. |

The restricted-album rule avoids surprising people with sensitive thumbnails while presenting the general shared library. It is a presentation safeguard in addition to authorisation, not a stronger security guarantee. Do not call a deliberately incomplete view “All files.”

Search should default to the current space and visible scope. “Search all my spaces” could be a later, deliberate action with clear grouping; it should never be the default for shared computers or screen sharing.

Apply the same policy to search results, counts, album covers, autocomplete, recent activity, notifications, Trash, previews and download links. A hidden album's name, filenames or thumbnail must not leak through these secondary surfaces. Storage totals exposed for administration need a deliberate, minimal disclosure policy.

## 7. Privacy inside a shared space

### First protect with separate spaces; then add restricted albums

Separate spaces are the clearest initial boundary. Use a different space when the audience is fundamentally different, such as family media versus client work.

Restricted albums are valuable when mostly the same team works together but particular projects have a smaller audience. Introduce them only after person identity and authorisation coverage are ready. Avoid both a proliferation of spaces for every tiny exception and an unrestricted tree of per-file permission overrides.

A restricted album should say **Specific people**, show who has access, and offer an access preview before changes. New shared albums can default to the current space audience; personal albums remain personal. Do not silently publish a personal album when adding it to a sidebar or workspace.

### The multi-album trap

Suppose the same photograph appears in a general Team album and a restricted Client album. Merely calling the Client album restricted does not make the photograph private: team members already have the general reference.

**Recommendation: album membership should not, by itself, grant file access.** Give each asset an explicit access scope independent of its organisational references. Limit ordinary “Add to album” operations to compatible scopes.

For the restricted-album release, bind restricted albums to named access scopes and require their contents to match that scope. This avoids claiming a whole album is private while some contents remain generally shared. Sharing an asset more widely must be an explicit publish/copy operation with an audience summary. Do not silently union access from every album a file touches.

The initial implementation may create a separate asset record and separate stored copy for cross-scope publication. This costs more storage but offers clearer ownership and deletion semantics. Optimising physical byte reuse can follow only after reference counting, authorisation, backup and garbage collection are proven. No cross-account deduplication oracle should reveal whether another user holds the same file.

Once an independent shared copy has been published, deleting or changing the private source does not recall that copy. Explain this before publication. A restricted reference to an already generally shared asset must instead warn that existing exposure remains; making a private copy cannot undo prior access.

### Hard rules for moves, removal and revocation

- Moving within an access scope is organisational and undoable.
- Crossing a scope requires authority over the source and destination and explicit disclosure of who gains access. Prefer “Publish a copy” for personal-to-shared transfers initially; retain the private source until the new copy is verified.
- Removing a restricted album must leave its files in a retained, equally restricted recovery/unorganised area. Never fall back to the general shared library.
- Restore must re-evaluate current access. Old membership records must not resurrect a revoked share or make restored files public.
- Workspace administration and access to personal spaces are separate. Shared-space owners never inherit access to members' personal spaces.
- If workspace owners can grant themselves access to restricted business content, disclose that capability and audit the grant. Do not promise confidentiality from administrators while allowing silent self-grants.
- Revocation stops new authorised access. Previously downloaded files cannot be recalled. Current Relay object URLs expire after one hour; tighter revocation guarantees require an explicit change to delivery architecture.

Cloudflare describes presigned URLs as bearer credentials usable until expiration. Shorter issuance lifetimes and reauthorisation can reduce exposure; they do not erase a downloaded copy. For stronger revocation, evaluate an authenticated delivery gateway and its effect on large-file transfer reliability. [Cloudflare R2 documentation](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)

Permission inheritance deserves an explicit model: Google Drive's limited-access folder design illustrates that restricting a descendant requires a real access feature rather than a folder label. Relay should adopt simpler rules initially, not replicate the full complexity. [Google Drive guidance](https://support.google.com/drive/answer/14254362)

## 8. Roles, confirmations and recovery

### Proposed roles

Roles describe actions; scopes describe which content those actions apply to. Both must be checked on the server. The following is a proposal, not today's permission contract.

| Role | Normal capabilities within authorised content | Exclusions by default |
| --- | --- | --- |
| Owner | Space administration, membership, billing/storage policy, ownership transfer and permanent deletion. | Other people's personal spaces; silent access escalation to restricted content. |
| Editor | Create/organise albums and sections, rename, curate and Trash content in their granted scope. | Membership administration, broader sharing and permanent deletion. |
| Contributor | Upload to permitted destinations; manage their unfinished uploads. | Organising/deleting other people's work or administering access. |
| Viewer | Browse and, where granted, download. | Upload, organisation and deletion. |

An upload-only request and a review delivery should be narrowly scoped guest capabilities, not additional full-workspace roles. Permission to view, download, comment, approve and reshare should be explicit where relevant. Hiding Download cannot prevent screenshots or all copying of viewable content.

For the first role expansion, prioritise Editor so collaborators do not need ownership merely to organise files. Do not add a large permissions matrix to every action menu. Show a concise audience/role summary and reveal advanced controls only to people managing access.

### Action model

| Action | Recommended interaction |
| --- | --- |
| Rename, move section, add/remove album reference, Trash | Immediate result and visible Undo, subject to revision checks. |
| Remove an album/section | Preserve files and their access scopes; show destination/recovery information and Undo. |
| Publish to a broader audience, grant ownership, disconnect a device | Confirmation naming the audience or consequence. |
| Permanently delete | Separate action in Trash, named consequence, safe initial focus and explicit confirmation. |
| Bulk action | Show the count and scope; never imply unloaded search results are selected. |

Today's Undo is useful but temporary. Add a durable activity history for supported reversible actions, with actor, timestamp and scope. Activity visibility must follow content access. An audit record does not automatically mean an action is safely reversible; mark conflicts and irreversible events clearly.

“Deleted from the app” and “removed from retained backups” are different events. Define and communicate their retention rules before offering account deletion or stronger privacy promises. A restore process must preserve deletion decisions and invalidate old sessions/shares as appropriate.

## 9. Features with the greatest potential

Priorities below are product judgments. Effort bands are relative scope, not estimates or delivery commitments.

| Opportunity | User benefit and first useful version | Dependency / main risk | Priority |
| --- | --- | --- | --- |
| Custom album sections and templates | Organise a shoot or event in its own language. One level, reordering, counts, explicit moves. | Correct many-to-many placement and migration. Moderate scope. | Next organisation release |
| Recoverable person identity and space switching | A coherent private library across one's own devices, alongside shared work. | Identity claims, recovery and legacy-session migration. Large scope. | Foundational |
| Personal spaces | Keep private content out of collaborative libraries. | Person identity and clear publication semantics. Large scope. | Foundational |
| Editor role | Let collaborators organise without giving them control of everyone else's access. | Server capability checks, invitation defaults and audit. Moderate scope. | Early |
| Upload requests | Collect an event's photos or a client's sources without inviting them into the library. | Destination/expiry/size limits, abuse controls, safe processing and contribution receipts. Significant scope. | High-value expansion |
| Deliberate deliveries | Share a finished selection with an expiry and appropriate download/review permissions. | Access foundation, guest sessions, stable version selection and revocation. Significant scope. | High-value expansion |
| Related versions and comparison | Find the current edit without losing the source or confusing clients. Start with explicit “Add related version.” | Immutable lineage, naming, deletion and approval semantics. Significant scope. | After organisation/access |
| Favourites and better retrieval | Find important work using bookmarks, type, uploader, date and location. | Permission-aware indexes; bookmarks private by default. Small to moderate scope. | Early |
| Scoped activity and notifications | See what changed without manually checking every album. Start in-app; offer quiet digests later. | Person attribution, privacy-safe previews and notification preferences. Moderate scope. | After identity |
| Duplicate detection | Warn about exact duplicate uploads within an authorised space and offer reuse. | Use verified hashes appropriately; no auto-delete or disclosure across private scopes. Moderate scope. | After reliable identity/scopes |
| Download selected / delivery packages | Complete a real multi-file handoff with predictable names and a manifest. | Large-file browser constraints, job progress, quota and cancellation. Significant scope. | High practical value |
| Comments and approval | Keep feedback beside the correct photo or video version. | Identity, version-specific state and moderation/access. Significant scope. | Validate with creative teams |
| Optional semantic search | Find “the blue chair” when filenames are meaningless. | Explicit processing consent, cost, retention, access-safe indexing and deletion propagation. Large scope. | Later experiment |

### Upload requests: likely the strongest new entry point

An organiser creates an upload destination and sends a time-limited link. Contributors can submit files without seeing other submissions or becoming space members. Show the recipient, destination, limits and upload progress before submission; provide a receipt that does not reveal the library.

Publicly reachable upload forms require bounded quotas, abuse handling and a policy for untrusted files. Start with invited or passcode-protected requests rather than unlimited anonymous intake. Names entered by contributors are self-reported unless verified; do not present them as authenticated identities.

This is a proven interaction pattern: Dropbox file requests allow contribution without requiring the sender to have a Dropbox account. That supports the pattern, not an assumption that Relay should copy Dropbox's implementation or limits. [Dropbox guidance](https://help.dropbox.com/share/received-file-request)

### Deliveries: separate a working album from what the recipient receives

A delivery should normally be a snapshot of explicitly selected versions. Adding a new private draft to the working album must not silently add it to an existing client link. Offer a deliberately labelled live collection only when ongoing updates are intended.

Show the sender exactly which files and versions are exposed, to whom, for how long, and whether downloads or comments are allowed. “Viewed” should mean the event actually observed, not proof that someone understood or saved the material. A “Download started” event is not a verified local save.

Frame.io's sharing controls provide useful precedent for explicit expiry, passphrases and recipient capabilities. Relay's recommendation is a simpler delivery experience tied to its original-quality transfer strengths. [Frame.io sharing documentation](https://help.frame.io/en/articles/9105232-shares-in-frame-io)

### Versions and approvals should remain distinct from sections

A user may place a file in Deliverables before approval, or keep several approved variants. Approval belongs to a particular immutable version, with actor and time. Uploading a newer version must not inherit approval automatically.

Do not infer related versions solely from similar filenames. Suggest a relationship if useful, but require confirmation. Support photo and video work equally; “Final cuts” must not remain the vocabulary for every media type.

## 10. Overlooked details that determine whether people trust the app

| Area | Gap or risk to address | Proposed treatment |
| --- | --- | --- |
| Shared or borrowed computers | Persistent access may outlive the intended session. | “Trusted device” versus temporary session, session list, remote sign-out and visible active identity/space. |
| Ownership and recovery | Losing the final usable device should not strand a person's library. | Recoverable identity, ownership-transfer flow and a reviewed escalation path; do not bypass ownership checks based on a display name. |
| Departing collaborators | Uploaded files and access can become entangled. | Shared-space content belongs to the space under a declared policy; remove the person's membership without deleting shared work. Personal content remains separate. |
| Metadata privacy | Exact originals may include location, camera identifiers or other sensitive metadata. | Explain original-download implications. Later offer an explicitly labelled sanitised derivative for sharing, while preserving the original. Never quietly strip it. |
| Previews and unsupported formats | A RAW file or unsupported video may transfer correctly but fail to render. | Clear original-available fallback; optional derived previews with bounded cost and no modification of originals. |
| Related media | RAW/JPEG companions, sidecars and Live Photo components can lose their relationship. | Model related resources without pretending every platform import path is already supported. Preserve bytes and disclose export limitations. |
| Browser transfer limits | Background suspension, lost tabs and download-picker differences remain. | Accurate progress, resumable manifests, retry/reselect guidance and honest completion states. Avoid promises of native background behaviour on the web. |
| Directory import and bulk export | Users may need entire folder structures rather than isolated files. | Preview the proposed mapping to albums/sections; handle collisions and unsupported browser APIs. Generate large export packages as bounded jobs, not enormous in-memory browser blobs. |
| Data portability | People should be able to leave with more than a pile of unnamed objects. | Export originals plus a manifest of names, albums, sections, dates and version relationships. Make metadata export permission-aware. |
| Storage and costs | Originals, versions, previews, Trash and backups all consume resources. | Explain what counts, reservation states and limits before a transfer. Track operational costs before introducing video proxies, AI or unbounded guest uploads. |
| Recovery durability | Session Undo is not full recovery history; backups are not user-visible Trash. | Persistent, scoped history; documented retention; scheduled restore exercises after schema changes. Retain the existing independent backup work. |
| Accessibility | Beautiful controls alone do not make the product usable. | Keyboard routes for every operation, visible focus, clear names, reduced motion, screen-reader progress, touch alternatives and tested contrast. |
| Presentation privacy | Even authorised thumbnails may be awkward while screen sharing. | Optional presentation mode that hides filenames/thumbnails or reveals them deliberately. Clearly distinguish this from access restrictions. |
| Search privacy | An index or notification can expose content the main feed hides. | Apply the same scope policy to indexing, suggestions, counts, activity and derived data. Remove or restrict derived records when access changes. |
| Content abuse | Collection links change the threat model beyond trusted paired devices. | Upload limits, safe download disposition, sandboxed preview generation, reporting and a process for handling prohibited content. Do not render arbitrary uploads as executable pages. |
| Operational truth | “Backed up,” “verified” and “delivered” can become misleading labels. | Tie each status to an actual event and timestamp. Distinguish source hash, completed upload, verified save and verified recovery point. |

The existing backup records are evidence of prior activation, not a fresh guarantee that every current recovery point is healthy. Expanding identity, permissions or version tables must also expand backup/restore coverage and related integrity checks.

## 11. Architecture implications and migration

This is a conceptual design, not a database migration specification.

| Addition | Purpose | Important invariant |
| --- | --- | --- |
| `users` and recoverable account identities | Identify people independently of devices. | Device names do not prove ownership. |
| `space_memberships` | Permit one person to join several spaces with a role. | Every request authorises the requested space; the active UI selection is insufficient. |
| Device/session records linked to people | Preserve QR convenience and allow revocation. | Revoking one device does not accidentally remove a person's other memberships. |
| `album_sections` | Custom names and ordering within an album. | A section belongs to exactly one album. |
| Section reference on `album_media` | Allow different placement in different albums. | A membership can reference only a section in its own album; enforce this transactionally or structurally. |
| Asset access scopes and grants | Decouple visibility from album organisation. | Adding a reference cannot silently widen an asset's audience. |
| Version relationships and review state | Link immutable assets to creative history. | An approval refers to a specific version; originals are never overwritten. |
| Deliveries and upload requests | Narrow external collaboration. | Grants reference explicit destinations or asset versions, expire, and can be revoked for future access. |
| Activity events | Attribution, recovery and supportability. | Events reveal only content the viewer is entitled to know about. |

Reuse the current byte-storage and transfer paths where appropriate. Do not undertake a storage-platform rewrite merely to add sections or accounts. Centralise access-policy evaluation so feeds, album lists, counts, previews, original downloads, range requests, exports and mutations cannot drift apart.

### Safe sequence for existing data

1. Inventory current spaces, sessions, media and album references. Capture a verified recovery point before structural migrations.
2. Add sections without deleting `original`/`final`. Offer an explicit per-album preview to seed Originals and Final cuts sections from existing classifications. Also offer a blank structure. Never force all albums into the creative template.
3. Keep unfiled content accessible. Preserve multiple album memberships; changing one album's section does not rewrite the file's legacy category everywhere.
4. Remove the global category emphasis only after web flows and compatibility handling are ready. Mark the old fields and navigation as retirement candidates; do not silently drop them.
5. Introduce people and multi-space membership through an explicit account-claim process. Preserve access until the verified owner completes migration; never merge devices into a person automatically.
6. Existing shared spaces remain shared. Do not relabel them personal, auto-hide shared work, or auto-publish private content. New personal spaces start separately.
7. Add restricted scopes only after every relevant access path is covered. Unsupported older clients must not receive restricted content through legacy endpoints; use capability gating or require an update.
8. Migrate search, caches, thumbnails, events, export and backup logic alongside permissions. Test loss of access during an open viewer, queued upload and active download.
9. Retain compatible rollback paths. Do not roll back restricted data to code that ignores the new access policy. Disable incompatible legacy routes or prefer a forward fix.

### Release gates

- A user cannot discover another person's private files through feed, search, counts, covers, previews, original URLs, exports, activity or Trash.
- A file placed in two albums obeys one explicit access policy; moving or removing either reference cannot widen it.
- An upload queued in Space A / Album B / Section C stays there when the user navigates to Space D.
- Removing a restricted album and then restoring its files preserves restrictions and respects later revocations.
- A guest upload request cannot read existing submissions, list the space or exceed its configured resource limits.
- A snapshot delivery does not expose versions uploaded after publication unless deliberately updated.
- Sign-out, device revocation and workspace removal have tested effects on local caches and future API calls. Existing signed-URL and downloaded-copy limits are accurately described.
- Byte-identical transfer, metadata preservation, resumability, optimistic concurrency, accessibility and responsive layouts continue passing.
- New identity/permission tables survive a verified restore; restored sessions and expired/revoked links do not regain unintended validity.

## 12. Delivery order and what to defer

| Stage | Outcome | Approval/evidence needed before moving on |
| --- | --- | --- |
| 0. Agree the product contract | Confirm audience boundaries, ownership, section semantics and intended primary users. | Review this proposal and validate representative scenarios. |
| 1. Improve organisation | Custom sections, optional templates, album-centric navigation, clearer selection scope and private favourites if identity supports them. | Reviewed prototype, migration preview and regression results. No privacy claims for sections. |
| 2. Establish personal/shared foundations | Person identity, account recovery, space switcher, personal spaces and deliberate invitations. | Identity/recovery review, legacy-claim plan and authorisation tests. |
| 3. Enable safe collaboration | Editor role, access visibility, narrowly scoped upload requests and, where needed, restricted albums. | End-to-end scope enforcement, abuse controls and operational readiness. |
| 4. Make handoff exceptional | Snapshot deliveries, selected-file export and honest delivery status. | Recipient usability tests, expiry/revocation tests and cost validation. |
| 5. Add creative depth where demand warrants it | Related versions, comparison, comments and approvals. | Evidence that actual users need these workflows. |

If people need private content immediately, Stage 2 takes precedence over adding more organisational depth. Restricted albums should not delay a useful personal-space release; separate spaces remain the initial privacy solution. Upload requests can follow access foundations without waiting for unrestricted nested folders or an elaborate review system.

Defer unlimited nesting, per-file permission exceptions, AI auto-tagging by default, face identification, in-browser editing, public discovery, monetised marketplaces, automatic deletion and a full enterprise administration suite. These are not necessary to make the core product excellent and would substantially expand complexity or operating responsibility.

## 13. How to validate the direction

Use moderated walkthroughs with a solo multi-device user, a family/event organiser, a creative collaborator and an occasional recipient. This is proposed research; no such interviews were conducted for this document.

Ask them to complete concrete tasks:

1. Place private photos and shared event photos in the right destinations without assistance.
2. Explain who can see a file before and after adding it to another album.
3. Create their own section names and find a file later without remembering its uploaded name.
4. Contribute to an event without seeing everyone else's submissions.
5. Send only approved deliverables without exposing drafts added later.
6. Recover a mistaken move/deletion, replace a lost device, and remove a collaborator.

Measure task completion, mistaken-audience choices, time to first successful handoff, search/find success, transfer failures and recovery success. Track repeat use of albums and return visits by collaborators. Establish baselines before setting numeric targets; do not optimise for uploads alone or treat broad sharing as success.

Product analytics should use minimal operational events rather than filenames, image content, signed URLs or private search terms. Research and analytics collection are separate proposed activities, not authorised by this document.

## 14. Decisions to resolve before implementation

These are discussion points, not blockers to delivering this assessment. Recommended defaults are included so the next review is concrete.

| Decision | Recommended default | Alternative and tradeoff |
| --- | --- | --- |
| What is Relay primarily for? | Dependable personal and small-group media workspaces, with deliberate creative handoff. | A professional review platform first would bring versions/approval forward and require more complex roles sooner. |
| How much hierarchy? | Albums with one level of custom sections. | Deep folders favour archives but add navigation and inheritance complexity. |
| Is personal content truly separate? | Yes: separate personal space and recoverable person identity. | A private album inside a shared device-only space would be a misleading shortcut unless backed by new authorisation. |
| What does the default shared library include? | General shared content in the active space; separate deliberate access to restricted albums later. | A combined authorised feed is convenient but more likely to expose sensitive thumbnails during ordinary browsing or presentation. |
| How does private content become shared? | Publish a clearly identified copy, preserving the private source initially. | Moving ownership is leaner on storage but requires more consequential ownership/recovery rules. |
| Can administrators access restricted business albums? | Only through a declared, explicit and audited grant; never members' personal spaces. | Confidentiality from all administrators requires a materially different encryption/trust model. |
| Does a client link follow future uploads? | Snapshot of selected versions. | A live collection is useful for collaboration but must be deliberately chosen. |
| What is the recovery promise? | Clear Trash/history plus documented backup retention and tested restoration. | Stronger permanence or deletion guarantees require an agreed operating policy and resources. |

The recommended first implementation proposal is **custom album sections with optional Originals/Final cuts templates**, accompanied by a separate, reviewed design for **person identity and personal/shared spaces**. That delivers immediate organisational value while preventing folder appearance from getting ahead of the privacy model.
