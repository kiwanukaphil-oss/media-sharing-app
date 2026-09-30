# Bulk save to device ? 30 September 2026

The live toolbar lacked a download action. It now offers Save selected to device, selection/size confirmation and an ordinary native ZIP attachment download. On iPhone the dialog explains Files extraction and saving supported media to Photos. Browser download UI owns progress/cancellation; Relay never claims an unobserved local save completed.

The read-only API validates 1?100 unique IDs, the complete accessible ready/non-Trash selection and the existing 2 GiB package bound before streaming. The initial precheck surfaces errors in the dialog, with individual download links for over-limit selections. The actual download authenticates independently and rechecks current actor/workspace/file authority before each original and before the ZIP directory. It cannot grant editing access. Read-only members now get selection/download controls on the compatible release without editing controls.

The ZIP writer streams one R2 original at a time with backpressure, SHA-256/size validation, standard CRC32, and no completed directory after abort, corrupt bytes or final access failure. Flat numbered filenames avoid duplicate-name collisions and nested opaque directories; the manifest retains original labels and checksums. No temporary archive is stored and no original is altered. Ordinary desktop/browser export behavior remains backward compatible. Only the validated bulk URL gets an 8192-character query allowance, to carry up to 100 IDs; other routes retain 2048.

Chrome and WebKit phone-size tests pass native attachment download and independent Python ZIP/CRC/exact-byte extraction, duplicate names, unauthenticated/foreign-library/archived selection rejection, and read-only member toolbar. Existing package tests cover corruption, truncation, denied originals, final revocation and cancellation without commit, and bounded chunks at 80 MiB and the full 2 GiB limit (1 MiB maximum write, approximately 17 seconds in the local synthetic test; this is not a hosted 2 GiB benchmark). Existing WebKit album/navigation regression passes. TypeScript, focused lint, main/compatible production builds and deployment dry-run pass. No schema migration or unrelated backend activation.

- [ ] Live release and native download/readback.
- [ ] Physical iPhone Files/Photos handoff confirmation.

References: [Apple ZIP extraction in Files](https://support.apple.com/en-nz/102532), [Cloudflare streaming responses](https://developers.cloudflare.com/workers/runtime-apis/streams/). Reviewed installed Workers types 5.20260917.1 and current stream/best-practice documentation; no binding changes.
