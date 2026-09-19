# Album sections implementation contract

Status: implementation verified; production release pending under the user's 19 September 2026 autonomous execution authority. See the [roadmap](DEVELOPMENT-ROADMAP.md) for progress.

## Product decisions

D01–D04 use the assessment's recommended defaults: personal/small-group use first; one section level; active-space browsing; explicit cross-audience publication later. This phase changes organisation only. Current paired-space access is preserved and explained in the UI. The user requested autonomous implementation after endorsing the direction; no user interviews are claimed.

An album's section switcher offers All in this album, Unsectioned and custom names with counts. New section and Manage section sit beside it. Selecting files exposes Move to section. The existing native dialog, compact controls, focus treatment and Undo feedback are reused. A section name does not approve a file or restrict its audience.

Placement is per album membership. A file can have a different section in each album. A composite foreign key prevents a section from another album being assigned accidentally. Removing a section soft-deletes the grouping; retained references are presented as Unsectioned and allow restoration without overwriting subsequent explicit moves. Removing an album continues to preserve its memberships and files.

Section edits use album revisions; bulk placement uses file revisions with a transactional all-or-nothing guard. Duplicate active section names are rejected. Upload manifests persist both album and section before transfer starts; missing or removed destinations are errors rather than silent reroutes. Existing uploads and clients with no section remain valid.

Legacy Original/Final fields remain intact. They are retirement candidates after section templates and compatibility checks are complete. No current data is reclassified merely by applying the schema migration.

## Migration and verification

The generated migration is reviewed, not applied blindly. Existing album memberships are copied with NULL section IDs; no media bytes, categories, names or memberships are removed. Tests must seed a pre-section schema, apply the migration, verify row preservation and foreign keys, and demonstrate rejection of cross-album placement. Recovery validation must include organisation tables.

API checks cover tenant/role denial, duplicate names, stale requests, mixed-selection atomicity, independent multi-album placement, remove/restore, section uploads, malformed filters and byte-identical downloads. Browser checks cover create/rename/move/Undo, destination persistence, narrow layout, keyboard controls and no runtime errors. Existing transfer and organisation suites remain release gates.

D1 batch statements are transactional; any SQL failure rolls back the batch. Foreign-key enforcement remains enabled during normal operation. Sources: [D1 batch documentation](https://developers.cloudflare.com/d1/worker-api/d1-database/), [D1 foreign keys](https://developers.cloudflare.com/d1/sql-api/foreign-keys/).

Baseline checks on 19 September 2026: web lint and TypeScript passed before implementation. Existing UI/interaction changes and product documents were preserved and pushed in `8820a84`. No fresh production recovery exercise or customer research is claimed by this record.

## Remaining before phase closure

- Implemented and checked: templates with exact-file previews (up to 100 files), cover choice, stable whole-list ordering, bulk move/Undo and queued destinations. Larger albums use empty templates and selected batches.
- Passed: TypeScript, zero-warning lint, build, full API/security integration, pre-section migration fixtures, existing cross-browser transfer/organisation checks and new section browser journeys including cover selection.
- Fresh production export restored in isolated SQLite/D1; both migrations rehearsed with original media and memberships unchanged. Desktop/mobile screenshots reviewed in `outputs/sections/`.
- Legacy global categories remain behind secondary File labels controls; schema/category retirement remains a future compatibility decision.
- Record deployment and post-release evidence separately from committed code.
- Carry identity-provider and recovery-policy decisions into Phase 2; no paid service or user identity is provisioned by this phase.
