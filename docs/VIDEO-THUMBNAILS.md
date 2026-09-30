# iPhone video thumbnails ? 30 September 2026

The reported originals are iPhone MOV videos showing format placeholders. Inspection found an unconditional 256 MiB poster exclusion, a loadeddata-before-seek dependency incompatible with metadata-only preload, and no recovery of existing missing posters.

Preparation now seeks after loadedmetadata, checks decoded dimensions, generates a bounded JPEG, and releases its decoder/object URL. The size exclusion is removed; six-second optional local preparation remains bounded. File extensions cover missing/atypical picker MIME types. Originals are never transcoded or changed.

Visible gallery videos missing posters recover from the authenticated preview URL, one decoder at a time with a twenty-second deadline. Anonymous CORS permits canvas use of the signed R2 redirect; credentials remain on Relay. Existing editors can persist the separate JPEG through unchanged server permission/quota checks. Other viewers get only a local display image. Unmount, pagehide and access invalidation abort recovery. No album-home media fetching is added.

This is browser-assisted recovery, not a server video transcoder. A browser without the original codec/container retains a truthful fallback. Physical iPhone HEVC/HDR decoding has not been verified. The generated test fixture is H.264 in a real QuickTime MOV container (ffmpeg testsrc2, 160x120, one second); it contains no user media.

Validation: Chrome new upload and existing MOV recovery passed with loadeddata listeners suppressed, persisted JPEG after reload, and byte-identical original download. Windows Playwright WebKit reports a media decode error for this MOV container, so its test covers the unsupported-platform fallback separately. Unit fixtures cover metadata-first seek, >256 MiB eligibility, missing MIME, scoped JPEG writes, unsupported decode and abort cleanup.

- [x] Compatible-release TypeScript, focused lint, production build and deploy dry-run passed. Real Chrome MOV poster/recovery and Windows WebKit unsupported-decoder checks passed, as did the existing photo/video/poster/playback/exact-byte/responsive regression.
- [ ] Production deployment and readback.
- [ ] Physical iPhone confirmation for the user's original videos.

Browser investigation: [WebKit metadata-only iOS preload](https://bugs.webkit.org/show_bug.cgi?id=197608) and [iOS blob loadeddata report](https://bugs.webkit.org/show_bug.cgi?id=270772).
