# Web library and file organisation

Deployed on 18 September 2026 after user approval, as Worker version `16ec7bee-77c3-47db-b142-1bde072af82c` at 100% allocation. The source commit was approved after production verification. Repository push remains pending.

## Behaviour

- One shared library, with many-to-many album memberships. Files retain their existing storage keys and bytes. Owners create, rename, describe, archive, remove, and restore album groupings. Members can browse and upload into active albums.
- Uploading from an album persists that destination and an upload-batch ID in the existing resumable manifest. Changing the current view cannot redirect queued files. The transfer tray names the original destination.
- All files and Unorganised views, active/archived album selection, and Originals/Final cuts filters within albums. Sidebar categories return to the whole library. Album/filter URLs survive reloads and browser Back.
- Grid/list views retain existing behaviour. Owners can select individual files, Shift-select a range, or select up to 100 loaded files. The interface explicitly says “loaded files”; it does not imply that unloaded search results are selected.
- Bulk add/remove album membership and Trash/restore. Removing album membership never deletes a file. Trashing a file retains its memberships for restoration. Removing an album keeps its files, with Undo restoring the grouping.
- Single-file rename from the card or preview and bulk rename with editable prefix, starting number, preserved extensions, and a complete preview. Current names appear in all albums and future downloads. Uploaded names remain visible and searchable. Existing downloaded copies keep their old names.
- Filename validation rejects path/control characters and reserved Windows names. Conflicts with other active files in shared albums are rejected, with sequence-number controls available to choose another name. Concurrent conflicting renames cannot both succeed.
- Date-uploaded/date-taken browsing, inclusive date ranges, newest/oldest sorting, and upload-batch filtering from file details. Missing capture dates are labelled explicitly. Owners can correct capture dates without modifying embedded metadata.
- Undo for the most recent successful organisation, rename, album-management, or date change in the current session. Revision checks reject stale changes, including stale Undo, rather than overwriting another browser's edits. Durable file Trash remains available independently of session Undo.

## Capture dates and boundaries

Automatic capture-date extraction currently supports JPEG EXIF DateTimeOriginal in either TIFF byte order, reading at most 256 KiB. It preserves the camera's wall-clock date/time without inventing a timezone. Malformed, missing, or unsupported metadata never blocks uploading. Other formats and existing files initially have an unknown capture date; owners can set it manually. Upload dates and upload-date fallbacks are displayed and filtered in UTC.

This is the agreed first library release. Album folders, tags, favourites, saved searches, automatic duplicate detection, external/restricted sharing, activity history, and original/final version relationships remain later work. Albums do not introduce a new privacy boundary: all paired devices in the shared space retain visibility. Native UI/source is unchanged; optional upload fields preserve existing client compatibility.

## Migration and release

`drizzle/0004_confused_magik.sql` adds albums, album memberships, and nullable original-name/capture-date/upload-batch fields plus a revision counter. Existing media uses its existing filename as the original-name fallback and starts in Unorganised. No media object needs copying, re-uploading, or rewriting.

Apply pending migrations through 0004 before deploying the new web build, following the existing production runbook after release approval. Older code can continue to use the additive schema. A code rollback should retain the migration and its organisation metadata; do not drop the new tables/columns to roll back the UI.

The running local preview held a Windows lock on the ordinary `dist` directory. Production-build validation used an isolated copy under `.sites-runtime/library-validation`, with the same dependencies and disposable Miniflare D1/R2 storage. After validation, migration 0004 was applied once to the existing local `.wrangler/state` database. Inspection also found the earlier 0003 owner/member migration was still pending locally; it was applied once so the current development preview could run. Local health then returned HTTP 200.

For the approved production release, a live schema check confirmed that 0003 was already present and only 0004 was pending. A fresh D1 recovery bookmark and export were captured privately; the export restored successfully in isolated SQLite and D1. Only 0004 was applied remotely. Runtime source was byte-compared against the validated build copy, the deployment dry run passed, and that exact build was deployed with existing secrets and resource bindings preserved. Deployment allocation was read back at 100%.

The preceding live Worker was `f48b60d3-a077-4d7f-bcac-22fe4bf5553e`. The additive schema remains compatible with that code for a code-only rollback. Private recovery exports and release evidence are retained under `.sites-runtime/library-release`; never publish those exports or logs.

## Validation

- TypeScript and zero-warning web ESLint.
- Production build and real Worker/D1/R2 integration: multipart resume, exact bytes, ranges, quota races, permissions, tenant isolation, CSRF, album uploads, multiple memberships, stale bulk operations, concurrent filename conflicts, renaming/download names, original-name search, date sorting/pagination, and album/file restoration.
- JPEG metadata tests: little/big endian, valid and invalid leap dates, malformed offsets, unsupported formats, and bounded reads.
- Existing hashing/preparation, download-integrity, and preview-lifecycle checks.
- Chrome, Edge, Firefox, and Playwright WebKit: album creation, destination retention during navigation, individual/bulk renaming, preview/Undo, original-name search, renamed byte-identical downloads, bulk memberships, date correction/filtering, deep-link reload, album archive/Undo, and 320/390/768 px responsive layouts.
- Existing browser transfer, owner/member management, offline, delayed/error-state recovery, media-preview and playback regressions.
- Interrupted multipart upload with reload, wrong-source rejection, completed-part reuse, and an exact-byte recovered download; 50-file pagination and search; library API checks against the migrated development preview.

Automated coverage is wired into the existing API/browser CI runners and the web checks workflow. WebKit automation is not physical Safari validation. Screenshot artifacts are ignored under `outputs/library` in the checkout used for testing.

## Production verification

- Public entry, security headers, database/storage health, and anonymous-feed protection passed.
- `tests/hosted-library.mjs` passed in the isolated Relay verification space: album creation, direct R2 upload into the album, browser rename preview/application, search by uploaded name, capture-date correction/filtering, reload of an album deep link, and a Firefox download with the renamed filename and unchanged bytes.
- `tests/hosted-web.mjs` passed: image upload/thumbnail, verified streaming save, Firefox attachment download, quota display, responsive layout, and Trash/restore of its own fixture.
- `tests/hosted-transfer.mjs` passed: two independently paired sessions, a multipart original larger than 16 MiB, direct R2 upload/download, CORS, SHA-256 equality, and receiver revocation.
- A post-release export passed SQLite integrity and foreign-key checks. All seven pre-release media records retained their original names, storage keys, hashes, sizes, categories, and owning space/device IDs.

Verification writes were confined to the existing isolated verification space. The small library fixture and multipart fixture are retained there as review/cleanup candidates; no existing user media was modified.
