# Bulk save to device ? 30 September 2026

The live toolbar lacked a download action. It now offers Save selected to device, selection/size confirmation and an ordinary native ZIP attachment download. On iPhone the dialog explains Files extraction and saving supported media to Photos. Browser download UI owns progress/cancellation; Relay never claims an unobserved local save completed.

The read-only API validates 1?100 unique IDs, the complete accessible ready/non-Trash selection and the existing 2 GiB package bound before streaming. The initial precheck surfaces errors in the dialog, with individual download links for over-limit selections. The actual download authenticates independently and rechecks current actor/workspace/file authority before each original and before the ZIP directory. It cannot grant editing access. Read-only members now get selection/download controls on the compatible release without editing controls.

The ZIP writer streams one R2 original at a time with backpressure, SHA-256/size validation, standard CRC32, and no completed directory after abort, corrupt bytes or final access failure. Flat numbered filenames avoid duplicate-name collisions and nested opaque directories; the manifest retains original labels and checksums. No temporary archive is stored and no original is altered. Ordinary desktop/browser export behavior remains backward compatible. Only the validated bulk URL gets an 8192-character query allowance, to carry up to 100 IDs; other routes retain 2048.

Chrome and WebKit phone-size tests pass native attachment download and independent Python ZIP/CRC/exact-byte extraction, duplicate names, unauthenticated/foreign-library/archived selection rejection, and read-only member toolbar. Existing package tests cover corruption, truncation, denied originals, final revocation and cancellation without commit, and bounded chunks at 80 MiB and the full 2 GiB limit (1 MiB maximum write, approximately 17 seconds in the local synthetic test; this is not a hosted 2 GiB benchmark). Existing WebKit album/navigation regression passes. TypeScript, focused lint, main/compatible production builds and deployment dry-run pass. No schema migration or unrelated backend activation.

- [x] Runtime `d73fde4` deployed at 100% as Worker `66abd8c0-7559-4ef7-ae6a-b469d10c37d9` on 30 September 2026 at 05:54 UTC. Both-origin health passed. Canonical-domain Chrome downloaded a native ZIP from two existing originals in the isolated Relay verification library; independent Python extraction, CRC, size and SHA-256 matched every selected original. Phone-width dialog screenshot inspected. No live records changed during the check. Main runtime source: `9dc0fc2`.
- [ ] Physical iPhone Files/Photos handoff confirmation.

