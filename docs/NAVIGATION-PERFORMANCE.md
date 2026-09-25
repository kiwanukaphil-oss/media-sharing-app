# Album and section navigation performance - 25 September 2026

## Behaviour

Recently visited album/section results render from workspace-owned memory while an authenticated read checks for updates. The grid reuses private thumbnail blob URLs across views, including the same file appearing in two albums. Full-size previews and original downloads retain their existing paths and quality.

Each album remembers its last section and vertical position for the current mounted workspace. Explicit section deep links remain authoritative. Navigation between sections starts at the top; returning to an album restores its remembered position. Missing/deleted remembered sections fall back to All photos.

Mouse movement or keyboard focus over an album/section schedules a small intent preload after 180 ms. Leaving the control cancels pending intent. Merely rendering/resizing the album library does not preload private media. Intent warming is disabled on Save-Data, 2G and offline connections, and loads at most the first six previewable files. Visible-grid thumbnails load within 240px of the viewport.

## Bounds and correctness

- File-list snapshots: at most 12 views / 1,200 items, with individual views above 500 items excluded; eligible for immediate repeat navigation for 30 seconds. Every visit still revalidates. Superseded foreground reads are cancelled and feed requests have a 20-second timeout.
- Thumbnail memory: at most 160 entries / 24 MiB, two-minute reuse, maximum four concurrent downloads and a 15-second request timeout. No application disk cache, service worker or public caching is introduced. Private HTTP responses remain no-store.
- Mutations invalidate file-list snapshots; completed uploads explicitly do so even when their transfer API is separate. Changed authoritative responses invalidate other cached views. Old in-flight responses cannot refill caches after invalidation.
- Workspace/identity changes, audience changes, known access denial and page exit clear private memory. Workspace keys isolate providers. Access clearing revokes blob URLs, aborts reads and closes content dialogs. Existing server permission checks remain authoritative.
- The short-screen sidebar now scrolls instead of shrinking the album list to zero height.

## Verification

- [x] Main/live-compatible TypeScript, lint and production builds; bounded-cache unit checks cover read deduplication, mutation races, snapshot TTL/LRU, concurrent thumbnails, eviction, stale blob rejection and identity/access clearing.
- [x] Controlled browser fixture passes Chromium, Firefox and WebKit. Returning to a section rendered in approximately 59 / 145 / 277 ms respectively while its revalidation response was deliberately held. These are local fixture timings, not production-network benchmarks.
- [x] The repeated image retains the same blob URL and one thumbnail request; a second album reuses that file's thumbnail. Intent preload stops after six. Remembered section/scroll, rename invalidation and revoked-access clearing pass.
- [x] Full live-compatible browser regression passes, including uploads/downloads, album/section CRUD, presentation privacy, failure recovery, sharing and workspace navigation. Main-only audience revocation and folder import checks also pass.
- [x] Final release build passes the cache fixture across all three engines, actual section/upload/Undo workflow, account-access clearing and delayed/error/Trash usability checks. Dry run passes.
- [ ] Publish and check production.

This is a UI/runtime optimisation on the schema-0020 live branch. No migrations, storage bindings, authentication settings or new backend features are activated. Prior Worker `15003cc6-04a5-4dd2-8689-b2ea0156924c` is the compatible rollback target.
