# Album workflow refinement - 25 September 2026

## Experience

Opening an album prioritises its files. A compact title and Add files action sit above one search/Filters/Settings row and one section-navigation row. Rename, cover colour, pinning, archive and other album administration live in the Settings dialog. Sort and grid/list choices live behind Filters. The Sections menu exposes creation, templates and management without occupying permanent vertical space. Existing permissions and archive restrictions apply.

Sections belong to the current album. Originals and Final cuts are optional template section names, and users can create, rename and reorder their own sections. Global legacy category shortcuts and badges no longer compete with this model in ordinary navigation; explicit legacy category URLs remain supported. Existing data is not automatically reclassified. Template-based sorting retains an explicit preview and choice.

Each file displays its section or Unsectioned. Its Move to section action and the same action inside preview open a destination chooser. Selecting multiple editable files exposes the bulk action. Both paths use the existing revision-checked album-placement API and offer Undo. Changing placement in one album leaves that file's placement in other albums alone. A failed move retains the selected destination and provides retry or refresh. New uploads continue to use the selected section, with a compact visible destination.

## Acceptance evidence

- [x] Implement in main and the isolated schema-0020 live-compatible worktree, preserving the newer main-only features.
- [x] TypeScript, production builds and focused lint pass. Real D1/R2/API suites pass, including album-local section projection, cross-album isolation, permissions and account access.
- [x] Extended section acceptance passes Chromium, Firefox and WebKit: real single/bulk placement, Undo, conflict recovery, preview action, section CRUD/templates/reordering, queued upload destinations, keyboard dismissal and deep links.
- [x] Mobile screenshot inspected: first photo row starts about 424px down at 390px width, including the local-only environment banner. Acceptance requires it below 450px. No horizontal overflow at 320, 390, 768 or 1440px. Desktop screenshot inspected.
- [x] Main-only folder import and metadata export browser checks pass after the shared UI changes.
- [ ] Complete full live-compatible browser regression and production deployment/readback.

No database migration, authentication or access-policy change is included. Section metadata is additive and scoped to the already-authorised album feed. Existing clients retain category API compatibility. Previous Worker `f74624dd-74b1-42fe-b1ed-b624ba098e6d` is the schema-compatible rollback target.
