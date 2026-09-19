# Creative workspace redesign

Implemented and validated locally on 2026-09-19 following approval of the interactive prototype. Deployed to production after separate user approval as Worker version `bbbb6840-3888-4577-973d-ef6c4eb6fd84`; Cloudflare reports 100% allocation. Repository publication remains a separate approval phase.

## Experience

- Light creative workspace with restrained violet accents, clearer hierarchy, larger media previews, and album navigation with real counts.
- Compact search, sort and view toolbar. Advanced filters expand on demand; active filter chips and contextual selection actions keep the library readable.
- File actions sit in accessible disclosure menus that dismiss on Escape or outside click.
- Dark immersive viewer with loaded-file navigation, image zoom, filmstrip, optional metadata and original-file downloads. Native video controls remain available.
- Responsive navigation drawer with focus containment and restoration, narrow-screen grid/list layouts, and clearer upload, loading, empty and error states.

Original upload, recovery, download, album, rename, capture-date, Trash and permission workflows are preserved. This change is limited to the web app; it does not change API contracts, database schemas or native mobile applications. Earlier styling is retained and marked as a removal candidate for a later approved cleanup.

## Verification

Passed `npx tsc --noEmit`, `npm run lint:web`, and `npm run build`.

Passed the API integration suite (`RELAY_TEST_PORT=8792 node scripts/ci-web-integration.mjs`), including multipart/resume, byte-identical downloads, ranges, isolation, CSRF, pairing/revocation, permissions, library organisation and request bounds.

Passed the final browser suite (`node scripts/ci-web-integration.mjs --browser`):

- Chrome, Edge, Firefox and WebKit: upload/download, search, Trash/restore, quota, pairing, responsive layout, offline feedback, album organisation, rename/undo, bulk operations, capture dates, deep links and archive/undo.
- Additional browser checks: owner/member controls, mobile help and recovery, media posters, video playback, viewer zoom/navigation/details/focus restoration, menu dismissal, and drawer/grid/list widths at 320, 390 and 768 CSS pixels.

The populated desktop and narrow-screen implementation were visually reviewed with sample prototype photos in an isolated local workspace. Existing build warnings about the future Vite configuration loader and Next middleware convention remain. Browser automation does not imply physical-device or every-codec certification.

## Local review

The disposable preview runs at http://127.0.0.1:8793/ while its server is active. Its sample library is separate from production and disappears when the server stops. Restart with `$env:RELAY_TEST_PORT='8793'; node scripts/ci-web-integration.mjs --serve` after building; a new local workspace will be needed.

## Production release

The validated build was deployed without rebuilding or changing runtime source. The direct-config preparation and deployment dry run passed, the dependency audit reported zero vulnerabilities, and existing D1, R2, rate-limit bindings and Worker secrets were preserved. No database migration was needed.

Public entry, security headers, database/storage health and anonymous-feed protection passed after deployment. The prior version is `16ec7bee-77c3-47db-b142-1bde072af82c`, retained as the code-only rollback target; the schema is unchanged. Private deployment logs are under `.sites-runtime/design-release`.

Hosted checks passed in the isolated Relay verification space: the new viewer, zoom/details/Escape focus restoration, direct R2 image upload and thumbnail, verified streaming save, Firefox attachment bytes, responsive UI and Trash/restore; album creation, rename, original-name search, capture-date filtering and deep-link reload; and a multipart original larger than 16 MiB transferred between independently paired sessions with matching SHA-256 and receiver revocation. Named fixtures are retained there as cleanup candidates. Existing user media was not modified.

No commit or push was performed.

### Date-hint refinement

On 2026-09-19, the user approved softer empty From/To date hints. Empty, unfocused native date fields now use the muted search-hint colour; focused fields and chosen dates retain normal contrast. TypeScript, targeted lint, production build and deploy dry run passed. Version `6f662a34-05b1-4cf2-9f5e-ad4a54353698` is deployed at 100%, with `bbbb6840-3888-4577-973d-ef6c4eb6fd84` as its preceding version. Live date hints were visually checked, and production health/security probes passed. The disposable local preview was stopped to release the Windows build lock.
