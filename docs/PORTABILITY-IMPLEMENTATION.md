# Portable metadata and import mapping

P5-04, 22 September 2026. The role/access foundation is live, so this bounded portability increment can proceed independently of guest intake and account-erasure execution.

## Selected metadata export

- [x] Allow every current reader, including Viewer and compatibility Member, to select up to 100 loaded files for export. Selection itself grants no editing capability.
- [x] Preview the exact selection and the distinction between JSON metadata and original bytes before download.
- [x] Recheck every selected file revision and current read authority in a consistent D1 batch. A foreign, unavailable or stale selection fails as a whole.
- [x] Include current/original names, MIME type, size, recorded SHA-256, capture/upload dates, Trash state, current album/section mappings and existing relationships. Empty relationships mean none are modelled; names do not imply versions.
- [x] Suggest collision-safe `files/<opaque file id>/<sanitised filename>` paths while retaining source names unchanged in metadata. Do not include storage keys, credentials, signed links, emails or private bookmarks.
- [x] Bound work to 100 files and 2,000 album references, with current request limits. Do not silently truncate; an oversized request asks for a smaller selection.
- [x] Verify real D1 isolation/conflicts and an actual browser JSON download, including Viewer controls, failure recovery, keyboard focus and narrow layout.
- [ ] Hosted regression verification and production release, alongside the pending collaboration migrations.

This is metadata-only portability. Original downloads remain separate and unchanged. Starting a browser download does not prove a successful local save. Original files may contain EXIF/location data; no sanitised derivative is claimed.

## Remaining P5-04 scope

- [x] Preview folder-to-album/section mapping before queueing a directory import; handle names, collisions and browser capability fallback. Locally verified; deployment remains pending.
- [ ] Include the manifest in bounded selected-original export packages when P5-03 jobs exist; verify byte integrity and complete package contents.

The parent roadmap item remains unchecked. No new database tables or stored export artifacts are needed for the metadata increment.

## Folder import increment

Owner/Editor can preview up to 200 files and 50 section groups in a new album. Top-level files remain unsectioned; deeper paths become editable single-level section labels. Repeated filenames remain separate originals and are disclosed before queueing. Paths with traversal/control characters are rejected. Plain-file fallback is available when the browser lacks folder selection.

Layout creation is atomic and uses stable preview IDs. A lost response can be retried without creating another album; another organiser cannot adopt the preview ID, and a changed layout is not overwritten. Existing transfer persistence/resume and current server authority remain in force. Queue status never claims completed uploads. Partial local-persistence failures retain queued IDs and offer retry of the remainder.

Local evidence: `tests/folder-import.mjs`, `tests/import-layout.mjs`, `tests/folder-import-browser.mjs`. The browser check creates only generated local fixtures, loses the first successful layout response, retries once, verifies one album and three byte-identical originals with the reviewed section mappings, and exercises the unsupported-folder fallback. Hosted and deployed checks remain outstanding for this increment.

Hosted folder-import run `35729466805` passed verification. An older account-library browser test selected the first hidden file input instead of the original-file control; it now uses the explicit accessible label. Corrected hosted browser coverage is pending.
