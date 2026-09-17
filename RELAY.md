# Relay

A working desktop web implementation of the shared media drop zone, deployed directly to Cloudflare at https://relay-media-exchange.kiwanukaphil.workers.dev, with a separate native Android preview in [mobile](./mobile/README.md). The responsive web layout and native app are distinct clients. Architecture and UX details are in [docs/PRODUCT-ARCHITECTURE.md](./docs/PRODUCT-ARCHITECTURE.md); resource details are in [deploy/STATUS.md](./deploy/STATUS.md).

## Implemented

- Device-scoped shared spaces, hashed persistent device credentials, secure production cookies, expiring one-use invitation links and locally generated QR codes, and device revocation.
- Originals and Final cuts in one durable D1-backed feed. R2 holds the original bytes. No decoding, resizing, metadata stripping, or re-encoding occurs in the transfer path.
- 16 MiB multipart uploads, bounded incremental SHA-256 hashing, real byte progress, retry, pause, and resume. IndexedDB retains device-local manifests and completed part ETags. After reload, reselect the original file; its full hash must match before reuse.
- Save to device uses File System Access when supported, hashing the stream and committing only when size and SHA-256 match. Other browsers use attachment downloads.
- Paginated feeds, server-side filename search, category counts, reversible Trash, and explicit permanent deletion.
- A 100 GiB shared-space limit (displayed as 100 GB), including previews and unfinished-upload reservations. Atomic reservations prevent concurrent uploads exceeding the limit. No automatic deletion of originals.
- Cancellation releases unfinished reservations. Expired multipart sessions can restart explicitly. Wrong-source recovery opens the picker again without losing completed parts.
- Separate JPEG thumbnails for supported images up to 24 MiB; feed cards never fetch full originals to render a thumbnail.
- The server authenticates every media operation, scopes it to the device's space, rejects cross-origin mutations, and checks complete multipart manifests and final object size before publication.
- A feature-detected read-only WebMCP tool, `list_shared_media`. It uses the same authorized feed endpoint.

## Run locally

The Sites-compatible React/Vinext/Vite starter is retained. Cloudflare's local runtime emulates D1 and R2 on disk under `.wrangler/state`.

```sh
npm ci
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_purple_chamber.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_late_beyonder.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0002_lush_karma.sql
npm run dev
```

