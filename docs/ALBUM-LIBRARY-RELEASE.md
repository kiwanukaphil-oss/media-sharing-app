# Album-first library release — 24 September 2026

The user approved the album-library HTML concept and explicitly requested execution in the live app. The release replaces the default file feed with closed, illustrated albums. Photos and video previews appear only after deliberately opening an album or another file view.

## Release isolation

Implementation branch: `ui/album-library-live`, based on `hotfix/cobalt-schema0020` at `1a2f6d4` (live runtime source `25c2096`). Live baseline was independently read back as Worker `fd0a29f5-4aaa-4e5e-ba49-ef8d890bae35`, 100%. Database stays at migration 0020. No backend, permission, quota, secret, feature-activation or migration change is part of this UI release. Combined storage and backup coordination remain intact.

The separate `main` branch includes unreleased backend work. Do not deploy it for this change. Preserve the pre-existing local deletions under `prototypes/relay-album-first`.

## Behaviour and design

- Default home, account return and workspace switching open Albums. Previously generated unfiltered home URLs also resolve to Albums. Explicit album/filter deep links and `view=files` retain file browsing. Browser Back/Forward restore the intended surface.
- Album cards have abstract CSS covers, real file/section counts and activity dates; no image/video elements or thumbnail requests are made for the album collection.
- Search and sorting work over the authorised album metadata. Pinned, active and archived collections and grid/list views are available. Empty collections, no matches and metadata failures each have a distinct next action.
- New album creates the actual backend collection and opens it directly. Optional Story/Project section templates use the existing revision-checked section API. If a later section fails, the already-created album is retained and feedback explains how to finish; it is not silently recreated.
- Pins and cover-colour preferences are browser-local, keyed by space, authentication mode and actor. Only IDs and display preferences are stored, never album names or media. This scope is labelled in the UI. Default abstract covers are deterministic across browsers. Actual album metadata and sections remain server-persisted.
- The existing gallery, previews, original downloads, media management, sections, selection/Undo, role-dependent controls and transfers are retained inside explicit file views.
- Uploads from an album display their exact space/album/section destination. The arrival surface rejects dropped files with a direction to open or create an album. Existing clients can still upload unorganised files; no originals or memberships are moved automatically.
- Existing broad-library and category browsing remain behind a secondary Browse files disclosure; Unorganised is an explicit route. Prior overview/category UI is marked as a retirement candidate instead of deleting its implementation.
- Warm neutral surfaces, green navigation, dark primary buttons and editorial type follow the approved prototype. On phones the album title and upload action occupy separate rows. Native modal keyboard behaviour, mobile drawer focus, reduced motion and screen-sharing concealment remain available.

## Acceptance

- [x] Focused ESLint and TypeScript checks; production build; direct deployment dry run.
- [x] New real-Worker album journey in Chrome, Firefox and WebKit: no landing media/thumbnail requests, creation/templates, real photo upload while navigating home, exact retained section destination, counts, pins/reload, search/sort/views, empty states, preview, deep-link reload and browser history.
- [x] Responsive collection and album checks at 320–1440px; desktop/mobile/create/detail screenshots under `outputs/album-library` inspected. Mobile heading wrapping corrected after inspection.
- [x] Actual-D1/R2 API regression: byte preservation, multipart resume, range downloads, pairing/revocation, storage races, library organisation, section isolation/revisions/Undo and auth/space authority.
- [ ] Finish full existing browser regression suite.
- [ ] Deploy the isolated schema-compatible branch and read back its version.
- [ ] Verify both-origin health and anonymous denial; inspect the actual signed-in live album arrival, existing album, creation dialog and personal/shared switching without changing user media.

Reproduce: `npm run build`, then `node scripts/ci-web-integration.mjs --browser`. The new journey is included in that runner; `RELAY_ALBUM_BROWSER=firefox` or `webkit` selects additional engines for `tests/album-library-browser.mjs` against a `--serve` instance. Legacy file-workflow tests explicitly enter `view=files`; home/workspace regressions assert album arrival. These test changes preserve existing behavioural assertions rather than accepting a hidden file feed.

## Deployment and rollback

Pending. The prior live version above is schema-compatible; retain all remote secrets and storage-pool configuration. Rollback would restore the old arrival behaviour, not change files. No permanent deletion or schema rollback is authorised or required.
