# Album workflow refinement - 25 September 2026

## Experience

Opening an album prioritises its files. A compact title and Add files action sit above one search/Filters/Settings row and one section-navigation row. Rename, description, archive and album removal live in the Settings dialog. Cover colour and pinning remain available on the album library cards. Sort and grid/list choices live behind Filters. The Sections menu exposes creation, templates and management without occupying permanent vertical space. Existing permissions and archive restrictions apply.

Sections belong to the current album. Originals and Final cuts are optional template section names, and users can create, rename and reorder their own sections. Global legacy category shortcuts and badges no longer compete with this model in ordinary navigation; explicit legacy category URLs remain supported. Existing data is not automatically reclassified. Template-based sorting retains an explicit preview and choice.

Each file displays its section or Unsectioned. Its Move to section action and the same action inside preview open a destination chooser. Selecting multiple editable files exposes the bulk action. Both paths use the existing revision-checked album-placement API and offer Undo. Changing placement in one album leaves that file's placement in other albums alone. A failed move retains the selected destination and provides retry or refresh. New uploads continue to use the selected section, with a compact visible destination.

## Acceptance evidence

- [x] Implement in main and the isolated schema-0020 live-compatible worktree, preserving the newer main-only features.
- [x] TypeScript, production builds and focused lint pass. Real D1/R2/API suites pass, including album-local section projection, cross-album isolation, permissions and account access.
- [x] Extended section acceptance passes Chromium, Firefox and WebKit: real single/bulk placement, Undo, conflict recovery, preview action, section CRUD/templates/reordering, queued upload destinations, keyboard dismissal and deep links.
- [x] Mobile screenshot inspected: first photo row starts about 424px down at 390px width, including the local-only environment banner. Acceptance requires it below 450px. No horizontal overflow at 320, 390, 768 or 1440px. Desktop screenshot inspected.
- [x] Main-only folder import and metadata export browser checks pass after the shared UI changes.
- [x] All live-compatible browser journeys pass locally. The full run passed through publication; its final presentation check still expected the old New album command position. Updated it to assert Settings aligns with Filters, then reran presentation and editor checks successfully. Deployment dry run passes.
- [x] Deployed runtime source `e2e0320` as Worker `d3881a26-a4f8-475d-9694-fd0ef7009a82` at 100% on 25 September 2026, 03:34 UTC. Both origins pass entry, security headers, storage/database health and anonymous-feed denial. Signed-in existing album confirms compact controls, no global labels, Settings dialog, section menu, file badges and individual move dialog with its real album-local destination. Cancelled without moving user files.
- [x] Hosted follow-up [36090901553](https://github.com/kiwanukaphil-oss/media-sharing-app/actions/runs/36090901553) passes; it includes the final presentation-test adjustment. The preceding run was cancelled after that stale assertion was identified locally.

No database migration, authentication or access-policy change is included. Section metadata is additive and scoped to the already-authorised album feed. Existing clients retain category API compatibility. Previous Worker `f74624dd-74b1-42fe-b1ed-b624ba098e6d` is the schema-compatible rollback target.

## Visible section navigation - 25 September 2026

- [x] Replace the hidden section picker with visible name/count buttons. All photos and custom sections remain a single horizontal row; Unsectioned appears when populated or currently selected. Olive active styling, horizontal overflow fade, a visible plus action and a compact View all sections directory expose the structure without stacking controls.
- [x] The overflow directory lists full names/counts and current selection; Escape restores focus. Resize observation keeps the active section visible. Management stays in the overflow menu for the selected section, with template setup available before sections exist. Legacy picker CSS is marked as a retirement candidate.
- [x] Builds and TypeScript checks pass on both branches; focused lint passes. Actual album section workflows pass Chromium, Firefox and WebKit. Album-library and presentation regressions pass. Mobile screenshot inspected: first media row is about 443px down at 390px, including the local-only banner. Width checks pass at 320, 390, 768 and 1440px. Deployment dry run passes. No backend/schema change.
- [x] Published source `490437d` as Worker `15003cc6-04a5-4dd2-8689-b2ea0156924c` at 100%, 25 September 2026 03:49 UTC. Both-origin health/security probes pass. Signed-in live album shows All photos, its custom section and populated Unsectioned with correct counts; section selection updates the URL, selected state and upload destination. No user files were changed.
- [x] Hosted follow-up [36091916206](https://github.com/kiwanukaphil-oss/media-sharing-app/actions/runs/36091916206) passes both verification and browser jobs.