Apply each migration once per local database. For this checkout all three migrations have already been applied. Open the exact address printed by the server (normally http://localhost:5173). Create a space and choose files. A second browser profile can redeem an invitation to test another device on this computer.

The bundled npm wrapper failed on this Windows installation. The working fallback was to run the installed npm JavaScript entry point directly:

```powershell
& 'C:/Program Files/nodejs/node.exe' 'C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js' ci
node scripts/run-framework.mjs build
node scripts/run-framework.mjs dev
```

Local uploads stream each part through the local Worker into emulated R2. Local downloads stream from that emulator. This exercises the durable workflow without cloud credentials; it is explicitly labeled local in the UI.

## Validate

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

The transfer integration test requires the local server. It creates isolated test spaces and retains its fixtures; it does not modify or delete the user's space. Tests cover multipart resume, incomplete-manifest rejection, byte equality, HTTP ranges, tenant isolation, CSRF, invitation replay/races, and revocation. The download test checks streaming, user-activation ordering, and rejection of a corrupted file without committing it. Browser tests require installed Chrome/Edge and Playwright Firefox/WebKit (install with: node node_modules/playwright/cli.js install firefox webkit). All four browser engines passed desktop and 390 px flows. WebKit automation is not physical Safari/iOS validation. Native platforms and real R2 credentials are not exercised by these local tests.

## Production transfer connection

The user approved direct Cloudflare hosting and the scoped R2 credential. The Worker, D1 database, private R2 bucket, exact-origin CORS, and Worker secrets are configured. A real multipart upload/download passed SHA-256 equality checks across independently paired sessions. The initial preview was committed and pushed with approval. The user also approved committing and pushing the tested web release. Sites registration is not used.

The original Sites deployment plan below is retained as a reference candidate for later removal; the active deployment procedure is in [deploy/STATUS.md](./deploy/STATUS.md).

1. Use Sites to provision the logical `DB` and `BUCKET` bindings in `.openai/hosting.json` and apply the checked-in Drizzle migration. Keep Sites' generated resource identities.
2. Configure the runtime keys listed in `.env.example`. `R2_BUCKET_NAME` must identify exactly the bucket wired to `BUCKET`: multipart creation/completion uses the binding and signed part requests use its S3 endpoint. Keep credentials server-side and restrict their scope to this bucket.
3. Configure bucket CORS for the actual app origin: GET, HEAD, PUT; allowed request headers needed by the upload (including Content-Type); exposed ETag, Content-Length, Content-Range, and Accept-Ranges. Test signed PUT and ranged GET requests on the deployed origin.
4. Use a controlled setup to enable initial space creation; disable `ALLOW_SPACE_CREATION` afterward. Staff join through invitations. Device pairing is application-owned as required by the brief. Confirm that the eventual hosting access policy permits staff to reach the app without an additional platform-account login.
5. The application enforces a 100 GiB shared-space limit and supports explicit restart of expired multipart sessions. Review account-level budgets and abuse controls before expanding beyond invitation-only staff access.

Without production signing settings, the hosted adapter fails closed. It never silently falls back to routing huge production files through the Worker. Signed URLs expire after one hour; each retried part gets a fresh URL. Revoking a device invalidates future API access, but already-issued signed URLs remain usable until expiry.

## Boundaries and remaining work

- Native Android and iOS transfer source now lives in [mobile](./mobile/README.md). Android builds and has passed real-device pairing, background multipart upload, verified gallery/download saving, and app force-stop recovery tests. iOS requires Mac compilation and device validation. Dedicated capture and original-resource extraction remain pending. Browser uploads cannot promise to survive closing the tab, and web downloads cannot silently write to Photos.
- Supported images use separate lightweight thumbnails. Older files and unsupported formats use placeholders until explicitly previewed. Live Photo/RAW grouping and video-poster extraction remain outside this web release.
- The feed loads 48 files per page with Load more, stable cursors, and search across the entire shared space.
- SHA-256 is computed from the selected source and verified by the optional streamed Save as path. The server checks multipart assembly and byte count, not the whole-object SHA-256. Browser-managed downloads do not provide application-level verification.
- Trash is reversible and consumes storage until explicit permanent deletion. Unfinished uploads can be cancelled or restarted. Completed originals are never deleted automatically.
- Full files are hashed before upload; large originals therefore show “Checking original” before sending. Files are handled in bounded chunks rather than loaded completely into memory.
- An invitation opened by an already-paired browser does not silently switch spaces. Use a separate browser profile for a different space in this version.
- Device sessions last one year. Clearing site data or uninstalling a browser requires pairing again.
- The hosted owner-pairing flow was exercised in Chrome, and live HTTP clients verified direct R2 transfers across paired sessions. Physical Android results and outstanding platform checks are recorded in [mobile/VALIDATION.md](./mobile/VALIDATION.md). A capability check found no WebMCP support in the earlier preview browser, so the optional agent tool remains unverified.

## Native implementation contract

Native transfer ownership now lives outside JavaScript: iOS background URLSession with file-backed tasks and atomic manifests, Android user-initiated transfer jobs with version-appropriate fallback and SQLite manifests. Selected files are staged durably, hashed, and moved through the existing multipart protocol. Native sessions use bearer credentials held in secure OS storage. Hosted native pairing, CSRF/Origin enforcement, invitation replay protection, invalid credential rejection, and revocation tests pass.

On iOS, save verified downloads with resource-based PhotoKit import and add-only permission, falling back to Files for unsupported formats. On Android, use MediaStore pending writes, publish only after successful verification, and use Downloads for non-gallery resources. Validate real devices, low storage, revoked permissions, OS termination, offline recovery, HDR/EXIF, and resource pairs before release.