References: [Apple ZIP extraction in Files](https://support.apple.com/en-nz/102532), [Cloudflare streaming responses](https://developers.cloudflare.com/workers/runtime-apis/streams/). Reviewed installed Workers types 5.20260917.1 and current stream/best-practice documentation; no binding changes.

## Interface copy refinement ? 30 September 2026

At the user?s request, removed the two explanatory paragraphs from the bulk dialog and shortened its progress/download-request status. The dialog now contains its title, selection count/size and download action, plus concise status or errors when needed. Download behavior and enforced limits are unchanged. This interface-copy preference is recorded in AGENTS.md.

- [x] Deployed runtime `b2d326b` as Worker `12eab076-f42c-46f0-88f0-7e043ec580c7`. Focused lint, production build and deploy dry-run passed. Both-origin health and the real canonical-domain dialog check passed; phone-width screenshot confirms title, count/size and download action only in the ready state.

## Visual refinement ? 1 October 2026

Replaced the bulk download text button with the matching 19 px toolbar icon, preserving its accessible label and tooltip. The modal now uses the existing album-dialog serif typography and warm palette, a structured archive summary, clear close control, and aligned Cancel/Download footer. Dedicated close styling fixes inherited white toolbar icon colour. Preparation retains a stable disabled action; request feedback is concise. Cancel and Escape restore focus to the trigger.

Chrome/WebKit acceptance passed at 320, 430 and 1280 px, including close contrast, icon-only label, no horizontal overflow, focus return, native ZIP download and original-byte checks. Mobile screenshots inspected; TypeScript, focused lint, build and dry-run passed.

- [x] Published `2c5c2f3` as Worker `89be1406-81b8-4301-9b36-e6311bc491dc`. Both-origin health and canonical-domain icon-only action, dark close icon, visible Cancel and concise modal checks passed; live phone-width screenshot inspected.

## Large-selection reliability - 13 November 2026

The owner reported inconsistent bulk downloads; a 29-file, 1.4 GB selection failed. Code review found three causes: pure-JavaScript SHA-256 and byte-wise CRC-32 over every byte inside the Worker (CPU time grows with archive size and can end the stream mid-file), about 13 D1 queries per file (roughly 70 files reaches the 1,000-query request ceiling, failing in the final recheck after all bytes were sent), and no declared length or failure log, so a truncated archive looked like a finished download. The live failure itself was not reproduced or read from production logs; the CPU cause is inferred from the reported size.

Changes: the Worker no longer re-hashes originals (size and CRC-32 are still checked; the manifest states that SHA-256 values are those recorded at upload); CRC-32 uses slicing-by-8; the selection is read in one query, each file costs one query plus one R2 read, account/workspace authority is rechecked when a file starts if 15 seconds have passed and always, with the whole selection in one query, before the directory; the response is a fixed-length stream with an exact `Content-Length`; failures log a redacted `relay_bulk_download_failed` event. The browser package (`components/original-package.tsx`) still verifies SHA-256. Limits remain 100 files and 2 GiB.

Assumption recorded: an access revocation now stops a running archive within 15 seconds at the next file boundary, or at the final recheck, instead of at every file boundary. No complete archive is produced in either case.

Evidence: TypeScript and focused lint pass; `tests/original-package.mjs` adds a server-mode case (exact declared length, independent Python CRC check, odd chunk sizes); `tests/bulk-download-browser.mjs` passes in Chrome and WebKit against the built Worker in workerd. A local 1,400 MiB archive costs 1.1 s CPU against 6.2 s for the previous hashing alone (desktop Node, not Worker CPU).

- [x] Implement and verify locally on `main`.
- [x] Deployed compatible release `75ed721` (`ui/album-library-live`, selection query filtered by workspace because schema 0020 has no audience scoping) as Worker `58438ec4-5b2a-44e0-8012-7b5de1540463` at 100% on 13 November 2026, 05:58 UTC. Both-origin health and anonymous bulk/feed denial pass. Rollback: `05e8f162-b56d-4c1b-b1a7-82611e02051f`. No schema change.
- [x] First deployment was insufficient. The owner reported an IDM download ending at about 700 MB; a signed-in reproduction on the canonical domain (29 largest originals, 1,596,061,274 bytes) ended at 604-682 MB twice, and the live log recorded `exceededCpu` at 32.5 s CPU. Removing the re-hash had not reduced Worker CPU enough.
- [x] Second deployment `c29278f8-e948-4c90-851b-311a48c51cbd` (13 November 2026, 06:17 UTC, 100%): originals are read in 1 MiB chunks and `limits.cpu_ms` is 300000 in `deploy/runtime-policy.json`. The same reproduction completed: 1,596,072,882 bytes, outcome `ok`, 51.0 s CPU, 111 s wall. A three-file live archive has a valid end-of-directory record and entry count. Both-origin health passes. Rollback: `58438ec4-5b2a-44e0-8012-7b5de1540463`, then `05e8f162-b56d-4c1b-b1a7-82611e02051f`.
- [ ] CPU is still about 33 ms per MiB, so the 1 MiB reads did not remove the cost; the raised ceiling is what lets large archives finish (a 2 GiB archive needs roughly 70 s). The remaining cost is unprofiled.
- [ ] The live response has no `Content-Length` although the route sets one; a layer after the route removes it, so truncation is still not detectable by the browser or a download manager.
- [ ] Owner confirmation through IDM, including extraction.
- [ ] Not changed: an error response before streaming is still saved by the browser as `relay-originals.zip`; downloads are not resumable; ZIP64 and whole-album download are not implemented.
