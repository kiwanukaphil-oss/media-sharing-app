# Web release validation — 17 September 2026

Live app: https://relay-media-exchange.kiwanukaphil.workers.dev

This release focuses on the responsive web client. Native source is unchanged. The initial preview commit was approved and pushed; the user separately approved committing and pushing these tested web changes.

## Delivered

- Original-byte uploads and local saves, with Originals and Final cuts in the same shared space.
- Stable cursor pagination (48 cards per page), server-side filename search, accurate category counts, and small separate image thumbnails.
- 100 GiB per space (UI label: 100 GB), including originals, previews, and reserved unfinished transfers. Concurrent reservations are atomic.
- Reversible Trash, restore, confirmed permanent deletion, and unfinished-upload cancellation. No automatic deletion of completed originals.
- Pause/resume across reloads, wrong-source rejection with immediate reselection, and restart of expired multipart sessions.
- Verified streaming saves with progress/cancellation where supported; browser-managed attachment downloads elsewhere.
- Persistent pairing, single-use QR/link invitations with expiry feedback, device management, and offline feedback.

## Verification performed

| Check | Result |
| --- | --- |
| TypeScript and production build | Passed |
| ESLint on changed application/test files | Passed |
| Existing multipart/security integration suite | Passed: resume, incomplete manifests, byte equality, ranges, tenant isolation, CSRF, invitation replay/race, revocation |
| Streaming save integrity | Passed: picker ordering, exact bytes, corruption, oversize, cancellation without committing |
| Management API suite | Passed: pagination/search/counts, trash/restore/delete, preview isolation, quota race, restart/cancel |
| Chrome, Edge, Firefox, Playwright WebKit | Passed: upload/download, search, final cuts, trash/restore, quota dialog, keyboard dismissal, persistent pairing, offline feedback |
| Desktop and 390 px layouts | No horizontal overflow; screenshots inspected |
| Interrupted upload in Chrome | Passed: pause after first 16 MiB part, reload, wrong-source rejection, correct-source recovery without retransmitting first part |
| 50-file browser library | Passed: 48→50 paging, no duplicates, whole-library search, independent pairing, thumbnail and unchanged image |
| Hosted access | Passed: anonymous reads rejected; space creation requires invitation |
| Hosted direct R2 multipart | Passed: cross-session visibility, CORS, SHA-256 byte equality, revocation |
| Hosted web controls | Passed: real image upload, thumbnail, streaming SHA save to test writable, Firefox attachment download, quota, responsive controls, trash/restore/test-fixture deletion |

The hosted verified-save test substitutes the native picker/writable destination while exercising the actual production download and hash path. Firefox downloads are real browser-managed files checked on disk. WebKit coverage is engine automation, not a physical Safari/iPhone claim. Fixtures live only in isolated verification spaces; user media was not removed.

Run local checks with the development server active:

```sh
node node_modules/typescript/bin/tsc --noEmit
node tests/transfer-integration.mjs
node tests/download-integrity.mjs
node tests/web-management.mjs
node tests/web-browser.mjs
node tests/web-recovery.mjs
node tests/web-library.mjs
node scripts/run-framework.mjs build
```

Install Playwright Firefox/WebKit using `node node_modules/playwright/cli.js install firefox webkit`; browser tests also use installed Chrome and Edge. Hosted checks require the existing ignored verification credential; never copy it into source or logs.

## Browser boundaries

Keep the tab open during uploads. A suspended/closed tab cannot guarantee continuous background transfer; after reload, reselect the original to resume. Web saves use Downloads or a user-selected file; browsers cannot silently write to the phone Photos library. Unsupported preview formats remain fully downloadable. Permission prompts and system file selection are outside the two-in-app-action constraint.

The server verifies multipart assembly and size. Supported streaming clients verify SHA-256 on download; browser-managed downloads do not report an application-level hash check. Device sessions last one year and clearing site data requires pairing again. Invitations expire after ten minutes; issued signed object URLs expire after one hour.
